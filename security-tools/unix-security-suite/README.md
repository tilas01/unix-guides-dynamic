<div align="center">
  <img src="assets/banner.png" width="880" alt="Unix Security Suite">
</div>

# Unix Security Suite

All five tools in one binary, dispatching to whichever you ask for.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

One binary instead of five. Useful when you want a single signed, hash-verified
artefact to install rather than five of them, and it is what the generator
installs when you pick the whole suite.

The five tools it dispatches to are
[Anti-Ducky](../anti-ducky/), [Anti-Evil Maid](../anti-evil-maid/),
[Kernel Watcher](../kernel-watcher/), [Libre OTP](../libre-otp/) and
[Scarecrow](../scarecrow/). Each behaves exactly as it does standalone — read
their READMEs for what each one actually does, and does not do.

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
cd Unix-SIT/security-tools/unix-security-suite
cargo build --release --locked
```

[docs/building-from-source.md](../../docs/building-from-source.md) has the exact
toolchain and the `SOURCE_DATE_EPOCH` setting that makes the output
byte-identical to the published binary.

## Usage

```
  <tool> [args...]   Run one of the five tools with its own arguments
  -h, --help         Full argument list
  -V, --version      Version
```

```bash
unix-security-suite --help
```

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify unix-security-suite.sig unix-security-suite
sha512sum -c unix-security-suite.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## Honest limitations

Installing the suite installs five daemons' worth of capability in one
executable. That is a larger blast radius than installing only what you need,
and a bug in the dispatcher reaches all five. If you want one tool, install one
tool.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
