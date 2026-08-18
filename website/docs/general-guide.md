# 📚 General Arch Linux Installation Guide

This guide serves as a manual fallback for the automated generator. If you prefer to type commands yourself, follow these logical steps based on your selections.

## 1. Pre-Installation
Ensure you have booted the Arch Linux Live ISO with UEFI mode enabled.
```bash
ping -c 3 archlinux.org
timedatectl set-ntp true
```

## 2. Partitioning & Encryption
Depending on your UI selection, you will partition differently:
- **Standard Ext4/Btrfs:** Create `/boot` (EFI, 512MB) and `/` (Linux).
- **LUKS2 Argon2id (Post-Quantum):**
  ```bash
  cryptsetup luksFormat --type luks2 --pbkdf argon2id /dev/sdX2
  cryptsetup open /dev/sdX2 cryptroot
  ```
  *(Note: You **must** select Systemd-boot as your bootloader if using LUKS2 Argon2id!)*

## 3. Base Installation
Mount your partitions and run `pacstrap`:
```bash
pacstrap -K /mnt base linux linux-firmware base-devel
genfstab -U /mnt >> /mnt/etc/fstab
arch-chroot /mnt
```

## 4. Bootloader Configuration
- **Systemd-boot:** `bootctl install`
- **GRUB:** `grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB`

## 5. Post-Installation & Security Tools
After rebooting into your new system, you can manually install the security suite.
If you selected tools like **Libre-OTP** or **Anti-Evil-Maid**, clone the repository and compile them:
```bash
cargo install --git https://github.com/tilas01/Unix-SIT.git libre-otp
cargo install --git https://github.com/tilas01/Unix-SIT.git scarecrow
```

> **Note on Compatibility:** Enabling `scarecrow` (LKM hooks) requires secure boot to be managed carefully or disabled, as the kernel will taint upon loading an out-of-tree module.
