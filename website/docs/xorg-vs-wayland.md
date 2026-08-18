# Xorg vs Wayland — Complete Comparison

> Understanding display servers is critical for choosing the right Desktop Environment and GPU driver configuration in the generator.

---

## Table of Contents

- [Overview](#overview)
- [Architecture Differences](#architecture-differences)
- [Feature Comparison Table](#feature-comparison-table)
- [Desktop Environment Compatibility Matrix](#desktop-environment-compatibility-matrix)
- [GPU Compatibility](#gpu-compatibility)
- [Manual Setup — Xorg](#manual-setup--xorg)
- [Manual Setup — Wayland](#manual-setup--wayland)
- [Generator Behavior](#generator-behavior)
- [When to Choose Which](#when-to-choose-which)
- [Troubleshooting](#troubleshooting)

---

## Overview

### What is Xorg (X11)?

**Xorg** (X.Org Server) is the reference implementation of the **X Window System (X11)**, a display server protocol that has been the standard on Linux/*nix systems since 1984. It uses a **client-server architecture** where the X server manages display hardware and input devices, while client applications connect to it to render windows.

- **Mature:** 40+ years of development, massive compatibility.
- **Network-transparent:** Built-in support for running applications on remote machines.
- **Universal:** Every Linux GUI application supports X11.

### What is Wayland?

**Wayland** is a modern display server **protocol** (not a server itself) designed as a replacement for X11. Instead of a monolithic server, Wayland uses **compositors** (like Mutter for GNOME, KWin for KDE) that combine the roles of display server, window manager, and compositor into one.

- **Secure:** Applications cannot snoop on each other's input/output.
- **Efficient:** Eliminates the middleman — clients render directly to buffers.
- **Modern:** Designed for contemporary hardware (GPUs, HiDPI, touchscreens).

---

## Architecture Differences

### X11 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Application │────▶│  X11 Server  │────▶│   Display    │
│  (Client)   │◀────│   (Xorg)     │     │   Hardware   │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────▼───────┐
                    │  Compositor  │ (picom, compiz, etc.)
                    └──────────────┘
```

- Applications send drawing commands to the X server.
- The X server renders and manages windows.
- A **separate compositor** handles transparency, shadows, and effects.
- Any X client can read input events from other clients (**security concern**).

### Wayland Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Application │────▶│    Wayland        │────▶│   Display    │
│  (Client)   │◀────│   Compositor      │     │   Hardware   │
└─────────────┘     │ (Mutter/KWin/etc) │     └──────────────┘
                    └──────────────────┘
```

- Applications render to their own buffer.
- The **compositor** is the display server — it composites buffers and sends to hardware.
- No separate compositor needed.
- **Strict isolation** — applications cannot see each other's windows or intercept input.

---

## Feature Comparison Table

| Feature | Xorg (X11) | Wayland |
|---------|-----------|---------|
| **Maturity** | 40+ years, extremely stable | ~12 years, rapidly maturing |
| **Security** | ⚠️ Any client can keylog/screenshot others | ✅ Strict client isolation |
| **Performance** | Good, but compositor adds overhead | ✅ Lower latency, direct rendering |
| **Screen Tearing** | ⚠️ Common without compositor | ✅ Tear-free by design |
| **Multi-monitor** | ✅ Well-supported | ✅ Better mixed-DPI support |
| **HiDPI / Fractional Scaling** | ⚠️ Limited, often blurry | ✅ Native per-monitor scaling |
| **Screen Sharing** | ✅ Universal (any app can capture) | ⚠️ Requires PipeWire/xdg-desktop-portal |
| **Screen Recording** | ✅ OBS, ffmpeg, etc. work directly | ⚠️ Needs PipeWire + portal support |
| **Gaming** | ✅ Excellent compatibility | ✅ Good and improving (Gamescope) |
| **Nvidia Support** | ✅ Full support | ⚠️ Good with proprietary 515+, Nouveau limited |
| **Remote Desktop** | ✅ X11 forwarding, VNC, etc. | ⚠️ Requires RDP/VNC compositor support |
| **Network Transparency** | ✅ Built-in (ssh -X) | ❌ Not supported natively |
| **Accessibility** | ✅ Mature AT-SPI support | ⚠️ Improving but not fully mature |
| **Window Manager Choice** | ✅ Hundreds of WMs available | ⚠️ Must be a Wayland compositor |
| **Clipboard** | ✅ Universal | ✅ Supported but slightly different API |
| **Input Method** | ✅ IBus, Fcitx mature | ✅ Supported, some edge cases |
| **Global Hotkeys** | ✅ Any app can register | ⚠️ Requires portal protocol |

---

## Desktop Environment Compatibility Matrix

| Desktop / WM | Xorg Support | Wayland Support | Generator Default | Notes |
|---------------|-------------|-----------------|-------------------|-------|
| **None (TTY)** | N/A | N/A | N/A | No display server needed |
| **GNOME** | ✅ Full | ✅ Full (Recommended) | Wayland | GDM auto-selects Wayland; Xorg session available |
| **KDE Plasma** | ✅ Full | ✅ Full (Recommended) | Wayland | SDDM supports both; Wayland default since Plasma 6 |
| **DWM** | ✅ Required | ❌ Not supported | Xorg | X11 window manager — cannot run on Wayland |
| **Hyprland** | ❌ Not supported | ✅ Required | Wayland | Wayland compositor. It has no Xorg backend at all |
| **Dusky** | ❌ Not supported | ✅ Required | Wayland | Hyprland plus dotfiles, so Wayland-only. [By dusklinux](https://github.com/dusklinux/dusky) |

### Important warnings

- **DWM + Wayland = broken.** DWM is an X11 window manager and requires the X11 protocol.
- **Dusky + Xorg = broken.** Dusky is Hyprland, and Hyprland is a Wayland
  compositor with no Xorg backend. An earlier version of this table said the
  opposite; it was wrong.
- Both generators pin the display server when the desktop only runs on one of
  them, and say which and why rather than letting you choose a pair that cannot
  start.

---

## GPU Compatibility

| GPU | Xorg Driver | Wayland Support | Notes |
|-----|-------------|-----------------|-------|
| **AMD Radeon** | `mesa xf86-video-amdgpu vulkan-radeon` | ✅ Excellent | Best Wayland experience. AMDGPU driver is open-source. |
| **Intel Graphics** | `mesa xf86-video-intel vulkan-intel` | ✅ Excellent | Great Wayland support via i915/xe drivers. |
| **Nvidia (Proprietary)** | `nvidia nvidia-utils` | ⚠️ Good (515+) | Requires `nvidia-drm.modeset=1`. GBM support in 515+. |
| **Nvidia (Nouveau/Libre)** | `mesa xf86-video-nouveau` | ⚠️ Limited | Performance much lower than proprietary. Basic Wayland. |
| **VM (QEMU/VBox/VMware)** | `spice-vdagent xf86-video-qxl` | ⚠️ Limited | Virtual GPU; Xorg generally more reliable in VMs. |

### Nvidia + Wayland Setup

If using Nvidia proprietary drivers with Wayland:

```bash
# Ensure kernel module parameters are set
echo "options nvidia-drm modeset=1" > /etc/modprobe.d/nvidia.conf

# Enable required kernel modules in mkinitcpio
# Add to MODULES: nvidia nvidia_modeset nvidia_uvm nvidia_drm
sed -i 's/^MODULES=()/MODULES=(nvidia nvidia_modeset nvidia_uvm nvidia_drm)/' /etc/mkinitcpio.conf
mkinitcpio -P

# Environment variables for Wayland
echo "GBM_BACKEND=nvidia-drm" >> /etc/environment
echo "__GLX_VENDOR_LIBRARY_NAME=nvidia" >> /etc/environment
```

---

## Manual Setup — Xorg

### Installation

```bash
# Core Xorg server
pacman -S xorg-server

# Common utilities
pacman -S xorg-xinit xorg-xrandr xorg-xsetroot xorg-xset

# GPU-specific driver (choose one)
pacman -S xf86-video-amdgpu    # AMD
pacman -S xf86-video-intel     # Intel
pacman -S xf86-video-nouveau   # Nvidia (open source)
pacman -S nvidia nvidia-utils  # Nvidia (proprietary)
```

### Configuration

#### ~/.xinitrc

```bash
#!/bin/sh
# Set keyboard layout
setxkbmap us &

# Set screen resolution (optional)
xrandr --output HDMI-1 --mode 1920x1080 --rate 60 &

# Set wallpaper
feh --bg-scale ~/wallpaper.jpg &

# Start compositor
picom --daemon &

# Start window manager
exec dwm
```

#### Starting X

```bash
startx
```

#### Xorg Configuration Files

Custom configuration goes in `/etc/X11/xorg.conf.d/`:

```bash
# Example: AMD TearFree
cat > /etc/X11/xorg.conf.d/20-amdgpu.conf << 'EOF'
Section "Device"
    Identifier "AMD"
    Driver "amdgpu"
    Option "TearFree" "true"
EndSection
EOF
```

### Auto-start X on Login

Add to `~/.bash_profile` or `~/.zprofile`:

```bash
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    startx
fi
```

---

## Manual Setup — Wayland

### For GNOME

```bash
pacman -S gnome gnome-tweaks wayland
systemctl enable gdm

# GDM automatically starts a Wayland session
# To force Xorg: uncomment WaylandEnable=false in /etc/gdm/custom.conf
```

### For KDE Plasma

```bash
pacman -S plasma-desktop sddm wayland
systemctl enable sddm

# SDDM login screen lets you choose Wayland or X11 session
```

### Wayland Utilities

```bash
# Screen sharing support (required for OBS, Discord, etc.)
pacman -S pipewire pipewire-pulse wireplumber xdg-desktop-portal xdg-desktop-portal-gnome
# OR for KDE:
pacman -S pipewire pipewire-pulse wireplumber xdg-desktop-portal xdg-desktop-portal-kde

# Run X11 apps on Wayland
pacman -S xorg-xwayland

# Screenshot tools
pacman -S grim slurp    # For wlroots compositors
# GNOME/KDE have built-in screenshot tools
```

### Checking if You're Running Wayland

```bash
echo $XDG_SESSION_TYPE
# Output: "wayland" or "x11"

# Alternative
loginctl show-session $(loginctl | grep $(whoami) | awk '{print $1}') -p Type
```

---

## Generator Behavior

The generator's display server dropdown works as follows:

| Setting | GNOME | KDE | DWM | Hyprland / Dusky | None |
|---------|-------|-----|-----|------------------|------|
| **Auto** | Wayland | Wayland | Xorg | Wayland | N/A |
| **Wayland** | Wayland | Wayland | ⚠️ cannot start | Wayland | N/A |
| **Xorg** | Xorg | Xorg | Xorg | ⚠️ cannot start | N/A |

Where a desktop only runs on one of the two, both generators pin the dropdown to
it and say so, rather than letting you build a pair that cannot start.

### Packages Installed by Display Server

**Xorg mode:**
```bash
# GNOME
pacman -S gnome gnome-tweaks xorg-server

# KDE
pacman -S plasma-desktop sddm xorg-server

# DWM
pacman -S xorg-server xorg-xinit base-devel libx11 libxinerama libxft

# Dusky is not available in Xorg mode — it is Hyprland, which is Wayland-only.
```

**Wayland mode:**
```bash
# GNOME
pacman -S gnome gnome-tweaks wayland

# KDE
pacman -S plasma-desktop sddm wayland

# Dusky — the only mode it has. Hyprland and the rest of the desktop come
# from Dusky's own installer; this is the base it needs first.
pacman -S git base-devel wayland xorg-xwayland
```

---

## When to Choose Which

### Choose Xorg When:

- ✅ Using **DWM**, **i3** or another X11 window manager (required)
- ✅ Running in a **Virtual Machine** (better VM graphics support)
- ✅ Need **X11 forwarding** over SSH (`ssh -X`)
- ✅ Using **Nvidia Nouveau** drivers (better X11 support)
- ✅ Using older/niche software that only supports X11
- ✅ Need maximum **screen recording/sharing** compatibility
- ✅ Require **global hotkeys** for applications

### Choose Wayland When:

- ✅ Using **GNOME** or **KDE Plasma** (recommended)
- ✅ **Security is a priority** (no keylogging between apps)
- ✅ Want **tear-free** rendering without compositor configuration
- ✅ Have **HiDPI** or mixed-DPI multi-monitor setup
- ✅ Using **AMD** or **Intel** GPU (best Wayland support)
- ✅ Using **Nvidia proprietary** drivers 515+ (good Wayland support)
- ✅ Want **lower input latency** for gaming

### Choose Auto When:

- ✅ You trust the generator to pick the best option
- ✅ GNOME, KDE and Dusky get Wayland; DWM gets Xorg. Each is the only thing that works

---

## Troubleshooting

### Wayland Session Not Available in GDM/SDDM

```bash
# Check if Wayland is available
ls /usr/lib/gdm*/  # Should show wayland session files

# For Nvidia, ensure modeset is enabled
cat /etc/modprobe.d/nvidia.conf
# Should contain: options nvidia-drm modeset=1

# For GDM, check it's not disabled
grep WaylandEnable /etc/gdm/custom.conf
# Should NOT say WaylandEnable=false
```

### Screen Sharing Not Working on Wayland

```bash
# Install PipeWire and portals
pacman -S pipewire wireplumber xdg-desktop-portal

# For GNOME
pacman -S xdg-desktop-portal-gnome

# For KDE
pacman -S xdg-desktop-portal-kde

# Restart PipeWire
systemctl --user restart pipewire wireplumber
```

### X11 Application Looks Blurry on Wayland

```bash
# Install XWayland
pacman -S xorg-xwayland

# For GTK apps, set scaling
export GDK_SCALE=2
export GDK_DPI_SCALE=0.5

# For QT apps
export QT_AUTO_SCREEN_SCALE_FACTOR=1
```

### Cannot Start X / Black Screen

```bash
# Check Xorg log
cat ~/.local/share/xorg/Xorg.0.log | grep "(EE)"

# Verify driver is installed
lspci -k | grep -A 2 VGA

# Reinstall GPU driver
pacman -S mesa xf86-video-amdgpu  # or appropriate driver
```

### DWM Won't Start

```bash
# Verify Xorg is installed
pacman -Qs xorg-server

# Check .xinitrc
cat ~/.xinitrc
# Must end with: exec dwm

# Try starting manually
startx

# Check for missing libraries
ldd /usr/local/bin/dwm
```

---

*Part of the [*nix Install Guides](https://github.com/tilas01/Unix-SIT) wiki by [tilas01](https://github.com/tilas01).*
*Dusky by [dusklinux](https://github.com/dusklinux/dusky).*
