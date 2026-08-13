# Gentoo Command Cheatsheet

> [!TIP]
> The [Gentoo Handbook](https://wiki.gentoo.org/wiki/Handbook:AMD64) is the
> authority. Where this page and the Handbook disagree, the Handbook is right
> and this is a bug worth reporting.

## Packages (Portage)

- **Sync the tree**: `sudo emerge --sync`
- **Update everything**: `sudo emerge --verbose --update --deep --changed-use @world`
- **Install**: `sudo emerge --verbose app-editors/vim`
- **Install only if absent**: `sudo emerge --verbose --noreplace app-editors/vim`
- **Search**: `emerge --search vim` — or `equery list '*vim*'` for what is installed
- **What would this pull in?**: `emerge --pretend --verbose --tree app-office/libreoffice`
- **Remove**: `sudo emerge --deselect app-editors/vim` then `sudo emerge --depclean`
- **Clean the caches**: `sudo eclean-dist --deep && sudo eclean-pkg --deep`

> [!WARNING]
> `emerge --unmerge` removes a package without consulting what depends on it.
> `--deselect` plus `--depclean` is the safe pair; `--unmerge` is for when you
> mean it.

### The category is part of the name

`emerge vim` and `emerge app-editors/vim` are not reliably the same request:
more than one category can hold a package with the same name, and Portage will
ask you to disambiguate. Write the category.

### Binary packages

Portage can take a prebuilt package where one is published and build the rest.

- **Once**: `sudo emerge --getbinpkg www-client/firefox`
- **Always**: `FEATURES="getbinpkg"` in `/etc/portage/make.conf`

The five that are most of the wait: `www-client/firefox`,
`www-client/chromium`, `app-office/libreoffice`, `dev-lang/rust`,
`sys-devel/llvm`. Chromium alone can be the better part of a day on a laptop.

## make.conf

`/etc/portage/make.conf` is where the machine-wide build decisions live.

```
COMMON_FLAGS="-O2 -pipe -march=native"
MAKEOPTS="-j$(nproc)"
USE="elogind dbus policykit -systemd"
```

- **`-march=native`** builds for the CPU doing the building. Do not use it if
  the disk will move to another machine, or if you build packages here for
  another box.
- **`MAKEOPTS`** is a memory decision as much as a speed one: a build job can
  want around 2 GB when it links, so the usual rule is the lower of your core
  count and half your RAM in GB. `-j1` is the setting that always finishes.

## USE flags

USE decides which optional features are **compiled in at all**, not merely
which are enabled. A package built without `pulseaudio` does not contain it,
and turning the flag on later means rebuilding everything that would have
depended on it.

- **What flags does this package have?**: `equery uses media-video/mpv`
- **Why is this flag set?**: `euse -i pulseaudio` (`app-portage/gentoolkit`)
- **Per package, rather than globally**:
  `echo "media-video/mpv pulseaudio" >> /etc/portage/package.use/mpv`
- **After changing USE**: `sudo emerge --update --deep --changed-use @world`

## Profiles

The profile sets the default USE flags, the init system and the toolchain
defaults. It has to match the stage3 tarball you unpacked.

- **List**: `eselect profile list`
- **Set**: `sudo eselect profile set 9`
- **Which am I on?**: `eselect profile show`

Choosing the systemd profile over an OpenRC stage3 — or the reverse — is the
most common way a first Gentoo install goes wrong.

## The kernel

Gentoo does not ship you a kernel by default. There are three routes, and they
are genuinely different amounts of work.

### 1. `sys-kernel/gentoo-kernel-bin` — prebuilt

```bash
sudo emerge --verbose sys-kernel/gentoo-kernel-bin
```

Gentoo's configuration, already compiled. Minutes rather than hours, and it
boots. Start here on a first install and come back to `menuconfig` once the
machine is up.

### 2. `sys-kernel/gentoo-kernel` — Gentoo's config, built here

```bash
sudo emerge --verbose sys-kernel/gentoo-kernel
```

The same configuration compiled locally so it matches your `CFLAGS`. A long
build, and no configuration decisions to get wrong.

### 3. `sys-kernel/gentoo-sources` — you run `menuconfig`

```bash
sudo emerge --verbose sys-kernel/gentoo-sources sys-apps/pciutils
cd /usr/src/linux
make menuconfig
make -j"$(nproc)" && sudo make modules_install
sudo make install
```

> [!CAUTION]
> A configuration missing the driver for your disk controller, your filesystem,
> or `dm-crypt` will not boot and will not tell you which one is absent. Check
> those three before you leave `menuconfig`. `lspci -k` and `lsmod` on a working
> system tell you what is actually in use.

### Kernel housekeeping

- **Which sources am I building?**: `eselect kernel list` / `sudo eselect kernel set 1`
- **Rebuild out-of-tree modules after a kernel change**: `sudo emerge @module-rebuild`
- **What is running now?**: `uname -r`
- **Old kernels take up /boot**: remove the versioned directories under
  `/usr/src` and the entries in `/boot` you no longer boot, then regenerate the
  bootloader configuration.

### The initramfs is dracut, not mkinitcpio

Dracut arrives through `sys-kernel/installkernel` with its `dracut` USE flag,
and rebuilds itself whenever a kernel is installed — so in the ordinary case
there is nothing to run by hand.

```bash
echo "sys-kernel/installkernel dracut" >> /etc/portage/package.use/installkernel
sudo emerge --verbose --noreplace sys-kernel/installkernel

# Encrypted root: name the modules rather than relying on detection
sudo mkdir -p /etc/dracut.conf.d
echo 'add_dracutmodules+=" crypt dm rootfs-block "' | \
  sudo tee /etc/dracut.conf.d/luks.conf

sudo dracut --force          # when you do need to rebuild by hand
```

## Services

Which commands you use depends on the init your stage3 carried, not on the
distribution.

### OpenRC

- **Enable at boot**: `sudo rc-update add sshd default`
- **Start now**: `sudo rc-service sshd start`
- **Status**: `sudo rc-service sshd status`
- **What is enabled?**: `rc-update show`
- **Logs**: `/var/log/` — there is no journal. `app-admin/sysklogd` is the usual
  choice, and nothing is logged until something is installed to do it.

There are **no timers** under OpenRC. A repeating job is a cron entry
(`sys-process/cronie`), not a `.timer` unit.

### systemd

- **Enable**: `sudo systemctl enable sshd`
- **Start now**: `sudo systemctl enable --now sshd`
- **Logs**: `journalctl -u sshd -e`

## Overlays

An ebuild in an overlay has to be enabled before Portage can see it.

```bash
sudo emerge --verbose --noreplace app-eselect/eselect-repository
eselect repository list                  # what exists
sudo eselect repository enable guru      # user-contributed
sudo emerge --sync guru
```

GURU is where several things this project offers live — `app-editors/vscodium`,
`www-client/ungoogled-chromium`, `gui-apps/wlogout`. LibreWolf publishes its
own overlay rather than living in GURU.

## Disks and filesystems

- **Btrfs snapshots**: `sudo snapper -c root create -d "before update"` — `snapper ls`
- **UUIDs for fstab**: `blkid` — Gentoo has no `genfstab`, so `/etc/fstab` is
  written by hand and worth reading back before you trust it.
- **Open a LUKS volume**: `sudo cryptsetup open /dev/sda2 cryptroot`

## Security suite tools

- **Check Anti-Ducky**: `sudo rc-service anti-ducky status` (OpenRC) or
  `journalctl -u anti-ducky -e` (systemd)
- **Re-seal the boot baseline after a kernel update**: `sudo anti-evil-maid --setup`
- **Lock the volume now**: `sudo anti-evil-maid --lock-now`

> [!NOTE]
> Portage has no per-package post-install hook equivalent to pacman's, so
> re-sealing after a kernel update is a step you take rather than one that
> happens for you. An unre-sealed baseline makes every update look like
> tampering, and a warning that cries wolf gets ignored before the day it
> matters.

## When something breaks

- **A build fails on memory**: lower `MAKEOPTS`, then retry. `-j1` finishes.
- **Blocked packages**: read the block message — it names both sides. Usually
  `--deselect` on the one you no longer want, then `--depclean`.
- **Changed USE, nothing rebuilt**: `--changed-use` is the flag that notices.
- **Config file conflicts after an update**: `sudo dispatch-conf` (never
  `etc-update -a` without looking).
- **What owns this file?**: `equery belongs /usr/bin/vim`
