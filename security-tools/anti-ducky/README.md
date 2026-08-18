<div align="center">
  <img src="assets/banner.png" width="880" alt="Anti-Ducky">
</div>

# Anti-Ducky

Watches USB HID keystroke timing and sandboxes unknown input devices, so a BadUSB / Rubber Ducky cannot type its payload.

Part of the [*nix Install Guides](../../) security suite. Everything here is
Rust, builds reproducibly, and ships as a signed release binary.

---

## What it does

`anti-ducky` reads input devices through `evdev` and looks at *how* they type.
A human hitting keys produces irregular inter-keystroke intervals; a firmware
implant replaying a payload does not. Devices that appear mid-session and
immediately type at machine speed are held back rather than trusted.

An unlock path exists for the legitimate case where you really did just plug in
a new keyboard. It is guarded by a PIN stored as an Argon2id hash at
`/etc/arch-security/anti-ducky/unlock.hash` (0600) and it **fails closed**: if
no PIN has been configured, nothing is unlocked.

### Active response — deauthorize and capture

Detection is only half of it. On a confirmed payload — including the harder case
of an implant that *spoofs an already-approved keyboard's identity* — the
injected keystrokes are captured to a forensic log, then the
device is **deauthorized at the kernel** via
`/sys/bus/usb/devices/<dev>/authorized`. The kernel stops accepting its input;
it can no longer type. This is the same mechanism `usbkill` and USBGuard use,
and it is reversible (`echo 1` to the same node, or replug a device you trust).

It deliberately does **not** try to damage or brick the attacking device. That
would be retaliation rather than defence, it rarely works from the host anyway,
and a misfire harms your own hardware. Deauthorizing stops the attack completely
and leaves you the evidence, which is the objective.

### Mouse-jiggler detection

Flags a pointer device whose motion is too *regular* to be a hand — the
signature of a jiggler plugged in to stop an unattended session from locking. A
person's mouse movement is bursty; a jiggler's is metronomic, and that shows up
as an unnaturally low variation in the gaps between movements.

### Hard-shutdown kill switch (opt-in, off by default)

`--arm-kill-switch` makes a confirmed payload trigger an immediate hard
power-off, to clear disk-encryption keys from RAM before anyone can extract
them. It requires typed confirmation to arm, because a false positive shuts the
machine down and takes unsaved work with it.

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
cd Unix-SIT/security-tools/anti-ducky
cargo build --release --locked
```

[docs/building-from-source.md](../../docs/building-from-source.md) has the exact
toolchain and the `SOURCE_DATE_EPOCH` setting that makes the output
byte-identical to the published binary.

## Usage

```
  -i, --interactive          Launch the GUI dashboard (Wayland/Xorg)
  -u, --unlock               Authenticate, then temporarily allow new USB input devices
      --set-unlock-pin       Set or change the unlock PIN (needs root), then exit
      --arm-kill-switch      Arm hard-shutdown-on-attack (typed confirmation; destructive)
      --disarm-kill-switch   Disarm hard-shutdown-on-attack
  -h, --help                 Full argument list
  -V, --version              Version
```

Run with no arguments to start the daemon:

```bash
sudo anti-ducky
```

Or open the dashboard:

```bash
anti-ducky --interactive
```

## Verifying a release binary

```bash
gpg --import tilas01.asc
gpg --fingerprint 5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED   # compare against the root README
gpg --verify anti-ducky.sig anti-ducky
sha512sum -c anti-ducky.sha512
```

The previous signing key `4C0383A1…` is **revoked** — its private half was
committed to public git history. See
[Verifying downloads](../../README.md#-verifying-downloads).

## Response to a confirmed payload

The payload is always captured (with a SHA-256 for chain of custody) and the
device always deauthorized at the kernel. This is what happens *in addition*:

| Response | What it does | Cost if it misfires |
|---|---|---|
| `alert` | Nothing further. | None. |
| `lock` *(recommended)* | Locks every session. | A re-login. Does **not** protect the LUKS key in RAM. |
| `lockdown` | Lock → kernel lockdown → LUKS suspend → power cut. | Unsaved work. |
| `poweroff` | Immediate hard power cut. | Unsaved work, and seconds where the key is still in RAM. |

```bash
sudo anti-ducky --set-response lockdown    # prompts for typed confirmation
sudo systemctl enable anti-ducky-boot-alert.service
```

### Why `lockdown` is ordered the way it is

A bare `poweroff -f` leaves several seconds during which the key is still in
RAM, the desktop is still unlocked behind whatever the payload typed, and
`/dev/mem`, `kexec` and unsigned module loading are all still available.
Lockdown closes each of those first, then cuts power with the kernel's sysrq
trigger — **not** `/sbin/poweroff`, which cannot even be read once the volume is
suspended and would block forever, leaving the machine locked but still running.

The LUKS step is delegated to `anti-evil-maid --suspend-only` rather than
reimplemented: that code stages `cryptsetup` into tmpfs and `mlockall`s first,
and it is the most deadlock-prone code in the project. One copy is enough. If
anti-evil-maid is not installed, lockdown still locks and still powers off — it
just cannot flush the key, and it says so.

### The boot alert is not optional if you use a power-off response

Cutting power takes the on-screen warning with it. Without
`--show-boot-alerts` running from a boot unit, the owner powers back on, finds
no explanation, assumes hardware, and plugs the device back in.

## Honest limitations

**The keystroke-timing thresholds have never been measured on real hardware.**
Its false-positive rate is unknown, and this is the tool standing between you
and the keyboard you log in with. Test it on a machine you can still reach by
other means (SSH, a second keyboard, a live USB) before enabling the daemon on a
machine you depend on. The same caution applies doubly to `--arm-kill-switch`: a
false positive there powers the machine off.

A previous version compared the unlock PIN against the literal string `"1337"`
hardcoded in `main.rs`. That was not authentication — the PIN was published in
the source of a public repository, so anyone could lift the USB block. It is now
an Argon2id hash that you set yourself.

## Licence

CC BY-NC-SA 4.0 — free to use, modify and share non-commercially, with
attribution, under the same licence. See [LICENSE](../../LICENSE).

Provided **AS IS, without warranty of any kind**. These tools can lock you out
of your own machine if misconfigured. Read the
[wiki](https://tilas01.github.io/Unix-SIT/wiki.html) first.
