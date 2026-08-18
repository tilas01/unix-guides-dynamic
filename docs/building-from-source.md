# Building the Security Tools from Source

Building it yourself is the only way to know what you are running. This is also
how you independently confirm a published binary was not tampered with.

---

## Prerequisites

```bash
sudo pacman -S --needed rust base-devel pkg-config systemd-libs git
```

`systemd-libs` provides libudev, which `anti-ducky` (evdev) and `anti-evil-maid`
(udev) link against. Without it you get an unhelpful `pkg-config` failure.

The toolchain is pinned in [`security-tools/rust-toolchain.toml`](../security-tools/rust-toolchain.toml).
`rustup` reads it automatically and installs the right version, so do not
override it — a different compiler produces different bytes, and reproducibility
is the whole point.

```bash
git clone https://github.com/tilas01/Unix-SIT.git
cd Unix-SIT/security-tools
rustc --version    # should match rust-toolchain.toml
```

---

## Quick build

Everything, as one binary:

```bash
cd security-tools/unix-security-suite
cargo build --release --locked
./target/release/unix-security-suite list
```

Or a single tool:

```bash
cd security-tools/libre-otp
cargo build --release --locked
```

`--locked` matters. Without it Cargo may resolve a newer dependency than the
committed `Cargo.lock`, which changes the output and means your hash will not
match the published one.

---

## Reproducible build — verifying a published binary

Two builds of the same commit should produce byte-identical output. To check a
release against your own build:

```bash
cd Unix-SIT
git checkout <the-release-tag>
cd security-tools/unix-security-suite

# Same timestamp the CI used: derived from the commit, not from now.
export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)

cargo build --release --locked
sha512sum target/release/unix-security-suite
```

Compare that against the `.sha512` on the
[release page](https://github.com/tilas01/Unix-SIT/releases). If they
match, the published binary was built from exactly this source.

**If they do not match**, before assuming the worst, check:

* Are you on the same tag the release was built from?
* Does `rustc --version` match the toolchain in `rust-toolchain.toml`?
* Did you set `SOURCE_DATE_EPOCH`?
* Did you pass `--locked`?
* Is your `security-tools/.cargo/config.toml` unmodified? The
  `--remap-path-prefix` entries there are what strip build paths out; changing
  them changes the output.

A genuine mismatch after all that is worth
[opening an issue](https://github.com/tilas01/Unix-SIT/issues).

### What makes it reproducible

| Source of variance | How it is handled |
|---|---|
| Build machine paths in panic strings | `--remap-path-prefix` in `.cargo/config.toml` |
| Build timestamps | `SOURCE_DATE_EPOCH` from the commit |
| Parallel codegen ordering | `codegen-units = 1` |
| Incremental compilation artefacts | `incremental = false` |
| Dependency version drift | committed `Cargo.lock` + `--locked` |
| Compiler version drift | `rust-toolchain.toml` |
| Symbol mangling changes | `-Csymbol-mangling-version=v0` |

---

## Optimisation, and one thing to avoid

The release profile already applies the settings that matter:

```toml
opt-level = 3         # full optimisation
lto = "fat"           # whole-program optimisation across all crates
codegen-units = 1     # better optimisation, and required for determinism
panic = "abort"       # smaller; a security tool should not unwind past a fault
strip = "symbols"     # no build paths or symbol noise in the shipped binary
overflow-checks = true # kept ON in release — see below
```

**`overflow-checks` stays on deliberately.** It is normally disabled in release
for speed. In a tool that parses untrusted input — USB descriptors, device
names, hashes off disk — a silent integer wraparound is a bug you will never see
until it is exploited. A panic is the better outcome. The cost is negligible
next to the I/O these tools do.

**Do not add `target-cpu=native`.** It is the first thing people reach for, and
it is a mistake here:

* The binary crashes with an illegal instruction on any CPU lacking those extensions.
* It destroys reproducibility — the output depends on the build machine.
* These tools are I/O-bound. You will not measure the difference.

If you are building strictly for one machine and understand the trade-off:

```bash
RUSTFLAGS="-Ctarget-cpu=native" cargo build --release --locked
# Reproducibility is now void. Do not publish or share this binary.
```

### Hardening flags

`.cargo/config.toml` also applies:

* `-Wl,-z,relro,-z,now` — full RELRO, so the GOT is read-only after startup, removing a common overwrite target.
* `-Wl,-z,noexecstack` — non-executable stack.
* `-Crelocation-model=pic` — PIE, so ASLR covers the binary itself.

Confirm they took effect:

```bash
sudo pacman -S --needed checksec
checksec --file=target/release/unix-security-suite
# Expect: Full RELRO, NX enabled, PIE enabled
```

---

## Installing what you built

```bash
sudo install -Dm755 target/release/unix-security-suite /usr/local/bin/
```

Or let the installer do it, building from source rather than downloading:

```bash
sudo bash scripts/install-security-suite.sh --from-source --all
```

That also writes the hardened systemd units and prints the per-tool setup each
one still needs. Daemons are installed **stopped** — enabling them is a separate,
deliberate step, because several can lock you out.

---

## Per-tool notes

| Tool | System deps | Notes |
|---|---|---|
| `libre-otp` | — | Invoked by PAM. Test with `--setup` before wiring PAM, or you can lock yourself out. |
| `anti-ducky` | libudev (evdev) | Run `--approve-current` **while your real keyboard is attached**. |
| `anti-evil-maid` | libudev | Depends on `kernel-watcher` by path, so build that first if building individually. |
| `kernel-watcher` | libudev | Uses `nix`, which is *nix-only. It will not build on Windows or macOS. |
| `scarecrow` | — | Optional kernel module in `src/driver/` is built separately with `make`. |
| `unix-security-suite` | libudev | Links all five. Build this last. |

### Cross-platform

These are Linux tools. `kernel-watcher` uses `nix::sys::signal` and
`nix::unistd`, which do not exist on other platforms, so `cargo check` on
Windows or macOS fails on those imports. That is expected, not a bug — build and
test on Linux, or in a VM or container:

```bash
podman run --rm -it -v "$PWD":/src:Z -w /src/security-tools archlinux:latest \
  bash -c 'pacman -Sy --noconfirm rust base-devel pkg-config systemd-libs &&
           cd unix-security-suite && cargo build --release --locked'
```

---

## Running the tests

```bash
cd security-tools/<tool>
cargo test
cargo clippy --release -- -D warnings
cargo fmt --check
```

CI runs `fmt` and `clippy` on every push. They are advisory rather than blocking
so a style nit cannot stop a security fix from shipping, but findings appear as
warnings in the run summary and should be dealt with.
