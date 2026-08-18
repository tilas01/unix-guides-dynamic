<div align="center">
  <img src="assets/banner.png" width="880" alt="Libre OTP">
</div>

# Libre OTP

TOTP and HOTP one-time passwords in Rust, with no proprietary backend, no cloud account and no binary blobs.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

A second factor should not require an app store, a phone that phones home, or a
vendor who can lock you out of your own accounts. `libre-otp` generates RFC 6238
(TOTP) and RFC 4226 (HOTP) codes locally, from secrets that never leave the
machine.

TTY display has three modes — `discreet`, `visible` and `none` — so a code can be
shown, partly masked, or withheld entirely depending on who can see the screen.

Secrets are handled through `zeroize`, so they are overwritten rather than left
sitting in freed memory.

## Two codes, in both directions

The prompt **shows the current valid code and also asks you for one.** That is
not redundancy, and it is worth understanding before you set the display mode to
`none`.

An ordinary 2FA prompt only proves *you* hold the secret. It proves nothing about
the machine, so a convincing fake prompt — a hostile initramfs, a shoulder-surfed
login screen, an SSH session to somewhere you did not mean to go — harvests a
code from you and you learn nothing. Showing the code first inverts that: if the
number on the screen does not match the one in your authenticator, **the thing
asking does not hold the secret, and you should not answer it.**

So: the display half authenticates the machine to you, and the entry half
authenticates you to the machine.

`--double-check` additionally requires two *consecutive* codes, which means an
attacker who captured a single code over your shoulder cannot use it alone.

Set the display to `none` on a screen other people can see. You lose the check on
the machine, which is a real trade — make it deliberately.

## Choosing an authenticator app

Use one that is open source and works offline: **Aegis** (Android) or
**FreeOTP** (Android, iOS) are the usual choices, and both let you export an
encrypted backup you control.

Avoid an authenticator that syncs seeds to a vendor's cloud. If the seed leaves
your device, the second factor is only as strong as that vendor's security and
their willingness to refuse a request for it — which is most of what a second
factor is supposed to remove. If you are hardening a machine to this degree, that
trade does not make sense.

`--hash=SHA256` at setup is the strongest option here and the default. SHA-1 is
offered only because some older authenticators still refuse anything else; if
yours accepts SHA-256, use it.

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
cd Unix-SIT/security-tools/libre-otp
cargo build --release --locked
```

[docs/building-from-source.md](../../docs/building-from-source.md) has the exact
toolchain and the `SOURCE_DATE_EPOCH` setting that makes the output
byte-identical to the published binary.

## Usage

```
  -i, --interactive   Launch the GUI dashboard (Wayland/Xorg)
  -h, --help          Full argument list
  -V, --version       Version
```

```bash
libre-otp --help
```

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify libre-otp.sig libre-otp
sha512sum -c libre-otp.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## A second factor for SSH, without PAM

`--gate` is meant for sshd's `ForceCommand`. sshd authenticates the key as
usual, then runs this instead of the user's command; only a correct code reaches
an exec of the real session.

```
# /etc/ssh/sshd_config
Match User you
    ForceCommand /usr/local/bin/libre-otp --gate
```

```bash
sudo sshd -t && sudo systemctl reload sshd
```

`scp`, `rsync` and `git push` keep working: `SSH_ORIGINAL_COMMAND` is passed to
your shell with `-c` exactly as sshd would have. An interactive login gets a
login shell. Nothing is printed on success, because anything on stdout would be
prepended to the client's stream and corrupt a transfer.

> [!WARNING]
> **Keep a second session open while you test this.** A mistake in
> `sshd_config` locks you out of a remote machine. `sshd -t` validates the file
> before you reload, and reloading does not drop existing connections — so open
> a second terminal, confirm you can still get in, and only then close the
> first.

### Why a ForceCommand and not a PAM module

This crate builds a binary, not a `cdylib`, so there is no `pam_libre_otp.so`
and there never was — see *Honest limitations* below. A `ForceCommand` gate does
the same job with what actually exists, and it has one property PAM does not:
the check runs **after** key authentication, so a wrong code costs an attacker a
valid private key first.

It also has a real limit. `ForceCommand` applies to the session, not to
authentication, so anything that bypasses the session bypasses the gate —
port forwarding and `-N`, for example, do not run a command at all. If you need
those blocked, disable them in `sshd_config` alongside this:

```
Match User you
    ForceCommand /usr/local/bin/libre-otp --gate
    AllowTcpForwarding no
    PermitTunnel no
    X11Forwarding no
```

## Honest limitations

Three things this README used to claim that were **not true**. They are
corrected here rather than quietly deleted, because someone may have acted on
them:

* **There is no PAM module.** The README told you to add
  `auth required pam_libre_otp.so` to `/etc/pam.d/sshd`. No such module exists —
  this crate builds a binary, not a `cdylib`. Following that instruction adds a
  line referencing a missing module to your SSH auth stack, which can lock you
  out of the machine. If you did this, remove that line.
* **There is no YubiKey support.** HMAC-SHA1 challenge-response with a hardware
  token is not implemented anywhere in this crate.
* **`--interactive` did not work.** The dashboard was fully written but nothing
  ever called it, so clap rejected the flag as unknown. That is fixed.

A PAM module is still not built. `--gate` covers the SSH case with what exists
today, and its limits are stated above rather than glossed over. If a PAM module
is written later, this README will say so then and not before.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
