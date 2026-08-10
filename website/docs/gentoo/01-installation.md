# Gentoo — installation

> **🚧 Work in progress.** This page is written and checked against the Gentoo
> Handbook, but the generator and walkthrough do **not** yet emit Gentoo
> commands for every step. Read this; do not assume the generated script matches
> it yet. Use the Arch guide for an actual install.

**The authority for Gentoo is the Gentoo Handbook:**
<https://wiki.gentoo.org/wiki/Handbook:AMD64>. Where this page and the Handbook
disagree, the Handbook is right and this is a bug worth reporting.

---

## What makes Gentoo different, and why you would want that

Gentoo is a **source distribution**. Two consequences shape the whole install:

- **You compile the kernel, and you can compile every package**, built for the
  machine it will run on rather than for the oldest CPU the distribution still
  supports. `USE` flags decide which optional features are compiled in at all,
  so a package can be built without the parts you do not want — no PulseAudio
  support, no X11 support, no systemd support — rather than merely not using
  them.
- **The init system is a real choice.** OpenRC or systemd, decided by the
  profile you select, and it changes every service command from that point on.

There is an escape hatch, and it is a supported workflow rather than a
concession: **binary packages** via `--getbinpkg`, for the handful nobody
sensibly compiles.

| Package | Compiling from source, roughly |
|---|---|
| Firefox | several hours |
| LibreOffice | several hours |
| Chromium | the better part of a day on a laptop |
| Rust, LLVM | hours, and needed by other things |

Those figures depend entirely on your CPU and `MAKEOPTS`. Treat them as "plan
your evening", not as measurements.

---

## 1. Boot the installer, and get a network

Same shape as any Linux install: boot the minimal ISO, confirm you are in UEFI
mode if you expect to be, and get online.

```bash
ls /sys/firmware/efi/efivars    # exists => booted UEFI
ping -c3 gentoo.org
```

## 2. Partition and encrypt

**This part carries over from Arch unchanged.** Gentoo is Linux: LUKS2 with
Argon2id, ext4 / Btrfs / XFS, and the same bootloaders. Follow the partitioning
and encryption pages in this repo — they apply here exactly as written.

One difference to note now, because it bites later:

> **Gentoo mounts the EFI system partition at `/efi`, not `/boot`.** `/boot`
> stays on the root filesystem. Arch puts the kernel directly on the ESP; Gentoo
> does not. Mounting it the Arch way produces a system that builds fine and does
> not boot.

## 3. Unpack the stage3 tarball

The base system is not a package transaction. It is a signed tarball.

```bash
cd /mnt/gentoo
# Choose a mirror:  https://www.gentoo.org/downloads/mirrors/
# Newest tarball under:
#   releases/amd64/autobuilds/current-stage3-amd64-openrc/
wget <stage3-url>
wget <stage3-url>.asc

gpg --import /usr/share/openpgp-keys/gentoo-release.asc
gpg --verify stage3-*.tar.xz.asc stage3-*.tar.xz
```

> **Do not skip the signature.** This tarball becomes every binary on the
> machine. A substituted one is not a corrupted download, it is a system that
> belongs to somebody else from first boot.

The release engineering key fingerprint, from
<https://www.gentoo.org/downloads/signatures/>:

```
13EBBDBEDE7A12775DFDB1BABB572E0E2D182910
```

Then unpack it — the flags are not optional:

```bash
tar xpvf stage3-*.tar.xz --xattrs-include='*.*' --numeric-owner -C /mnt/gentoo
```

| Flag | Why it is there |
|---|---|
| `-p` | preserve permissions |
| `--xattrs-include='*.*'` | keep extended attributes in every namespace |
| `--numeric-owner` | keep the ids as built, rather than remapping them to whatever the live environment calls those names |

Unpacking without these gives a system that boots and then fails in ways that
look unrelated to the tarball.

### Which stage3?

| Variant | Pick it when |
|---|---|
| `openrc` | You want OpenRC. Gentoo's own init, and the common choice. |
| `systemd` | You want systemd, or you want the closest thing to the Arch experience. |
| `hardened` | You want the hardened toolchain and profile. More friction, more defence. |
| `musl` | You know why you want musl. Smaller ecosystem; expect to solve problems yourself. |

The stage3 and the profile must agree. An openrc stage3 with a systemd profile
is the most common way a first Gentoo install goes wrong.

## 4. Configure the compile options

`/etc/portage/make.conf` is where the "built for this machine" part happens.

```bash
nano /mnt/gentoo/etc/portage/make.conf
```

```sh
COMMON_FLAGS="-O2 -pipe -march=native"
MAKEOPTS="-j$(nproc)"
USE="-systemd elogind"
GRUB_PLATFORMS="efi-64"
```

- **`-march=native`** builds for the CPU doing the building. Do not use it if
  you intend to move the disk to a different machine, or to build packages on
  one box for another.
- **`MAKEOPTS="-jN"`** is parallel build jobs. `-j$(nproc)` is the usual
  starting point. Each job can want around 2 GB of RAM when linking, so on a
  machine with many cores and little memory, lower it or you will meet the OOM
  killer partway through a long build.
- **`USE`** is the important one. A leading `-` removes a flag globally.
- **`GRUB_PLATFORMS="efi-64"`** is needed *before* emerging GRUB on UEFI.

## 5. Enter the chroot

There is no `arch-chroot` here. The bind mounts are done by hand.

```bash
mount --types proc /proc /mnt/gentoo/proc
mount --rbind /sys /mnt/gentoo/sys
mount --make-rslave /mnt/gentoo/sys
mount --rbind /dev /mnt/gentoo/dev
mount --make-rslave /mnt/gentoo/dev
mount --bind /run /mnt/gentoo/run
mount --make-slave /mnt/gentoo/run

chroot /mnt/gentoo /bin/bash
source /etc/profile
export PS1="(chroot) ${PS1}"
```

> The `--make-rslave` lines are not decoration. Without them, unmounting later
> in the live environment can propagate into the mounts you are still using.

## 6. Package tree and profile

```bash
emerge-webrsync
eselect profile list
eselect profile set <number>
```

Pick the profile matching your stage3 and your init choice. Then bring the
system up to date:

```bash
emerge --verbose --update --deep --changed-use @world
```

With binary packages where they exist:

```bash
emerge --verbose --update --deep --newuse --getbinpkg @world
```

## 7. Timezone, locale, hostname

```bash
ln -sf ../usr/share/zoneinfo/Region/City /etc/localtime

nano /etc/locale.gen        # uncomment the locales you want
locale-gen
eselect locale list
eselect locale set <number>

env-update && source /etc/profile && export PS1="(chroot) ${PS1}"

echo "yourhostname" > /etc/hostname
```

## 8. The kernel

Three routes, and they are genuinely different amounts of work.

| Route | Atom | What you get |
|---|---|---|
| Binary | `sys-kernel/gentoo-kernel-bin` | Prebuilt. Fastest, and the sensible first install. |
| Distribution, from source | `sys-kernel/gentoo-kernel` | Gentoo's config, compiled locally. Needs `USE="dist-kernel"`. |
| Manual | `sys-kernel/gentoo-sources` | You run `make menuconfig`. Full control, full responsibility. |

```bash
emerge --verbose sys-kernel/linux-firmware
emerge --verbose sys-kernel/gentoo-kernel-bin
```

Manual route:

```bash
emerge --verbose sys-kernel/gentoo-sources sys-apps/pciutils
cd /usr/src/linux
make menuconfig
make -j$(nproc) && make modules_install
make install
```

> A manually configured kernel missing the driver for your disk controller, your
> filesystem, or `dm-crypt` will not boot and will not tell you which one is
> missing. If this is your first Gentoo install, take the binary kernel and come
> back to `menuconfig` once the machine is up.

### Initramfs

Gentoo has no `mkinitcpio`. Dracut does the job, pulled in through
`sys-kernel/installkernel`:

```bash
echo "sys-kernel/installkernel dracut" >> /etc/portage/package.use/installkernel
emerge --verbose sys-kernel/installkernel
```

With an encrypted root, name the modules rather than relying on autodetection:

```bash
mkdir -p /etc/dracut.conf.d
cat > /etc/dracut.conf.d/luks.conf <<'EOF'
add_dracutmodules+=" crypt dm rootfs-block "
EOF
```

## 9. Bootloader

```bash
emerge --verbose sys-boot/grub
```

UEFI:

```bash
grub-install --efi-directory=/efi
grub-mkconfig -o /boot/grub/grub.cfg
```

BIOS:

```bash
grub-install /dev/sda
grub-mkconfig -o /boot/grub/grub.cfg
```

If `grub-install` reports the wrong platform, `GRUB_PLATFORMS` was not set
before GRUB was emerged. Fix `make.conf` and re-emerge it.

## 10. System tools and services

The service commands depend on the init you chose.

| | OpenRC | systemd |
|---|---|---|
| Enable at boot | `rc-update add <name> default` | `systemctl enable <name>` |
| Start now | `rc-service <name> start` | `systemctl start <name>` |
| Status | `rc-service <name> status` | `systemctl status <name>` |
| Logs | `/var/log/messages` (sysklogd) | `journalctl` |

```bash
emerge --verbose app-admin/sysklogd sys-process/cronie
rc-update add sysklogd default
rc-update add cronie default
```

On systemd, neither is needed: `systemd-journald` is the logger and timers
replace cron.

Networking:

```bash
emerge --verbose net-misc/networkmanager
rc-update add NetworkManager default        # OpenRC
systemctl enable NetworkManager             # systemd
```

## 11. Root password, then reboot

```bash
passwd
exit
umount -R /mnt/gentoo
reboot
```

---

## Package names

Gentoo atoms carry a category, and it is part of the name. `emerge vim` and
`emerge app-editors/vim` are not reliably the same request — more than one
category can hold a package with a given name, and portage will stop and ask
rather than guess.

| Arch | Gentoo |
|---|---|
| `vim` | `app-editors/vim` |
| `sudo` | `app-admin/sudo` |
| `cryptsetup` | `sys-fs/cryptsetup` |
| `btrfs-progs` | `sys-fs/btrfs-progs` |
| `xfsprogs` | `sys-fs/xfsprogs` |
| `networkmanager` | `net-misc/networkmanager` |
| `grub` | `sys-boot/grub` |
| `efibootmgr` | `sys-boot/efibootmgr` |
| `intel-ucode` | `sys-firmware/intel-microcode` |
| `amd-ucode` | ships inside `sys-kernel/linux-firmware` |

Search the real thing rather than trusting a table:
<https://packages.gentoo.org/>.

## What does not carry over from the Arch guide

- **No AUR, so no `aur-guard`.** Gentoo's equivalent surface is overlays and
  ebuilds. An ebuild auditor would be a different tool, not a port.
- **No `pacman`, `pacstrap`, `arch-chroot`, `genfstab` or `mkinitcpio`.**
- **`/etc/fstab` is written by hand.** Use `blkid` for the UUIDs, and read it
  back before you trust it.
- **Dusky works here.** `gui-wm/hyprland` is in the Gentoo repositories, so the
  desktop is available — its install steps need translating from pacman and the
  AUR into `emerge` plus USE flags.

## Sources

- Gentoo Handbook, AMD64: <https://wiki.gentoo.org/wiki/Handbook:AMD64>
- Stage tarball and verification:
  <https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Stage>
- Base system, chroot, profile:
  <https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Base>
- Kernel: <https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Kernel>
- Bootloader:
  <https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Bootloader>
- System tools: <https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Tools>
- Release signatures: <https://www.gentoo.org/downloads/signatures/>
- Package search: <https://packages.gentoo.org/>
