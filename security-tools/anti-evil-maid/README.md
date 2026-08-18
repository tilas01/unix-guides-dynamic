<div align="center">
  <img src="assets/banner.png" width="880" alt="Anti-Evil Maid">
</div>

# Anti-Evil Maid

Verifies that `/boot` has not been modified while the machine was out of your hands, before you type the passphrase that unlocks the disk.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

An evil-maid attack does not need your disk password. It needs five minutes with
your powered-off laptop to modify the unencrypted boot partition so that the
*next* thing you type is captured. Full-disk encryption does not help here,
because `/boot` is what the firmware reads first and it cannot be encrypted by
the disk it is unlocking.

`anti-evil-maid` records a deterministic hash of `/boot` while you know the
machine is clean, and re-checks it at boot. The hash is order-stable,
path-committed and length-prefixed, so an unchanged `/boot` always produces the
same value.

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
cd Unix-SIT/security-tools/anti-evil-maid
cargo build --release --locked
```

[docs/building-from-source.md](../../docs/building-from-source.md) has the exact
toolchain and the `SOURCE_DATE_EPOCH` setting that makes the output
byte-identical to the published binary.

## Usage

```
  --setup                Record the current boot chain as the trusted baseline
  --daemon               Verify the boot chain against the baseline, then exit
  --fs-hash-check        Deep filesystem hash verification
  --lock-now             Suspend the LUKS volume: flush the master key from RAM
  --configure-autolock   Set up the auto-lock timer and session-lock hook
  --install-lock-hook    Suspend LUKS whenever the session locks
  --suspend-only         Suspend and exit, without holding the resume prompt
  --autolock-status      Show the current auto-lock settings
  --idle <INTERVAL>      15m, 1h, 2d3h, or "never"
  --mapper <NAME>        Device-mapper name, as in /dev/mapper/<name>
  -i, --interactive      Launch the GUI dashboard (Wayland/Xorg)
  -h, --help             Full argument list
  -V, --version          Version
```

Record a baseline while you know the machine is clean:

```bash
sudo anti-evil-maid --setup
```

Or open the dashboard:

```bash
anti-evil-maid --interactive
```

## Locking the disk, not just the screen

Locking your session leaves the LUKS master key sitting in kernel memory. Anyone
who reaches the running machine — a DMA-capable port, a cold-boot attack on the
DIMMs, a kernel bug — recovers it and with it the disk. The lock screen is a UI,
not a cryptographic boundary.

`--lock-now` runs `cryptsetup luksSuspend`, which wipes the master key from
kernel memory and freezes I/O until the passphrase is supplied again. After it,
the data is as protected as it is when the machine is off.

```bash
sudo anti-evil-maid --configure-autolock --idle 15m
sudo systemctl enable --now anti-evil-maid-autolock.timer
```

`--configure-autolock` also writes `/usr/local/bin/anti-evil-maid-on-lock`, which
you can point your screen locker at so the key stops being resident the moment
you lock the session.

### Make the lock screen a real barrier

A lock screen hides the desktop and asks for your login password. It does
nothing to the LUKS master key, which stays in kernel memory the whole time you
are away. `--install-lock-hook` wires the two together: a watcher for logind's
`Lock` signal suspends the volume the moment the screen locks, so getting back
in needs the *disk passphrase*, not just your login password.

```bash
command -v dbus-monitor || sudo pacman -S --needed dbus
sudo anti-evil-maid --install-lock-hook
sudo systemctl enable --now anti-evil-maid-lock-watch.service
```

It listens for the signal rather than polling, so there is no timer-shaped gap
between locking the screen and the key going away. Installed disabled.

### `--suspend-only`

Suspends and returns, without holding the resume prompt — for a caller that is
about to power the machine off, which is what `anti-ducky --set-response
lockdown` uses. Holding a passphrase prompt there would stop the shutdown from
ever happening.

**After it returns the disk is frozen.** The caller must touch nothing on it.
Writes to `/proc` and `/sys` still work, which is why the power-off that follows
uses the sysrq trigger rather than `/sbin/poweroff`.

> **Test this while you can still reach the machine physically.** Suspending the
> volume that backs `/` freezes every disk read until you type the passphrase.
> The tool stages `cryptsetup` and its libraries into tmpfs and locks its own
> pages into RAM first, precisely so the resume path is never read from the
> device it just froze — but a mistake here still costs a power cycle.

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify anti-evil-maid.sig anti-evil-maid
sha512sum -c anti-evil-maid.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## Honest limitations

It **fails closed**. A missing baseline is reported as "cannot verify", not as
"verified". An earlier version returned success when the baseline file was
absent, which meant an attacker could disable the entire check by deleting one
file in `/etc` — considerably easier than modifying `/boot` convincingly.

The hash also had to be made deterministic. `WalkDir` order is not stable, so
the original contents-only hash produced *false* alerts on an unchanged `/boot`.
A tamper alarm that cries wolf is worse than none, because it trains you to
click through the one that matters.

This detects modification. It cannot prevent it, and it cannot protect you from
an attacker who also replaces this binary. For a defence that holds when the
firmware itself is untrusted you need measured boot: coreboot plus
[Heads](https://osresearch.net/), a TPM, and a hardware token.

### The unlock delay is not phone-grade brute-force protection

The resume prompt allows four attempts, then imposes a delay that doubles from
30 seconds to a ceiling of one hour. That raises the cost of someone typing at
**your running machine's** prompt. It is worth having and it is all it is.

It is not equivalent to the brute-force resistance of a phone, and the
comparison is worth spelling out because it is easy to assume otherwise.
GrapheneOS's escalating delays are enforced by a **secure element** (Titan M /
Weaver) that rate-limits key derivation in hardware. Bypassing the OS does not
bypass the delay, because the OS is not the thing enforcing it.

A generic PC has no such component. An attacker who images your disk attacks the
LUKS header **offline**, at whatever rate their hardware allows, and this delay
is simply not present in that attack. What actually defends an imaged header is:

- **The KDF cost.** LUKS2 with Argon2id and a high memory cost is what makes each
  offline guess expensive. The generators emit `--pbkdf argon2id`; raising
  `--iter-time` and the memory cost raises the floor further.
- **A TPM-sealed keyslot with a TPM-enforced lockout**
  (`systemd-cryptenroll --tpm2-pin=yes`). This is the nearest thing to a secure
  element on a PC, because the counter lives somewhere the OS cannot reach.
- **A passphrase strong enough to survive offline Argon2id attack**, which is
  worth more than any of the above.

The delay in this tool protects the live prompt. Nothing more.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
