<div align="center">
  <img src="assets/banner.png" width="880" alt="Scarecrow">
</div>

# Scarecrow

Canary tokens and sandbox spoofing: convinces malware it is being watched, and gives you a duress login that does not look like one.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

A lot of commodity malware checks whether it is running in an analyst's sandbox
and quietly exits if it decides it is. `scarecrow` makes an ordinary machine look
like that sandbox. Cheap to run, and it costs an attacker more than it costs you.

It also plants canary files: documents that nothing legitimate ever reads.
Anything that opens one has announced itself.

The duress login presents a plausible session while signalling that you are not
entering it freely.

### Three PINs, each optional

Under coercion you may need one of three different things, so there are three
separate passwords. Configure none, one, or all of them.

| PIN | What entering it does |
|---|---|
| **duress** | Erases the LUKS header of the device you configured. Nothing on screen says so — it behaves exactly like a wrong password. |
| **decoy** | Opens a believable, working session in a decoy home. **Erases nothing.** |
| **duress + decoy** | Erases the header **and** opens the decoy session, so the data is gone and the screen still shows a working system. |

```bash
sudo scarecrow --set-duress-device /dev/nvme0n1p2   # what a duress PIN erases
sudo scarecrow --set-duress-pin                     # erase, silently
sudo scarecrow --set-decoy-pin                      # plausible session only
sudo scarecrow --set-duress-decoy-pin               # both at once
```

Nothing is erased until `--set-duress-device` names a device. Refusing to guess
is deliberate: erasing the header of a device nobody named is unrecoverable, and
it might be the wrong disk.

**Take a header backup before you enable this**, and keep it somewhere the person
you are hiding from cannot reach:

```bash
cryptsetup luksHeaderBackup /dev/nvme0n1p2 --header-backup-file luks-header.img
```

### Why it is silent

For any of this to work it has to be **silent about being a decoy**. The person
standing over your shoulder must see an ordinary login — not a message
announcing that a special password was entered.

This code once printed `Duress password detected! Wiping system`, which told the
coercer exactly what it existed to hide. It does not do that any more, and the
word "wipe" appears nowhere in what a user sees. A non-match prints exactly
`Login incorrect`, which is what a wrong password prints. So does a duress-only
match, once the data is gone: a disk that will not unlock reads as a forgotten
passphrase or a failing drive.

All three PINs are Argon2id hashes (m=64 MiB, t=3, p=4) in root-owned `0600`
files, never values baked into the source. All three are verified on **every**
attempt with no early exit — stopping at the first match would make the time
taken depend on which slot matched, and three Argon2 verifications at 64 MiB are
slow enough for that difference to be measurable.

If one password is somehow enrolled in more than one slot, the most destructive
interpretation wins. Under duress is the wrong moment to resolve ambiguity in
favour of doing less.

### Honest limitations

- **The wipe erases the LUKS header, not the disk.** That is deliberate — it
  takes milliseconds and is irreversible without a backup, whereas overwriting a
  whole disk cannot finish before someone notices. But the ciphertext remains on
  the platter. Against an adversary who imaged the disk *before* the wipe, this
  does nothing.
- **It cannot survive a machine that is simply taken away powered-on.** Anything
  already unlocked stays unlocked; that is what the anti-evil-maid auto-lock and
  a short lock timeout are for.
- **The decoy session is a session, not disk-level deniability.** The hidden
  volume in the [wiki](https://tilas01.github.io/Unix-SIT/wiki.html#luks-duress)
  is what keeps the real data unreachable; this makes the part that *is*
  reachable look lived-in. An obviously empty decoy home is itself a tell —
  populate it.
- **Someone who knows this tool exists knows a duress PIN may exist.** The
  deniability is that they cannot tell which password you gave them, not that
  the mechanism is secret. It is in a public repository.

## Install

The suite installer verifies the SHA-512 hash *and* the GPG signature, pins the
signing key by fingerprint, and refuses to install anything that fails either
check:

```bash
curl -fsSL https://raw.githubusercontent.com/tilas01/Unix-SIT/main/scripts/install-security-suite.sh -o install.sh
less install.sh          # read it before you run it
sudo bash install.sh
```

Or build it yourself. The builds are reproducible, so a local build is an
independent check that does not require trusting any signing key at all:

```bash
pacman -S rustup && rustup default stable
git clone https://github.com/tilas01/Unix-SIT.git
cd Unix-SIT/security-tools/scarecrow
cargo build --release --locked
```

[docs/building-from-source.md](../../docs/building-from-source.md) has the exact
toolchain and the `SOURCE_DATE_EPOCH` setting that makes the output
byte-identical to the published binary.

## Usage

```
  -i, --interactive           Launch the GUI dashboard (Wayland/Xorg)
  -l, --login                 Present the duress / decoy login prompt
      --set-duress-password   Set or change the duress password, then exit
      --confirm               Double-enter at the duress prompt (off by default; a confirm step is a tell)
  -h, --help                  Full argument list
  -V, --version               Version
```

Run with no arguments to start the daemon:

```bash
sudo scarecrow
```

Or open the dashboard:

```bash
scarecrow --interactive
```

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify scarecrow.sig scarecrow
sha512sum -c scarecrow.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## Honest limitations

**Plausible deniability is only as good as the decoy you build.** An empty decoy
home fools no one — populate it with believable, innocuous files so it reads as a
real account in use. And the disk-level half is not this tool's job: without the
hidden-volume LUKS setup, an examiner who images the disk can still see that a
second, larger encrypted volume exists. This makes the *session* convincing; the
wiki covers making the *disk* convincing.

A previous version compared the duress password against the hardcoded string
`"duress123"` and then printed "Duress password detected! Wiping system" — which
told the coercer exactly what had happened. Both problems are fixed.

Sandbox spoofing works against malware that bothers to check. It is a filter,
not a wall. Targeted tooling will not be fooled and should not be assumed to be.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
