#!/bin/bash
# *nix Install Guides: Download, Verify, and Execute Rust Installer

set -e

echo "[+] Fetching pre-compiled Reproducible Rust Build..."
curl -sLO https://github.com/tilas01/Unix-SIT/releases/download/latest/arch-installer-linux-x86_64
curl -sLO https://github.com/tilas01/Unix-SIT/releases/download/latest/arch-installer-linux-x86_64.sha256

echo "[+] Verifying Hash Signature and GPG signature..."
if sha256sum -c arch-installer-linux-x86_64.sha256; then
    echo "[✓] SHA256 verification passed."
else
    echo "[!] CRITICAL ERROR: SHA256 verification failed. Binary may be compromised."
    rm -f arch-installer-linux-x86_64 arch-installer-linux-x86_64.sha256
    exit 1
fi

echo "[+] Fetching GPG signature..."
curl -sLO https://github.com/tilas01/Unix-SIT/releases/download/latest/arch-installer-linux-x86_64.sig

echo "[+] Fetching official Public Key..."
curl -sL "https://raw.githubusercontent.com/tilas01/Unix-SIT/main/tilas01-public-key.asc" -o tilas01-public-key.asc
gpg --import tilas01-public-key.asc 2>/dev/null || true

echo "[+] Verifying GPG signature..."
if gpg --verify arch-installer-linux-x86_64.sig arch-installer-linux-x86_64; then
    echo "[✓] GPG signature verified successfully."
else
    echo "[!] WARNING: GPG signature verification failed. The release may be compromised."
fi

echo "[+] Executing Async Rust Installer..."
chmod +x arch-installer-linux-x86_64
./arch-installer-linux-x86_64

echo "[+] Cleaning up local files..."
rm -f arch-installer-linux-x86_64 arch-installer-linux-x86_64.sha256

echo "[+] Finished."
