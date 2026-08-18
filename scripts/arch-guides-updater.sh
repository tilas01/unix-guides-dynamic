#!/bin/bash
# arch-guides-updater.sh
# Secure auto-updater for *nix Install Guides standalone security tools
# Triggered by Pacman hooks.

set -e

REPO="tilas01/Unix-SIT"
TOOLS=("libre-otp" "anti-ducky" "anti-evil-maid" "kernel-watcher" "scarecrow")
INSTALL_DIR="/usr/local/bin"
LOG_FILE="/var/log/arch-guides-updater.log"

# Optional: Run as the logged-in user to send notifications to their desktop.
# We will use su or sudo to launch notify-send as the user.
USER_ID=$(id -u)
CURRENT_USER=$(whoami)

# We need the user who is running the desktop session to send notifications to Wayland/Xorg
DESKTOP_USER=$(who | grep "(:0\|:1\|tty)" | awk '{print $1}' | head -n 1)
if [ -z "$DESKTOP_USER" ]; then
    DESKTOP_USER=$CURRENT_USER
fi

notify_user() {
    local title="$1"
    local msg="$2"
    echo "$(date) - [ALERT] $title: $msg" >> "$LOG_FILE"
    
    # Try to send GUI notification
    if command -v notify-send >/dev/null 2>&1; then
        su - "$DESKTOP_USER" -c "DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u $DESKTOP_USER)/bus notify-send -u critical \"$title\" \"$msg\"" || true
    fi
}

echo "Starting Auto-Update Verification Check..." >> "$LOG_FILE"

for APP in "${TOOLS[@]}"; do
    echo "Checking updates for $APP..." >> "$LOG_FILE"
    
    # In a real environment, you'd parse JSON from the Github API.
    # For demonstration, we attempt to download the 'latest' release assets.
    LATEST_URL="https://github.com/$REPO/releases/latest/download"
    
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    if curl -sLf "$LATEST_URL/$APP" -o "$APP"; then
        if curl -sLf "$LATEST_URL/$APP.sha512" -o "$APP.sha512" && curl -sLf "$LATEST_URL/$APP.sig" -o "$APP.sig"; then
            
            # Verify Hash
            echo "Verifying SHA512 hash..." >> "$LOG_FILE"
            if ! sha512sum -c "$APP.sha512" --status 2>/dev/null; then
                notify_user "Security Tool Update Failed" "Hash mismatch detected for $APP. Update aborted!"
                rm -rf "$TEMP_DIR"
                continue
            fi
            
            # Verify GPG Signature
            # Assumes the public key for tilas01 is already imported to the system or root keyring.
            echo "Verifying GPG signature..." >> "$LOG_FILE"
            if ! gpg --verify "$APP.sig" "$APP" 2>>"$LOG_FILE"; then
                notify_user "Security Tool Update Failed" "GPG Signature invalid or missing for $APP. Update aborted!"
                rm -rf "$TEMP_DIR"
                continue
            fi
            
            # Validated successfully
            chmod +x "$APP"
            cp "$APP" "$INSTALL_DIR/$APP"
            echo "Successfully updated $APP to latest verified version." >> "$LOG_FILE"
            
        else
             # We couldn't find sig or hash files
             notify_user "Security Tool Update Failed" "Missing verification files (.sig or .sha512) for $APP on Github."
        fi
    else
        echo "No release found for $APP or network error." >> "$LOG_FILE"
    fi
    
    rm -rf "$TEMP_DIR"
done

echo "Auto-Update check complete." >> "$LOG_FILE"
