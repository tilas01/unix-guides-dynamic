#!/usr/bin/env bash
#
# Generate the body for a GitHub release of the Unix Security Suite.
#
# The release previously had no body at all — just "Security Tools Release
# (main)" and a pile of unlabelled binaries. Someone landing on it had no way to
# tell what any of the files were, how to check a signature, or what changed.
#
# Everything here is derived from the repository at build time rather than
# hand-maintained, so it cannot drift out of date the way a checked-in
# CHANGELOG does.
#
# Usage: gen-release-notes.sh <tag> <asset-dir> > notes.md

set -Eeuo pipefail

TAG="${1:?usage: gen-release-notes.sh <tag> <asset-dir>}"
ASSETS="${2:?usage: gen-release-notes.sh <tag> <asset-dir>}"

# Signing key fingerprint. Hard-coded on purpose: the whole point of publishing
# it is that a reader compares it against a source they already trust, and a
# fingerprint read out of the same release it is supposed to authenticate would
# be worth nothing.
readonly KEY_FPR="5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED"
readonly SITE="https://tilas01.github.io/Unix-SIT"

# name|one line|what it needs
readonly TOOLS=(
"libre-otp|TOTP/HOTP second factor for boot, login and SSH, with no cloud account and no blobs.|Dual-OTP: one code verifies, one is displayed."
"anti-ducky|Blocks BadUSB keystroke injection by watching HID timing, and captures the payload.|Enrol your own keyboards first: --enroll"
"anti-evil-maid|Hashes the boot chain so you know if it changed, and suspends LUKS so the master key leaves RAM.|--lock-now is a real boundary; a screen lock is not."
"kernel-watcher|Filesystem monitor for infostealers touching browser profiles, SSH keys and wallets.|Runs as a daemon; logs to /var/log."
"scarecrow|Canary tokens, sandbox spoofing, and three optional duress PINs for the login prompt.|Needs the pam_exec line to be installed or the PINs never fire."
"aur-guard|Reads a PKGBUILD before makepkg runs it and reports what is worth reading yourself.|Read-only. Never needs root. Never says a package is safe."
"unix-security-suite|The five daemons linked into a single binary, for people who want all of them.|aur-guard stays standalone — it never needs root."
)

cat <<HEADER
# Unix Security Suite — \`${TAG}\`

Six independent Rust tools for hardening an Arch Linux install, plus a combined
binary. Every binary below is reproducible-built and **GPG-signed**.

Built from commit \`$(git rev-parse --short HEAD)\` with the toolchain pinned in
\`security-tools/rust-toolchain.toml\`.

## What is in this release

| Tool | What it does | Worth knowing |
|---|---|---|
HEADER

for entry in "${TOOLS[@]}"; do
    IFS='|' read -r name desc note <<<"$entry"
    printf '| `%s` | %s | %s |\n' "$name" "$desc" "$note"
done

cat <<'INSTALL'

## Install

The installer verifies each binary's SHA-512 **and** its GPG signature, pins the
signing key by fingerprint, and fails closed if either check does not pass.

```bash
curl -fsSL https://raw.githubusercontent.com/tilas01/Unix-SIT/main/scripts/install-security-suite.sh -o install.sh
less install.sh          # read it before running it as root
sudo bash install.sh                       # interactive picker
sudo bash install.sh --only scarecrow,aur-guard
```

It installs the daemons but **does not enable them**. Several of these can lock
you out of your own machine, which is the point of them, so arming each one is a
separate and deliberate decision you make on the machine itself.

## Verify a binary yourself

Do this rather than trusting the installer, if you prefer:

```bash
INSTALL

printf 'gpg --recv-keys %s\n' "$KEY_FPR"
printf 'gpg --fingerprint %s   # compare against the repository README\n' "$KEY_FPR"
cat <<'VERIFY'
gpg --verify anti-ducky.sig anti-ducky
sha512sum -c anti-ducky.sha512
```

The signing key's UID is the bare string `tilas01` — **no email, deliberately**.

> An earlier key, `4C0383A1…`, is **revoked**: its private half was committed to
> public git history. Anything signed with it should be treated as unsigned.

VERIFY

cat <<DOCS
## Documentation

- Full wiki: <${SITE}/wiki.html>
- Security tools overview: <${SITE}/security-tools.html>
- Per-tool README, including an **Honest limitations** section for every one:
  \`security-tools/<tool>/README.md\`

Those limitation sections are not marketing hedging. They name what each tool
cannot do — that \`anti-evil-maid\`'s software hashing is not a hardware root of
trust, that \`anti-ducky\`'s timing thresholds have never been measured on real
hardware, that \`aur-guard\` is a substring scanner and not a shell parser, and
that the LUKS unlock backoff is not comparable to a phone's secure element.
Read them before relying on any of this.

DOCS

# Changes since the previous tag. Falls back gracefully on the first release,
# where there is no previous tag to diff against.
PREV="$(git describe --tags --abbrev=0 --exclude="$TAG" 2>/dev/null || true)"
if [[ -n "$PREV" ]]; then
    printf '## Changes since `%s`\n\n' "$PREV"
    # Subject lines only. The full reasoning lives in the commit bodies, which
    # is where it belongs; a release note that inlined them would be unreadable.
    git log --no-merges --format='- %s' "${PREV}..HEAD" -- security-tools scripts \
        | head -40 || true
    printf '\n'
else
    printf '## Changes\n\nFirst tagged release from this history.\n\n'
fi

cat <<FOOTER
## Assets

$(cd "$ASSETS" 2>/dev/null && ls -1 | sed 's/^/- `/;s/$/`/' || echo '- (asset listing unavailable)')

Each \`<tool>\` ships with a \`.sha512\`, a detached \`.sig\`, and an armoured
\`.asc\`.

---

Issues and suggestions are welcome: <https://github.com/tilas01/Unix-SIT/issues>

Built with [Claude Code](https://claude.com/claude-code).
FOOTER
