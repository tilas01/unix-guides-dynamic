#!/usr/bin/env bash
#
# install-security-suite.sh — install the whole tilas01 security suite at once.
#
# Replaces having to fetch, verify and configure five tools individually. It
# downloads each release binary, verifies its SHA-512 hash and GPG signature,
# installs it, and optionally writes the systemd units.
#
# Design notes:
#   * Fails closed. A hash or signature that does not verify aborts the whole
#     run and nothing is installed. There is no --skip-verify, on purpose.
#   * Installs to a staging directory first and only moves binaries into place
#     once every selected tool has verified, so a partial failure cannot leave
#     you with half a suite.
#   * Enables nothing by default. Daemons are installed but left stopped, and
#     anything that can lock you out is opt-in and warned about.
#   * Idempotent: safe to re-run to upgrade.
#
# Usage:
#   ./install-security-suite.sh                      # interactive
#   ./install-security-suite.sh --all                # everything, no daemons
#   ./install-security-suite.sh --only libre-otp,anti-ducky
#   ./install-security-suite.sh --all --enable       # also enable the daemons
#   ./install-security-suite.sh --from-source        # build with cargo instead
#   ./install-security-suite.sh --uninstall
#   ./install-security-suite.sh --dry-run --all      # show what would happen
#
# Choosing what happens, rather than always doing all of it:
#   --pull        download and verify only; install nothing
#   --install     install, reusing anything --pull already fetched and verified
#   --verify      check what is downloaded or installed; change nothing
#   --reinstall   install over an existing copy deliberately
#   --setup       run each tool's own configuration step after installing
#
# Choosing what it is being installed on:
#   --os <arch|gentoo|freebsd|openbsd|raspios>
#                 detected from /etc/os-release and uname when not given.
#                 Anything a system genuinely cannot run is refused by name
#                 with the reason, never silently skipped.
#
# Author: tilas01 · https://github.com/tilas01/Unix-SIT
# Licence: CC BY-NC-SA 4.0
#
# Provided AS IS with no warranty. These tools can lock you out of your own
# machine if misconfigured. Read the wiki before enabling anything.

set -Eeuo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

readonly REPO="tilas01/Unix-SIT"
readonly KEY_URL="https://raw.githubusercontent.com/${REPO}/main/tilas01.asc"

# The signing key is pinned by fingerprint, not merely downloaded.
#
# Without this pin, the key and the binaries both come from the same host: an
# attacker who can serve you a different tilas01.asc can also serve you binaries
# signed with it, and every check would pass. Pinning means a swapped key is a
# hard failure. Verify this value against the fingerprint in README.md, which
# you should read over a connection you did not get from this script.
#
# 4C0383A168D0EA1DD6F1ACB5A13118E03A7D55A0 was the previous key. Its private
# half was published in this repository's git history and it is REVOKED. Never
# accept it.
readonly SIGNING_FPR="5CC1B2BED4D05F65E9E965423AA74BEC12F3D5ED"
readonly REVOKED_FPRS=("4C0383A168D0EA1DD6F1ACB5A13118E03A7D55A0")
readonly INSTALL_DIR="/usr/local/bin"
readonly CONFIG_DIR="/etc/arch-security"
readonly SYSTEMD_DIR="/etc/systemd/system"

# Every tool in the suite: name|description|has_daemon
readonly TOOLS=(
    "libre-otp|TOTP/HOTP two-factor for boot, login and SSH|no"
    "anti-ducky|Blocks BadUSB keystroke-injection devices|yes"
    "anti-evil-maid|Boot integrity verification and decoy entries|yes"
    "kernel-watcher|Filesystem monitor for infostealers and rootkits|yes"
    "scarecrow|Canary tokens and sandbox spoofing|yes"
    "aur-guard|Reads a PKGBUILD before makepkg runs it|no"
    "pi-boot-guard|Reports Raspberry Pi boot integrity and watches the boot partition|no"
)

# ─── What runs where ──────────────────────────────────────────────────────────
#
# Not every tool can work on every system, and the differences are real rather
# than a matter of porting effort. Stating them here means the installer can
# refuse by name with a reason instead of installing a binary that will sit
# there doing nothing — which is this project's characteristic failure and the
# reason a scanner that reports success is worse than no scanner.
#
#   yes     works
#   partial works, minus a named capability
#   no      cannot work here; the mechanism it is built on does not exist
#
readonly SUPPORT_arch="libre-otp=yes anti-ducky=yes anti-evil-maid=yes kernel-watcher=yes scarecrow=yes aur-guard=yes pi-boot-guard=no"
readonly SUPPORT_gentoo="libre-otp=yes anti-ducky=yes anti-evil-maid=yes kernel-watcher=yes scarecrow=yes aur-guard=no pi-boot-guard=no"
readonly SUPPORT_raspios="libre-otp=yes anti-ducky=partial anti-evil-maid=partial kernel-watcher=yes scarecrow=yes aur-guard=no pi-boot-guard=yes"
readonly SUPPORT_freebsd="libre-otp=yes anti-ducky=no anti-evil-maid=partial kernel-watcher=yes scarecrow=partial aur-guard=no pi-boot-guard=no"
readonly SUPPORT_openbsd="libre-otp=no anti-ducky=no anti-evil-maid=partial kernel-watcher=yes scarecrow=no aur-guard=no pi-boot-guard=no"

# Why, in one line each, printed when a tool is refused or limited.
reason_for() {
    case "$2:$1" in
        *:aur-guard)            echo "reads PKGBUILDs, which exist only on Arch" ;;
        *:pi-boot-guard)        echo "reads Raspberry Pi firmware state, which only a Pi has" ;;
        openbsd:libre-otp)      echo "OpenBSD has no PAM; it uses BSD auth, which is a different integration" ;;
        openbsd:scarecrow)      echo "the duress gate needs PAM, and header erase needs cryptsetup" ;;
        freebsd:anti-ducky|openbsd:anti-ducky)
                                echo "built on Linux's USB authorized sysfs node, which has no equivalent here" ;;
        raspios:anti-ducky)     echo "timing detection works; USB deauthorization on the Pi is unverified" ;;
        openbsd:anti-evil-maid) echo "boot hashing works; softraid has no suspend, so the lock-on-tamper half cannot" ;;
        freebsd:anti-evil-maid) echo "boot hashing works; suspend uses geli rather than cryptsetup and is untested" ;;
        raspios:anti-evil-maid) echo "boot hashing works; the Pi boots from EEPROM, so the EFI checks do not apply" ;;
        freebsd:scarecrow)      echo "canaries work; header erase uses geli rather than cryptsetup and is untested" ;;
        *)                      echo "not supported on this system" ;;
    esac
}

support_of() {
    local tool="$1" osid="$2" table entry
    case "$osid" in
        arch)    table="$SUPPORT_arch" ;;
        gentoo)  table="$SUPPORT_gentoo" ;;
        raspios) table="$SUPPORT_raspios" ;;
        freebsd) table="$SUPPORT_freebsd" ;;
        openbsd) table="$SUPPORT_openbsd" ;;
        *)       table="$SUPPORT_arch" ;;
    esac
    for entry in $table; do
        [[ "${entry%%=*}" == "$tool" ]] && { printf '%s' "${entry#*=}"; return; }
    done
    printf 'no'
}

# Detected, not assumed. --os overrides, because a chroot or a rescue shell can
# look like something it is not.
detect_os() {
    local sys
    sys="$(uname -s 2>/dev/null || echo unknown)"
    case "$sys" in
        FreeBSD) echo freebsd; return ;;
        OpenBSD) echo openbsd; return ;;
    esac
    if [[ -r /etc/os-release ]]; then
        local id id_like
        id="$(. /etc/os-release 2>/dev/null && printf '%s' "${ID:-}")"
        id_like="$(. /etc/os-release 2>/dev/null && printf '%s' "${ID_LIKE:-}")"
        case "$id" in
            arch)                 echo arch;    return ;;
            gentoo)               echo gentoo;  return ;;
            raspbian|raspios)     echo raspios; return ;;
            debian)
                # Raspberry Pi OS identifies as Debian; the model file is what
                # distinguishes it from Debian on a PC.
                if [[ -r /proc/device-tree/model ]] && grep -qi raspberry /proc/device-tree/model 2>/dev/null; then
                    echo raspios; return
                fi
                echo arch; return ;;
        esac
        case "$id_like" in
            *arch*)   echo arch;   return ;;
            *gentoo*) echo gentoo; return ;;
        esac
    fi
    echo arch
}

# ─── Output helpers ───────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
    readonly C_RESET=$'\e[0m'
    readonly C_BLUE=$'\e[38;2;122;162;247m'
    readonly C_GREEN=$'\e[38;2;158;206;106m'
    readonly C_RED=$'\e[38;2;247;118;142m'
    readonly C_ORANGE=$'\e[38;2;255;158;100m'
    readonly C_DIM=$'\e[38;2;127;136;173m'
else
    readonly C_RESET='' C_BLUE='' C_GREEN='' C_RED='' C_ORANGE='' C_DIM=''
fi

info()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()    { printf '%s  ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s  ⚠%s %s\n' "$C_ORANGE" "$C_RESET" "$*" >&2; }
err()   { printf '%s  ✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
dim()   { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_RESET"; }

die() { err "$*"; exit 1; }

# Report where a failure happened rather than exiting silently.
trap 'err "Failed at line $LINENO. Nothing was installed."' ERR

# ─── Options ──────────────────────────────────────────────────────────────────

SELECTED=()
DO_ALL=false
DO_ENABLE=false
FROM_SOURCE=false
DRY_RUN=false
DO_UNINSTALL=false
# The default is what it has always been: fetch, verify, install. --pull and
# --verify carve out the halves of that for anyone who wants them separately.
DO_PULL=true
DO_INSTALL=true
DO_SETUP=false
REINSTALL=false
TARGET_OS=""
OS_EXPLICIT=false

usage() {
    sed -n '3,32p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)          DO_ALL=true ;;
        --only)         IFS=',' read -r -a SELECTED <<< "${2:-}"; shift ;;
        --enable)       DO_ENABLE=true ;;
        --from-source)  FROM_SOURCE=true ;;
        --dry-run)      DRY_RUN=true ;;
        --uninstall)    DO_UNINSTALL=true ;;
        --os)           TARGET_OS="${2:-}"; OS_EXPLICIT=true; shift ;;
        --pull)         DO_PULL=true;  DO_INSTALL=false ;;
        --install)      DO_INSTALL=true ;;
        --verify)       DO_PULL=false; DO_INSTALL=false ;;
        --reinstall)    REINSTALL=true; DO_INSTALL=true ;;
        --setup)        DO_SETUP=true ;;
        -h|--help)      usage 0 ;;
        *)              err "Unknown option: $1"; usage 1 ;;
    esac
    shift
done

# ─── Helpers ──────────────────────────────────────────────────────────────────

tool_names()  { local t; for t in "${TOOLS[@]}"; do printf '%s\n' "${t%%|*}"; done; }
tool_desc()   { local t; for t in "${TOOLS[@]}"; do [[ "${t%%|*}" == "$1" ]] && { t="${t#*|}"; printf '%s' "${t%%|*}"; return; }; done; }
tool_daemon() { local t; for t in "${TOOLS[@]}"; do [[ "${t%%|*}" == "$1" ]] && { printf '%s' "${t##*|}"; return; }; done; }

is_valid_tool() { tool_names | grep -qx "$1"; }

run() {
    if $DRY_RUN; then
        dim "would run: $*"
    else
        "$@"
    fi
}

require_root() {
    if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
        die "This needs root to install into $INSTALL_DIR. Re-run with sudo or doas."
    fi
}

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Required command '$1' not found. Install it first ($2)."
}

# ─── Uninstall ────────────────────────────────────────────────────────────────

do_uninstall() {
    require_root
    info "Removing the security suite"
    local name
    while read -r name; do
        if [[ "$(tool_daemon "$name")" == "yes" ]]; then
            if systemctl list-unit-files "${name}.service" >/dev/null 2>&1; then
                run systemctl disable --now "${name}.service" 2>/dev/null || true
            fi
            [[ -f "${SYSTEMD_DIR}/${name}.service" ]] && run rm -f "${SYSTEMD_DIR}/${name}.service"
        fi
        if [[ -f "${INSTALL_DIR}/${name}" ]]; then
            run rm -f "${INSTALL_DIR}/${name}"
            ok "removed ${name}"
        fi
    done < <(tool_names)

    run systemctl daemon-reload 2>/dev/null || true

    warn "Configuration in ${CONFIG_DIR} was left in place."
    dim "It may hold OTP secrets and duress hashes. Remove it deliberately:"
    dim "  rm -rf ${CONFIG_DIR}"
    echo
    # Installs made before the state directories were unified may still have
    # these. Listed rather than removed: they are the only copy of a tamper
    # password hash or a boot baseline on a machine that has not re-run setup.
    for legacy in /etc/arch-rusty-security-suite /etc/anti-ducky; do
        if [[ -d "$legacy" ]]; then
            warn "Pre-1.0 state also exists in ${legacy}."
            dim "  rm -rf ${legacy}"
        fi
    done
    echo
    warn "PAM was NOT modified automatically."
    dim "If you enabled OTP at login, remove the pam_exec lines from"
    dim "/etc/pam.d/system-auth BEFORE rebooting, or you may be locked out."
    exit 0
}

$DO_UNINSTALL && do_uninstall

# ─── Choose tools ─────────────────────────────────────────────────────────────

if $DO_ALL; then
    mapfile -t SELECTED < <(tool_names)
elif [[ ${#SELECTED[@]} -eq 0 ]]; then
    # Interactive: ask about each tool once, in a fixed order.
    printf '%s\n' "Select the tools to install (y/N each):"
    echo
    local_sel=()
    while read -r name; do
        printf '  %-16s %s\n' "$name" "$(tool_desc "$name")"
        read -r -p "    install ${name}? [y/N] " reply < /dev/tty || reply=n
        [[ "${reply,,}" == y* ]] && local_sel+=("$name")
        echo
    done < <(tool_names)
    SELECTED=("${local_sel[@]}")
fi

[[ ${#SELECTED[@]} -eq 0 ]] && { info "Nothing selected. Exiting."; exit 0; }

for name in "${SELECTED[@]}"; do
    is_valid_tool "$name" || die "Unknown tool '$name'. Valid: $(tool_names | paste -sd, -)"
done

# ─── Which of them can actually work here ─────────────────────────────────────
#
# Refused by name, with the reason, and dropped from the list. Installing a
# binary whose mechanism does not exist on this system produces a program that
# runs, reports nothing, and protects nothing — which is worse than not having
# it, because the machine then looks defended.

[[ -n "$TARGET_OS" ]] || TARGET_OS="$(detect_os)"
case "$TARGET_OS" in
    arch|gentoo|freebsd|openbsd|raspios) ;;
    *) die "Unknown system '$TARGET_OS'. Use one of: arch, gentoo, freebsd, openbsd, raspios." ;;
esac
if $OS_EXPLICIT; then
    info "Target system: ${TARGET_OS} (given with --os)"
else
    info "Target system: ${TARGET_OS} (detected — override with --os)"
fi

SUPPORTED=()
for name in "${SELECTED[@]}"; do
    case "$(support_of "$name" "$TARGET_OS")" in
        yes)
            SUPPORTED+=("$name") ;;
        partial)
            SUPPORTED+=("$name")
            warn "${name}: partial on ${TARGET_OS} — $(reason_for "$name" "$TARGET_OS")" ;;
        *)
            err "${name}: not installed — $(reason_for "$name" "$TARGET_OS")" ;;
    esac
done
SELECTED=("${SUPPORTED[@]}")
[[ ${#SELECTED[@]} -eq 0 ]] && die "Nothing left to install on ${TARGET_OS}."

# The published binaries are built on x86_64 Linux, and only there. On a Pi, or
# on either BSD, they are the wrong architecture or the wrong ABI and will not
# execute — so say that here rather than letting the reader discover it from
# "cannot execute binary file" after a signature check has passed.
HOST_ARCH="$(uname -m 2>/dev/null || echo unknown)"
if ! $FROM_SOURCE; then
    if [[ "$TARGET_OS" == freebsd || "$TARGET_OS" == openbsd ]]; then
        die "The released binaries are Linux ELF and will not run on ${TARGET_OS}. Re-run with --from-source."
    fi
    if [[ "$HOST_ARCH" != x86_64 && "$HOST_ARCH" != amd64 ]]; then
        die "The released binaries are x86_64 and this is ${HOST_ARCH}. Re-run with --from-source."
    fi
fi

if $DO_INSTALL; then
    info "Will install: ${SELECTED[*]}"
elif $DO_PULL; then
    info "Will download and verify, and install nothing: ${SELECTED[*]}"
else
    info "Will verify what is already here, and change nothing: ${SELECTED[*]}"
fi
$DRY_RUN && warn "Dry run — nothing will actually change."

# ─── --verify: report, change nothing ─────────────────────────────────────────
if ! $DO_PULL && ! $DO_INSTALL; then
    missing=0
    for name in "${SELECTED[@]}"; do
        if [[ -x "${INSTALL_DIR}/${name}" ]]; then
            ok "${name} installed at ${INSTALL_DIR}/${name}"
        else
            err "${name} is NOT installed"
            missing=$((missing + 1))
        fi
    done
    [[ $missing -eq 0 ]] || exit 1
    exit 0
fi

# ─── Build from source ────────────────────────────────────────────────────────

install_from_source() {
    need_cmd cargo "pacman -S rust"
    local repo_root
    repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    for name in "${SELECTED[@]}"; do
        local crate_dir="${repo_root}/security-tools/${name}"
        [[ -d "$crate_dir" ]] || die "Source for ${name} not found at ${crate_dir}"
        info "Building ${name} from source"
        run cargo build --release --manifest-path "${crate_dir}/Cargo.toml"
        run install -Dm755 "${crate_dir}/target/release/${name}" "${INSTALL_DIR}/${name}"
        ok "installed ${name} (from source)"
    done
}

# ─── Download and verify releases ─────────────────────────────────────────────

install_from_release() {
    need_cmd curl "pacman -S curl"
    need_cmd gpg "pacman -S gnupg"
    need_cmd sha512sum "pacman -S coreutils"

    local stage
    stage="$(mktemp -d)"
    # shellcheck disable=SC2064  # expand $stage now, not at trap time
    trap "rm -rf '$stage'" EXIT

    info "Importing the tilas01 signing key"
    if ! curl -fsSL "$KEY_URL" -o "${stage}/tilas01.asc"; then
        die "Could not fetch the signing key from ${KEY_URL}"
    fi
    # Check the fingerprint BEFORE importing. Importing first would seed the
    # user's keyring with an attacker's key even if we then refuse to use it.
    local fprs
    fprs="$(gpg --show-keys --with-colons "${stage}/tilas01.asc" 2>/dev/null \
            | awk -F: '$1=="fpr"{print $10}')" || true
    if [[ -z "$fprs" ]]; then
        die "The downloaded tilas01.asc is not a parseable OpenPGP key."
    fi
    for bad in "${REVOKED_FPRS[@]}"; do
        if grep -qx "$bad" <<<"$fprs"; then
            die "The served key includes REVOKED fingerprint ${bad}. Refusing to continue."
        fi
    done
    if ! grep -qx "$SIGNING_FPR" <<<"$fprs"; then
        err "Signing key fingerprint mismatch."
        dim "  expected: ${SIGNING_FPR}"
        dim "  served:   $(tr '\n' ' ' <<<"$fprs")"
        die "Refusing to install. Either this script is out of date or the key was swapped."
    fi

    if ! gpg --quiet --import "${stage}/tilas01.asc" 2>/dev/null; then
        die "Could not import the signing key."
    fi
    ok "signing key imported and pinned to ${SIGNING_FPR}"
    echo

    local base="https://github.com/${REPO}/releases/latest/download"

    # Verify everything before installing anything.
    for name in "${SELECTED[@]}"; do
        info "Fetching ${name}"
        if ! curl -fsSL "${base}/${name}" -o "${stage}/${name}"; then
            die "Could not download ${name}. Does a release asset exist for it?"
        fi
        if ! curl -fsSL "${base}/${name}.sha512" -o "${stage}/${name}.sha512"; then
            die "No SHA-512 published for ${name}. Refusing to install unverified."
        fi

        ( cd "$stage" && sha512sum -c "${name}.sha512" >/dev/null 2>&1 ) \
            || die "Hash mismatch for ${name}. The download is corrupt or tampered with."
        ok "${name}: hash verified"

        if curl -fsSL "${base}/${name}.sig" -o "${stage}/${name}.sig" 2>/dev/null; then
            ( cd "$stage" && gpg --verify "${name}.sig" "${name}" 2>/dev/null ) \
                || die "Signature invalid for ${name}. Do not install this."
            ok "${name}: signature verified"
        else
            # No signature published. Say so loudly and require consent.
            warn "${name} has no published GPG signature."
            dim "The hash proves the file is intact, but not who built it."
            if ! $DRY_RUN; then
                read -r -p "    install ${name} anyway? [y/N] " reply < /dev/tty || reply=n
                [[ "${reply,,}" == y* ]] || die "Aborted by user."
            fi
        fi
    done

    # Everything verified. --pull stops here on purpose: the point of it is to
    # fetch and check on a machine, or at a time, when installing is not wanted.
    if ! $DO_INSTALL; then
        info "Downloaded and verified. Nothing installed, as asked."
        dim "Staged in ${stage}"
        return 0
    fi

    info "Installing verified binaries"
    for name in "${SELECTED[@]}"; do
        if [[ -x "${INSTALL_DIR}/${name}" ]] && ! $REINSTALL; then
            # Re-running to add one tool should not silently rewrite the others.
            dim "${name} is already installed — leaving it. Use --reinstall to replace it."
            continue
        fi
        run install -Dm755 "${stage}/${name}" "${INSTALL_DIR}/${name}"
        ok "installed ${name} -> ${INSTALL_DIR}/${name}"
    done
}

require_root

# Every tool keeps its state in ${CONFIG_DIR}/<tool>. Create the subdirectory
# for each selected tool here rather than leaving each binary to mkdir its own:
# the daemons run with ProtectSystem=strict and ReadWritePaths=${CONFIG_DIR}, so
# a tool writing anywhere else in /etc silently fails, and this is the file that
# decides what ${CONFIG_DIR} means.
#
# 0700, not 0755. These hold password hashes and integrity baselines; the files
# themselves are 0600, and there is no reason to let a local user enumerate them.
run install -d -m 0755 "$CONFIG_DIR"
for name in "${SELECTED[@]}"; do
    run install -d -m 0700 "${CONFIG_DIR}/${name}"
done

if $FROM_SOURCE; then
    install_from_source
else
    install_from_release
fi

# ─── systemd units ────────────────────────────────────────────────────────────

write_unit() {
    local name="$1" desc="$2"
    local unit="${SYSTEMD_DIR}/${name}.service"
    if $DRY_RUN; then
        dim "would write ${unit}"
        return
    fi
    cat > "$unit" <<UNIT
[Unit]
Description=${desc}
Documentation=https://github.com/${REPO}/blob/main/website/wiki.html
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${name} --daemon
Restart=on-failure
RestartSec=5

# Hardening: this daemon does not need most of the system.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/log ${CONFIG_DIR}
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
MemoryDenyWriteExecute=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
UNIT
    chmod 0644 "$unit"
}

daemons=()
for name in "${SELECTED[@]}"; do
    [[ "$(tool_daemon "$name")" == "yes" ]] && daemons+=("$name")
done

if [[ ${#daemons[@]} -gt 0 ]]; then
    info "Writing systemd units for: ${daemons[*]}"
    for name in "${daemons[@]}"; do
        write_unit "$name" "$(tool_desc "$name")"
        ok "wrote ${name}.service"
    done
    run systemctl daemon-reload

    if $DO_ENABLE; then
        warn "Enabling daemons now, as requested with --enable."
        for name in "${daemons[@]}"; do
            run systemctl enable --now "${name}.service"
            ok "enabled ${name}"
        done
    else
        info "Daemons installed but NOT started."
        dim "Review each one's configuration first, then:"
        for name in "${daemons[@]}"; do
            dim "  systemctl enable --now ${name}.service"
        done
    fi
fi

# ─── Post-install guidance ────────────────────────────────────────────────────

echo
info "Done. ${#SELECTED[@]} tool(s) installed."
echo

for name in "${SELECTED[@]}"; do
    case "$name" in
        libre-otp)
            printf '%s  libre-otp%s — run setup before enabling it anywhere:\n' "$C_GREEN" "$C_RESET"
            dim "libre-otp --setup --mode login --hash sha1 --recovery-codes 5"
            warn "Print the recovery codes and store them OFF this machine."
            dim "Without them, losing your authenticator locks you out permanently."
            ;;
        anti-ducky)
            printf '%s  anti-ducky%s — enrol the devices you currently trust:\n' "$C_GREEN" "$C_RESET"
            # Was `--approve-current`, a flag the crate has never had, so this
            # instruction could only ever print "unexpected argument".
            dim "anti-ducky --enroll"
            dim "anti-ducky --export-whitelist   # check what it now trusts"
            warn "Do this while your real keyboard is attached, or it may block it."
            ;;
        anti-evil-maid)
            printf '%s  anti-evil-maid%s — record a baseline of the boot chain:\n' "$C_GREEN" "$C_RESET"
            dim "anti-evil-maid --setup"
            dim "Note: this runs after your firmware, so it cannot detect firmware"
            dim "tampering. See the wiki's Hardware & Firmware Security section."
            ;;
        kernel-watcher)
            printf '%s  kernel-watcher%s — initialise the watch list:\n' "$C_GREEN" "$C_RESET"
            dim "kernel-watcher --setup"
            ;;
        scarecrow)
            printf '%s  scarecrow%s — plant the canary tokens:\n' "$C_GREEN" "$C_RESET"
            dim "scarecrow --setup"
            ;;
        aur-guard)
            printf '%s  aur-guard%s — read a PKGBUILD before makepkg runs it:\n' "$C_GREEN" "$C_RESET"
            dim "aur-guard ./PKGBUILD"
            dim "aur-guard --dir ~/.cache/paru/clone/some-package"
            # Stated at install time as well as in the docs, because the whole
            # hazard with a scanner is that a clean report stops people reading.
            dim "It never says a package is safe — only what matched and what it could not read."
            ;;
    esac
    echo
done

dim "Full documentation: https://tilas01.github.io/Unix-SIT/wiki.html#security-suite"
dim "Uninstall:          $0 --uninstall"
