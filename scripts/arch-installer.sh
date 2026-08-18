#!/bin/bash
# *nix Install Guides: Automated Extractive Modular Installer
# This script extracts bash blocks directly from the live GitHub repository markdown files
# to guarantee it matches the guide exactly.

set -e

REPO_URL="https://raw.githubusercontent.com/tilas01/Unix-SIT/main"

echo "================================================="
echo "   *nix Install Guides: Automated Extractive Installer   "
echo "================================================="
echo "WARNING: This script will format the selected disk."
echo "Press Ctrl+C at any time to abort before execution."
echo ""

# --- Gather User Input ---
read -p "Enter the target disk (e.g., /dev/sda or /dev/nvme0n1): " DISK

echo ""
echo "Select Partitioning & Encryption Setup:"
echo "1) Unencrypted"
echo "2) LUKS1 (Legacy GRUB Compatible)"
echo "3) LUKS2 (Post-Quantum Argon2id / Recommended)"
echo "4) LVM on LUKS2"
read -p "Choice [1-4]: " PART_CHOICE

echo ""
echo "Select Init System (mkinitcpio hooks):"
echo "1) systemd (Modern, sd-encrypt)"
echo "2) busybox/udev (Traditional, encrypt hook)"
read -p "Choice [1-2]: " INIT_CHOICE

echo ""
echo "Select Bootloader & Secure Boot:"
echo "1) UKI / Direct UEFI (Custom Keys)"
echo "2) UKI + Shim (Microsoft Trust)"
echo "3) systemd-boot"
echo "4) GRUB"
echo "5) GRUB + Shim"
read -p "Choice [1-5]: " BOOT_CHOICE

echo ""
echo "Select Graphics Drivers (GPU):"
echo "1) None / Virtual Machine / Generic"
echo "2) AMD - Libre (uses only open source dependencies recursively and is fully open source)"
echo "3) NVIDIA - Open Source (code is public but may depend on things that code isnt public for)"
echo "4) NVIDIA - Proprietary (code is not public)"
read -p "Choice [1-4]: " GPU_CHOICE

echo ""
echo "Select DNS Caching Service:"
echo "1) systemd-resolved (Default, minimal)"
echo "2) unbound (Validating, recursive, caching DNS resolver)"
echo "3) dnscrypt-proxy (Flexible DNS proxy, supports encrypted protocols)"
read -p "Choice [1-3]: " DNS_CHOICE

echo ""
read -p "Install Advanced Evil Maid Detector? (y/n): " EVIL_CHOICE

echo ""
echo "================================================="
echo "Ready to begin installation on $DISK."
read -p "Press ENTER to begin extracting and running blocks..."

PART_EFI="${DISK}1"
PART_ROOT="${DISK}2"
if [[ "$DISK" == *"nvme"* ]]; then
    PART_EFI="${DISK}p1"
    PART_ROOT="${DISK}p2"
fi

extract_and_run() {
    local file_path="$1"
    local chroot_mode="$2"
    echo "[+] Extracting live script from: $file_path"
    
    local tmp_script="/tmp/arch_extract_$RANDOM.sh"
    curl -s "$REPO_URL/$file_path" | awk '/^```bash/{flag=1; next} /^```/{flag=0} flag' > "$tmp_script"
    
    sed -i "s|/dev/sda1|$PART_EFI|g" "$tmp_script"
    sed -i "s|/dev/sda2|$PART_ROOT|g" "$tmp_script"
    sed -i "s|/dev/sda|$DISK|g" "$tmp_script"
    sed -i '/cfdisk/d' "$tmp_script"
    
    if [ -s "$tmp_script" ]; then
        if [ "$chroot_mode" == "chroot" ]; then
            cp "$tmp_script" /mnt/tmp_script.sh
            arch-chroot /mnt /bin/bash /tmp_script.sh
            rm /mnt/tmp_script.sh
        else
            bash "$tmp_script"
        fi
    else
        echo "Warning: No bash commands found in $file_path"
    fi
    rm -f "$tmp_script"
}

# 1. Partitioning
echo "[+] Wiping disk and creating partitions..."
sgdisk -Z "$DISK"
sgdisk -n 1:0:+512M -t 1:ef00 "$DISK"
sgdisk -n 2:0:0 -t 2:8300 "$DISK"

if [ "$PART_CHOICE" == "1" ]; then
    extract_and_run "docs/02-partitioning/unencrypted.md" "host"
elif [ "$PART_CHOICE" == "2" ]; then
    extract_and_run "docs/02-partitioning/luks1.md" "host"
elif [ "$PART_CHOICE" == "3" ]; then
    extract_and_run "docs/02-partitioning/luks2.md" "host"
elif [ "$PART_CHOICE" == "4" ]; then
    extract_and_run "docs/02-partitioning/lvm-on-luks2.md" "host"
fi

# 2. Base Install
GPU_PKGS=""
if [ "$GPU_CHOICE" == "2" ]; then
    GPU_PKGS="mesa xf86-video-amdgpu vulkan-radeon"
elif [ "$GPU_CHOICE" == "3" ]; then
    GPU_PKGS="mesa xf86-video-nouveau"
elif [ "$GPU_CHOICE" == "4" ]; then
    GPU_PKGS="nvidia nvidia-utils"
fi

tmp_base="/tmp/base_install.sh"
curl -s "$REPO_URL/docs/03-base-installation.md" | awk '/^```bash/{flag=1; next} /^```/{flag=0} flag' > "$tmp_base"
sed -i "s|pacstrap -K /mnt base |pacstrap -K /mnt base $GPU_PKGS |g" "$tmp_base"
bash "$tmp_base"
rm -f "$tmp_base"

# Write mkinitcpio hooks based on Init choice
cat <<EOF > /mnt/setup_init.sh
#!/bin/bash
if [ "$INIT_CHOICE" == "1" ]; then
    if [ "$PART_CHOICE" == "1" ]; then
        sed -i 's/^HOOKS=.*/HOOKS=(base systemd autodetect microcode modconf kms keyboard sd-vconsole block filesystems fsck)/' /etc/mkinitcpio.conf
    elif [ "$PART_CHOICE" == "4" ]; then
        sed -i 's/^HOOKS=.*/HOOKS=(base systemd autodetect microcode modconf kms keyboard sd-vconsole block sd-encrypt lvm2 filesystems fsck)/' /etc/mkinitcpio.conf
    else
        sed -i 's/^HOOKS=.*/HOOKS=(base systemd autodetect microcode modconf kms keyboard sd-vconsole block sd-encrypt filesystems fsck)/' /etc/mkinitcpio.conf
    fi
else
    if [ "$PART_CHOICE" == "1" ]; then
        sed -i 's/^HOOKS=.*/HOOKS=(base udev autodetect microcode modconf kms keyboard keymap consolefont block filesystems fsck)/' /etc/mkinitcpio.conf
    elif [ "$PART_CHOICE" == "4" ]; then
        sed -i 's/^HOOKS=.*/HOOKS=(base udev autodetect microcode modconf kms keyboard keymap consolefont block encrypt lvm2 filesystems fsck)/' /etc/mkinitcpio.conf
    else
        sed -i 's/^HOOKS=.*/HOOKS=(base udev autodetect microcode modconf kms keyboard keymap consolefont block encrypt filesystems fsck)/' /etc/mkinitcpio.conf
    fi
fi
mkinitcpio -P
EOF
chmod +x /mnt/setup_init.sh
arch-chroot /mnt /setup_init.sh
rm /mnt/setup_init.sh

# 3. Bootloader Install
if [ "$BOOT_CHOICE" == "1" ]; then
    extract_and_run "docs/04-bootloaders/uki-no-grub.md" "chroot"
    extract_and_run "docs/05-secure-boot/custom-keys-uki.md" "chroot"
elif [ "$BOOT_CHOICE" == "2" ]; then
    extract_and_run "docs/04-bootloaders/uki-no-grub.md" "chroot"
    arch-chroot /mnt pacman -S --noconfirm shim-signed
    arch-chroot /mnt cp /usr/share/shim-signed/shimx64.efi /efi/EFI/arch/bootx64.efi
elif [ "$BOOT_CHOICE" == "3" ]; then
    extract_and_run "docs/04-bootloaders/systemd-boot.md" "chroot"
elif [ "$BOOT_CHOICE" == "4" ]; then
    extract_and_run "docs/04-bootloaders/grub.md" "chroot"
elif [ "$BOOT_CHOICE" == "5" ]; then
    extract_and_run "docs/04-bootloaders/grub.md" "chroot"
    extract_and_run "docs/05-secure-boot/shim-grub.md" "chroot"
fi

# 4. DNS Setup
if [ "$DNS_CHOICE" == "2" ]; then
    arch-chroot /mnt pacman -S --noconfirm unbound
    arch-chroot /mnt systemctl enable unbound
elif [ "$DNS_CHOICE" == "3" ]; then
    arch-chroot /mnt pacman -S --noconfirm dnscrypt-proxy
    arch-chroot /mnt systemctl enable dnscrypt-proxy
else
    arch-chroot /mnt systemctl enable systemd-resolved
fi

# 5. Minimalist System Tools Setup (doas & pfetch)
echo "[+] Configuring doas and pfetch..."
arch-chroot /mnt bash -c 'echo "permit persist :wheel" > /etc/doas.conf'
arch-chroot /mnt ln -s /usr/bin/doas /usr/bin/sudo
arch-chroot /mnt bash -c 'echo "pfetch" >> /etc/profile'

# 6. Copy scripts and Setup Evil Maid
echo "[+] Fetching scripts directory..."
mkdir -p /mnt/root/scripts
curl -s "$REPO_URL/scripts/evil-maid-detector.sh" > /mnt/root/scripts/evil-maid-detector.sh
curl -s "$REPO_URL/scripts/arch-secure-boot.sh" > /mnt/root/scripts/arch-secure-boot.sh
chmod +x /mnt/root/scripts/*.sh

if [[ "$EVIL_CHOICE" =~ ^[Yy]$ ]]; then
    arch-chroot /mnt /root/scripts/evil-maid-detector.sh setup
fi

echo "[+] Live Extractive Installation complete. You may now reboot."
