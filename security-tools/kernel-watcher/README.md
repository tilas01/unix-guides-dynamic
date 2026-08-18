<div align="center">
  <img src="assets/banner.png" width="880" alt="Kernel Watcher">
</div>

# Kernel Watcher

Asynchronous filesystem monitor that flags infostealers reading browser profiles, SSH keys and wallets, and userland rootkit behaviour.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

Most credential theft on a desktop Linux machine is not exotic. It is a process
reading `~/.ssh/id_*`, `~/.mozilla`, a browser's `Login Data` or a wallet
directory and sending the contents somewhere. `kernel-watcher` watches those
paths and reports who touched them.

Destructive controls are behind a master password stored as an Argon2id hash
(m=64MiB, t=3, p=4, well above the OWASP floor) written at 0600, so a stolen
hash is expensive to attack offline.

### Outbound connection monitor

A Little Snitch-style prompt for Linux. It watches for *new* outbound
connections, maps each back to the program that opened it, and asks once per
program whether to allow it out. The decision is remembered
(`connections.json`), so you are asked once, not on every connection. Deny kills
the process and installs an nftables drop rule for the destination.

The prompt works **anywhere** — a graphical session under Wayland or Xorg, or a
bare TTY over SSH with no display server at all. On a machine with no terminal
to ask on (an unattended daemon), it fails safe by denying: an unattended box
should not be quietly letting new programs onto the network.

It is honest about what it is: a userland monitor that reacts once the kernel
has a socket, not an in-path firewall that holds the packet while you decide. A
program that reconnects in the millisecond before the kill lands may get one
packet out. For hard, before-the-fact blocking, pair it with an nftables policy
or use opensnitch's kernel module.

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
cd Unix-SIT/security-tools/kernel-watcher
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

Run with no arguments to start the daemon:

```bash
sudo kernel-watcher
```

Or open the dashboard:

```bash
kernel-watcher --interactive
```

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify kernel-watcher.sig kernel-watcher
sha512sum -c kernel-watcher.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## Honest limitations

The eBPF paths have **not** been independently reviewed. Treat the filesystem
monitoring as the part that has had attention.

Monitoring is detection, not prevention — even the connection monitor above is a
reaction to a socket that already exists, not a gate in front of it. A process
that has already read your SSH key has already read it; what this buys you is
knowing, and knowing quickly. For prevention, look at AppArmor profiles, an
nftables default-deny policy — and at not running the thing.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
