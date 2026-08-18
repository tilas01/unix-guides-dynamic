# Security Audit — the Rust Tools

A source review of the five crates under `security-tools/`. Static review only:
these crates cannot be compiled on a non-Linux machine (`nix` and `libudev-sys`
have no Windows build), so this is a read of the logic, not a run of it.

Findings are ranked by what an attacker actually gains, not by how alarming they
sound. Everything marked **Fixed** was addressed in the same change as this
document.

---

## HIGH — Integrity check failed open on a missing baseline · **Fixed**

`kernel-watcher::check_evil_maid_hash()`

```rust
let stored_hash = fs::read_to_string(EVIL_MAID_HASH_FILE).unwrap_or_default();
if stored_hash.is_empty() {
    return true; // Not set up
}
```

Returning `true` means "integrity verified". So deleting or truncating one file
silently disabled the entire evil-maid check, and the boot continued with a clean
bill of health.

Why this matters more than it looks: the attacker this tool exists to stop is
one with offline physical access to the disk. Deleting a file in `/etc` is
strictly easier for them than modifying `/boot` — so the defence could be removed
by an attacker weaker than the one it was designed for.

**Fixed:** fails closed. A missing baseline now reports loudly, distinguishes
"never set up" from "baseline deleted", and returns `false`.

---

## HIGH — Baseline hash was not deterministic · **Fixed**

`kernel-watcher::setup_evil_maid_hash()` / `check_evil_maid_hash()`

```rust
for entry in WalkDir::new("/boot").into_iter().filter_map(|e| e.ok()) {
    if entry.file_type().is_file() {
        if let Ok(content) = fs::read(entry.path()) {
            hasher.update(&content);   // contents only, traversal order
        }
    }
}
```

Three defects in six lines:

1. **Unstable ordering.** `WalkDir` traversal order is filesystem-dependent and
   not guaranteed stable between runs. The baseline and the check could disagree
   on an unchanged `/boot`.
2. **Paths not hashed.** Only file contents fed the hash, so renaming a file, or
   deleting one and adding another with identical bytes, was invisible.
3. **No length framing.** Concatenating contents with no boundaries means
   different file layouts can produce identical byte streams.

Defect 1 is the dangerous one, and not for the obvious reason. It produces
**false** RED ALERTs telling the user not to enter their LUKS passphrase. A
warning that fires when nothing is wrong trains the user to dismiss it, so the
real alert gets dismissed too. An unreliable alarm is worse than none.

Note `anti-evil-maid::hash_directory` already did this correctly — it sorts and
includes paths. Only kernel-watcher's copy was wrong.

**Fixed:** extracted `hash_boot_partition()`, which sorts entries by path and
hashes a length-prefixed path and a length-prefixed content for each. Unreadable
files contribute a sentinel rather than being skipped, so they cannot become a
blind spot to hide a payload in.

---

## MEDIUM — Master-password hash was world-readable · **Fixed**

`kernel-watcher::run_setup()` wrote the Argon2 hash with `fs::write`, which
creates using the process umask — normally `0644`. Any local user could copy the
hash and brute-force it offline at their own pace, which negates the reason for
using a memory-hard KDF at all.

`libre-otp` already got this right, setting `0600` on its secret and its recovery
codes. Only this file was missed.

**Fixed:** added `write_private()`, which sets mode `0600` **at creation** via
`OpenOptionsExt::mode` — so unlike a create-then-chmod, there is no window where
the file exists with wider permissions. Applied to both the tamper hash and the
evil-maid baseline.

---

## MEDIUM — Lockout destroyed the user's OTP secret · **Fixed**

`anti-evil-maid::enforce_lockout()`

```rust
let _ = fs::write("/etc/libre-otp/secret.json", "LOCKOUT_TRIGGERED_BY_AEM");
```

This overwrote the user's TOTP secret **and their recovery codes** with a
sentinel string. That is unrecoverable: after a lockout the user cannot
authenticate even once the machine is confirmed clean.

Worse in combination with the non-determinism above — a false positive could
trigger it, meaning an entirely untampered machine could permanently lose its
OTP enrolment.

**Fixed:** writes a separate `0600` lockout flag at
`/etc/arch-security/lockout` and leaves the OTP secret untouched. The flag
explains how to verify the machine from a live medium and how to clear the
lockout deliberately.

---

## MEDIUM — Tools and installer disagreed on where state lives · **Fixed**

`kernel-watcher`, `anti-evil-maid`, `anti-ducky`, `scripts/install-security-suite.sh`

```rust
const TAMPER_HASH_FILE: &str = "/etc/arch-rusty-security-suite/tamper.hash";  // kernel-watcher
const AEM_STATE_DIR:    &str = "/etc/arch-rusty-security-suite/aem";          // anti-evil-maid
const APPROVED_REGISTRY:&str = "/etc/anti-ducky/approved_devices.json";       // anti-ducky
```

```sh
readonly CONFIG_DIR="/etc/arch-security"    # the only directory the installer creates
```

Three different `/etc` roots for one suite, none of them agreeing with the
installer. `anti-ducky` disagreed with *itself*: its unlock hash was already at
`/etc/arch-security/anti-ducky/unlock.hash` while its device registry was not.

The security consequence is in the systemd units the same installer writes:

```ini
ProtectSystem=strict
ReadWritePaths=/var/log /etc/arch-security
```

`ProtectSystem=strict` mounts the rest of `/etc` read-only for that daemon. So
every write outside `/etc/arch-security` failed — and each of these call sites
discards the error (`let _ = fs::write(...)`, `unwrap_or_default()`). The
`anti-ducky` daemon therefore appeared to record device approvals and lost them
on restart, and `anti-evil-maid --daemon` could not re-baseline after an
authorised change. A tool that silently forgets what you approved is one users
learn to work around, which is the whole value of it gone.

**Fixed:** everything is under `/etc/arch-security/<tool>/`, matching the
directory the installer provisions and the convention `anti-ducky` already half
followed. Reads fall back to the old paths — writes never do — so an existing
install keeps verifying against its current baseline instead of failing closed
on upgrade, which for `check_evil_maid_hash()` would be indistinguishable from
tampering. Setup runs print where the stale copy is so it can be retired
deliberately. The installer now creates each per-tool directory at `0700`, and
`write_private()` creates any directory it needs at `0700` rather than inheriting
`0755` from the umask.

---

## LOW — Argon2 parameters were the bare minimum · **Fixed**

`Argon2::default()` is m=19 MiB, t=2, p=1 — the OWASP *floor*. For a password
verified interactively a handful of times a day, spending materially more work
per attempt costs the legitimate user nothing noticeable and costs an offline
attacker linearly more.

**Fixed:** m=64 MiB, t=3, p=4 for new hashes, with a fallback to the library
default if the parameters are ever rejected, so a bad constant cannot brick the
tool. Verification deliberately still uses `Argon2::default()`, because
`verify_password` takes m/t/p from the PHC string in the stored hash — that is
what keeps hashes written under the old parameters verifying after the upgrade.
There is a comment in the source saying so, because it looks like an
inconsistency and is not one.

---

## Reviewed and found correct

* **`libre-otp` secret storage.** Creates the file, chmods to `0600`, *then*
  writes the secret. The ordering is right — no window where the secret exists at
  a wider mode. Recovery codes likewise.
* **Secret zeroization.** `libre-otp`, `kernel-watcher` and `scarecrow` call
  `.zeroize()` on password buffers, including on the mismatch path where it would
  be easy to forget.
* **Randomness.** `SaltString::generate(&mut OsRng)` — OS CSPRNG, correct.
* **Password verification timing.** Handled by argon2's `verify_password`, which
  is constant-time. The tool never hand-rolls a secret comparison.
* **No command injection.** Every `Command::new` uses a fixed program with
  fixed arguments; no user input reaches a shell.
* **No hardcoded secrets.** Nothing key-like in any source file.

## Deliberately not "fixed"

**Plain `!=` when comparing the `/boot` hash.** Constant-time comparison is not
needed: the hash is not secret — an attacker with the disk can compute it
themselves — so there is no timing signal worth hiding. Adding a constant-time
compare here would be cargo-culting, and the source records why it is absent so
it is not mistaken for an oversight.

**Plain `!=` between a password and its confirmation.** Both values are supplied
by the same person in the same prompt. There is no secret to leak to anyone.

**`libre-otp` still stores its secret in `/etc/libre-otp/`, not under
`/etc/arch-security/`.** It is the one remaining tool outside the shared
directory, and it stays there for now. `libre-otp` ships no daemon, so
`ProtectSystem=strict` never applies to it and nothing is silently failing; the
directory is referenced by the generated PAM and initramfs snippets in
`website/script.js`, and it holds the one secret in the suite that cannot be
regenerated — a user who loses `secret.json` and their recovery codes is locked
out for good. Moving it is a migration with a real failure mode, not a rename,
and deserves its own change. Note the installer's uninstall warning about
`/etc/arch-security` holding "OTP secrets" is aspirational until then.

---

## Still outstanding

Honest about what this review did **not** cover:

* **No dynamic analysis.** Nothing was run. There may be logic errors that only
  appear at runtime, and `cargo test` coverage across these crates is thin.
* **`anti-ducky`'s timing heuristics were not evaluated for accuracy.** Whether
  its keystroke-interval thresholds actually separate a human from an injector,
  and what its false-positive rate is on real hardware, needs measurement on a
  real machine. A tool that can reject your only keyboard deserves that.
* **`scarecrow`'s kernel module (`src/driver/`) was not reviewed.** Kernel code
  is a different risk class and warrants its own pass.
* **`aya`/eBPF paths in `kernel-watcher` were not reviewed.**
* ~~No dependency vulnerability scan.~~ **`cargo audit` is now in CI** for every
  crate, advisory rather than blocking — a newly published advisory in a
  transitive dependency should surface loudly, but must not stop a security fix
  from shipping. Findings appear in the run summary.
* ~~`anti-evil-maid` declares `zeroize` but never uses it.~~ **Confirmed and
  removed.** The crate never touches a raw secret: password handling is delegated
  to `kernel_watcher::verify_tamper_password()`, which zeroizes its own buffer,
  and the only other input is a y/N confirmation. An unused security dependency is
  worse than no dependency, because it implies a wipe that is not happening.

Recommended next: add `cargo audit` and `cargo deny` to CI, write tests for the
integrity-check paths (especially the fail-closed behaviour fixed above), and
measure anti-ducky's false-positive rate on real hardware before anyone relies on
it to guard a login.

## Found something? Say so

An audit is a snapshot by one set of eyes, and the section above is explicit
about what it did not cover. If you spot something — a real vulnerability, a
command that does not do what the guide claims, a package that no longer exists,
or documentation that describes behaviour the code does not have — please open an
issue:

**<https://github.com/tilas01/Unix-SIT/issues>**

That includes disagreements. If this project and the Arch Wiki conflict, the Arch
Wiki is right and this is a bug worth reporting.

For anything you believe is exploitable, say so in the issue title so it is
triaged first. There is no separate private channel — this is a personal project,
not an organisation with a security team, and pretending otherwise would be
worse than saying it plainly.
