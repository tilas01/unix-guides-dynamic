#!/bin/bash
# automated integrity verification script for tilas01 Release
set -e

echo "=================================================="
echo "🛡️  tilas01 Release Integrity Verifier"
echo "=================================================="

BINARY=$1
if [ -z "$BINARY" ]; then
    echo "Usage: ./verify-integrity.sh <binary_file>"
    echo "Example: ./verify-integrity.sh arch-rusty-security-suite-linux-x86_64"
    exit 1
fi

if [ ! -f "$BINARY" ]; then
    echo "❌ Error: File '$BINARY' not found."
    exit 1
fi

if [ ! -f "${BINARY}.sha256" ]; then
    echo "⚠️ Warning: ${BINARY}.sha256 not found. Attempting to download..."
    curl -sLO "https://github.com/tilas01/Unix-SIT/releases/latest/download/${BINARY}.sha256"
fi

if [ ! -f "${BINARY}.asc" ]; then
    echo "⚠️ Warning: ${BINARY}.asc not found. Attempting to download..."
    curl -sLO "https://github.com/tilas01/Unix-SIT/releases/latest/download/${BINARY}.asc"
fi

echo -e "\n[1/2] Verifying SHA-256 Hash..."
if sha256sum -c "${BINARY}.sha256"; then
    echo "✅ Hash Verification: SUCCESS"
else
    echo "❌ Hash Verification: FAILED!"
    echo "The file is corrupt or tampered with. Do NOT execute it."
    exit 1
fi

echo -e "\n[2/2] Verifying GPG Signature..."
if ! command -v gpg &> /dev/null; then
    echo "⚠️ GPG is not installed, so the signature cannot be checked."
    echo "   The hash above only proves the download is intact, NOT who made it."
    echo "   Install gnupg and re-run to verify authorship: pacman -S gnupg"
    exit 1
else
    # The signing key is the tilas01.asc committed at the repository root.
    #
    # NOTE: this previously fetched https://github.com/tilas01.keys, which is
    # GitHub's *SSH* public key endpoint. Those are not GPG keys, so the import
    # was a no-op and verification could never succeed.
    if [ ! -f "tilas01.asc" ]; then
        echo "Fetching the tilas01 signing key..."
        curl -sLO "https://raw.githubusercontent.com/tilas01/Unix-SIT/main/tilas01.asc"
    fi

    # Pin the fingerprint. The key and the binary come from the same host, so a
    # downloaded-and-trusted key proves nothing on its own: whoever can swap the
    # binary can swap the key that signs it. Compare this against the value
    # printed in README.md before trusting anything below.
    EXPECTED_FPR="5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED"
    # Previous key. Its private half was committed to public git history; it is
    # revoked and every signature it made is worthless.
    REVOKED_FPR="4C0383A168D0EA1DD6F1ACB5A13118E03A7D55A0"

    SERVED_FPRS="$(gpg --show-keys --with-colons tilas01.asc 2>/dev/null \
                   | awk -F: '$1=="fpr"{print $10}')"

    if [ -z "$SERVED_FPRS" ]; then
        echo "❌ tilas01.asc is not a parseable OpenPGP key. Aborting."
        exit 1
    fi
    if echo "$SERVED_FPRS" | grep -qx "$REVOKED_FPR"; then
        echo "❌ This key is the REVOKED $REVOKED_FPR. Do NOT trust it. Aborting."
        exit 1
    fi
    if ! echo "$SERVED_FPRS" | grep -qx "$EXPECTED_FPR"; then
        echo "❌ Signing key fingerprint mismatch."
        echo "   expected: $EXPECTED_FPR"
        echo "   served:   $(echo "$SERVED_FPRS" | tr '\n' ' ')"
        echo "   Either this script is out of date, or the key was substituted."
        exit 1
    fi

    if ! gpg --import tilas01.asc 2>/dev/null; then
        echo "❌ Could not import the signing key. Aborting."
        exit 1
    fi

    # Check gpg's exit status rather than grepping its text: the wording is
    # localised and "Good signature" can appear in output that still failed.
    if gpg --verify "${BINARY}.asc" "$BINARY" 2>/dev/null; then
        echo "✅ GPG Signature Verification: SUCCESS"
        echo ""
        echo "Fingerprint of the key that signed it:"
        gpg --verify "${BINARY}.asc" "$BINARY" 2>&1 | grep -iE 'using|fingerprint' || true
        echo ""
        echo "⚠️  A valid signature proves the key holder signed this file. Confirm the"
        echo "    fingerprint above matches the one you expect before trusting it."
    else
        echo "❌ GPG Signature Verification: FAILED!"
        echo "The signature is invalid or was made by a different key."
        echo "Do NOT execute this file."
        exit 1
    fi
fi

echo -e "\n🎉 ALL CHECKS PASSED. The file '$BINARY' is safe to run.\n"
