# 🏛️ Architecture & Generation Logic

The `Unix-SIT` deployment framework relies on a fully client-side, zero-backend architecture to generate highly secure and precisely customized Arch Linux deployment environments.

## How the Website Generator Works

The Interactive Generator (`website/index.html` and `website/script.js`) works locally in your browser to build the installation pipeline. No server requests are made to parse your data, guaranteeing privacy.

1. **Input Parameters:** The user selects hardware variables (UEFI vs BIOS), encryption thresholds (LUKS2, LUKS1), filesystems (BTRFS, Ext4), driver philosophy (Libre, Open Source), and output formatting.
2. **Dynamic Injection:** The Javascript engine analyzes these vectors and generates custom CLI routines. For instance, if `Libre` is selected, `sudo` is automatically stripped from the `pacstrap` process and `opendoas` is installed, configured, and persistently linked.
## Native Rust Security Tools

Instead of relying on bloated, proprietary modules, this framework maintains its own suite of Rust-native security tools available during deployment:

### 🦆 Anti-RubberDucky Daemon
A daemon that interfaces directly with `/dev/input/eventX`. It profiles keystroke intervals using sub-millisecond precision (`THRESHOLD_MS=20`). If anomalous speeds are detected—symptomatic of malicious USB injection attacks—it immediately forces a `loginctl lock-sessions` intervention.

## How Your Choices Affect The Installation

Every choice you make in the interactive generator fundamentally shapes the required commands and compatibility for later steps. The dynamic generator handles these complexities, but here is what happens under the hood:

### 1. Firmware (UEFI vs BIOS)
- **UEFI:** Unlocks the ability to use **systemd-boot**, **Unified Kernel Images (UKI)**, and **Secure Boot** methodologies. It allows for the modern ESP (EFI System Partition) structure.
- **Legacy BIOS:** If you select BIOS, the system enforces **GRUB** as the bootloader because UKI and systemd-boot cannot interface with MBR/Legacy systems.

### 2. Encryption (LUKS1 vs LUKS2 vs Unencrypted)
- **LUKS2:** The modern post-quantum secure standard. However, GRUB has extremely limited support for LUKS2 PBKDF2 formats and zero support for Argon2. If you select GRUB with LUKS2, you **must** use an unencrypted /boot partition. If you use UKI or systemd-boot, full disk encryption is seamless.
- **Unencrypted:** Bypasses LUKS cryptsetup altogether, resulting in a completely raw filesystem mount. **Warning: If paired with no Secure Boot, this is a highly insecure setup.**

### 3. Init Systems (systemd vs busybox)
- **systemd hook:** Faster boot times and deeper integration with systemd-boot and sd-encrypt. It handles LVM and LUKS mounting inherently via systemd targets.
- **busybox hook:** The traditional mkinitcpio setup. Requires specific bash hooks (encrypt, lvm2) placed in specific order before filesystems inside /etc/mkinitcpio.conf.

### 4. Bootloaders & Secure Boot
- **Unified Kernel Image (UKI):** Bundles the kernel, initramfs, and cmdline into a single .efi executable. This entirely bypasses traditional bootloaders like GRUB, directly booting from the motherboard's UEFI. This allows for Custom Keys Secure Boot where you take ownership of the motherboard PK/KEK keys.
- **systemd-boot:** A minimal boot manager that reads text entries. Cannot natively boot Windows without chainloading if Secure Boot is enforced.
- **GRUB:** Essential for BIOS, but on UEFI it relies heavily on shim-signed to fake Secure Boot validation via Microsoft's certificates.
