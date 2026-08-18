# Generated examples

These are real output from the [manual walkthrough](https://tilas01.github.io/Unix-SIT/manual.html)
and the [generator](https://tilas01.github.io/Unix-SIT/index.html),
committed so you can read what they produce without running anything.

Each example exists in both forms the site offers:

* **`.md`** — the guide. Every command with the reason it is there. Read this one.
* **`.sh`** — the same commands as a runnable script, built by extracting the
  fenced blocks from that same markdown, so the two cannot disagree.

> **These are examples, not something to run.** Every one of them partitions
> `/dev/nvme0n1` and sets the hostname to `archbox`. Generate your own, with
> your own disk, or read these and adapt.

## Why twelve and not all of them

The walkthrough has **578** distinct answer combinations across the axes that
actually change the output. All 578 are verified on every test run — 11,695
content assertions, and every generated script parsed by `bash -n`. Committing
1,156 near-identical files would bury the repository in content nobody reads and
that every diff has to scroll past. What belongs here is a sample that covers
each branch at least once and can be reviewed by eye.

Regenerate with:

```bash
node scripts/gen-examples.mjs
```

## The examples

| Example | What it demonstrates |
|---|---|
| [`01-recommended-desktop`](01-recommended-desktop.md) · [script](01-recommended-desktop.sh) | The recommended baseline: x86_64, whole disk, LUKS2, Btrfs with snapshots, UKI with your own Secure Boot keys. |
| [`02-dual-boot-windows`](02-dual-boot-windows.md) · [script](02-dual-boot-windows.sh) | Alongside an existing Windows install. Shares the EFI system partition and never formats it; adds the Fast Startup, BitLocker and clock steps. |
| [`03-dual-boot-linux`](03-dual-boot-linux.md) · [script](03-dual-boot-linux.sh) | Alongside another Linux distribution, sharing the ESP and the bootloader. |
| [`04-unencrypted-ext4`](04-unencrypted-ext4.md) · [script](04-unencrypted-ext4.sh) | No encryption, ext4, systemd-boot. A desktop that never leaves the room. |
| [`05-luks1-legacy-bios`](05-luks1-legacy-bios.md) · [script](05-luks1-legacy-bios.sh) | Legacy BIOS with GRUB and LUKS1 — the constrained path, for firmware with no UEFI. |
| [`06-headless-server`](06-headless-server.md) · [script](06-headless-server.sh) | No GUI, no audio, nftables, OpenSSH hardened. A server. |
| [`07-libre-only`](07-libre-only.md) · [script](07-libre-only.sh) | Strictly libre: no microcode, no proprietary drivers, no proprietary applications. |
| [`08-duskyos`](08-duskyos.md) · [script](08-duskyos.sh) | Dusky, the one preconfigured desktop this project installs. Shows which options it fixes for you. |
| [`09-arm-raspberry-pi`](09-arm-raspberry-pi.md) · [script](09-arm-raspberry-pi.sh) | aarch64 on a Raspberry Pi: no ISO, no microcode, EEPROM firmware, config.txt instead of an EFI loader. |
| [`10-arm-uboot-sbc`](10-arm-uboot-sbc.md) · [script](10-arm-uboot-sbc.sh) | aarch64 on a generic U-Boot single-board computer, booting via extlinux.conf and a device tree. |
| [`11-arm-uefi`](11-arm-uefi.md) · [script](11-arm-uefi.sh) | aarch64 on a board whose firmware implements UEFI — the closest ARM gets to the x86 path. |
| [`12-maximum-hardening`](12-maximum-hardening.md) · [script](12-maximum-hardening.sh) | Every non-destructive protection on: own Secure Boot keys, the whole security suite, UFW, snapshots, BusKill set to lock. |

## What each one chose

| Example | Arch | Alongside | Encryption | Filesystem | Bootloader | Desktop |
|---|---|---|---|---|---|---|
| `01-recommended-desktop` | x86_64 | none | luks2 | btrfs | uki | hyprland |
| `02-dual-boot-windows` | x86_64 | windows | luks2 | btrfs | uki | hyprland |
| `03-dual-boot-linux` | x86_64 | linux | luks2 | btrfs | uki | hyprland |
| `04-unencrypted-ext4` | x86_64 | none | none | ext4 | systemd-boot | hyprland |
| `05-luks1-legacy-bios` | x86_64 | none | luks1 | btrfs | grub | hyprland |
| `06-headless-server` | x86_64 | none | luks2 | btrfs | uki | none |
| `07-libre-only` | x86_64 | none | luks2 | btrfs | uki | hyprland |
| `08-duskyos` | x86_64 | none | luks2 | btrfs | uki | dusky |
| `09-arm-raspberry-pi` | aarch64 | none | luks2 | btrfs | rpi-firmware | hyprland |
| `10-arm-uboot-sbc` | aarch64 | none | luks2 | btrfs | extlinux | hyprland |
| `11-arm-uefi` | aarch64 | none | luks2 | btrfs | efi-arm | hyprland |
| `12-maximum-hardening` | x86_64 | none | luks2 | btrfs | uki | hyprland |
