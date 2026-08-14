//! LUKS auto-lock: flush the master key from RAM when the machine is idle or
//! the session is locked, and make guessing at the resume prompt expensive.
//!
//! # Why a screen lock is not enough
//!
//! Locking the session leaves the LUKS master key resident in kernel memory.
//! Anyone who can get at the running machine — a DMA-capable port, a cold-boot
//! attack on the DIMMs, a kernel bug — recovers the key and with it the disk.
//! The lock screen is a UI, not a cryptographic boundary.
//!
//! `cryptsetup luksSuspend` is the actual primitive: it wipes the master key
//! from kernel memory and freezes I/O on the device until `luksResume` supplies
//! the passphrase again. After a suspend, the data on the disk is as protected
//! as it is when the machine is off.
//!
//! # The hazard that makes this delicate
//!
//! Once a device is suspended, **every** read or write to it blocks forever. If
//! the volume backs `/`, that includes the `cryptsetup` binary you are about to
//! run, the shared libraries it links, and any file you try to log to. A naive
//! implementation suspends the root device and then deadlocks trying to load the
//! code that would resume it — the machine is not locked, it is bricked until a
//! hard power cycle.
//!
//! So before suspending anything, [`lock_now`] stages `cryptsetup` and its
//! shared libraries into `/run` (a tmpfs, so RAM, so unaffected by the suspend),
//! re-reads nothing from disk afterwards, and locks its own pages with
//! `mlockall` so the kernel cannot page *itself* out to a swap device that is
//! also about to freeze. This is the same reason `arch-luks-suspend` runs from
//! an initramfs context.
//!
//! # On the brute-force delay
//!
//! The backoff here raises the cost of someone typing at the resume prompt of
//! **your running machine**. That is worth having and it is all it is.
//!
//! It is emphatically *not* equivalent to the brute-force resistance of a phone
//! with a secure element. GrapheneOS's delays are enforced by dedicated hardware
//! (Titan M / Weaver) that rate-limits key derivation itself, so bypassing the
//! OS does not bypass the delay. On a generic PC there is no such component: an
//! attacker who images the disk attacks the LUKS header **offline**, at whatever
//! rate their hardware allows, and this delay is simply not present in that
//! attack. What actually defends the imaged header is the KDF cost — LUKS2 with
//! Argon2id and a high memory cost — and a passphrase strong enough to survive
//! it. The nearest thing to a secure element on a PC is a TPM-sealed keyslot
//! with a TPM-enforced lockout (`systemd-cryptenroll --tpm2-pin=yes`), because
//! there the counter is enforced somewhere the OS cannot reach.
//!
//! See the crate README's "Honest limitations" section; this qualification
//! belongs anywhere the feature is described.

use std::time::Duration;

/// Where the auto-lock settings live. Root-owned; the interval is not a secret
/// but the mapper name is an instruction to freeze a device, and a user who can
/// rewrite it can point the timer at the wrong volume.
pub const AUTOLOCK_CONF: &str = "/etc/arch-security/anti-evil-maid/autolock.conf";

/// Tmpfs staging directory for the suspend/resume helper. Must be on a
/// memory-backed filesystem — that is the entire point.
const STAGE_DIR: &str = "/run/anti-evil-maid-suspend";

/// Failures before any delay is imposed.
///
/// Four free attempts is a deliberate concession to typos. A passphrase long
/// enough to resist offline attack is long enough to fat-finger, and a delay on
/// the first mistake trains people to choose shorter passphrases — which costs
/// far more than the four guesses it saves.
const FREE_ATTEMPTS: u32 = 4;

/// First delay imposed, in seconds, once the free attempts are used up.
const BASE_DELAY_SECS: u64 = 30;

/// Ceiling on the delay.
///
/// Capped rather than unbounded on purpose. An uncapped doubling reaches values
/// where the legitimate owner is locked out of their own machine for days by
/// someone else's failed guesses, and the machine's owner is the person most
/// likely to be typing. An hour per guess already makes online guessing useless.
const MAX_DELAY_SECS: u64 = 3600;

/// How long to wait before the next resume attempt is accepted.
///
/// Pure, so it can be tested without a disk: `failures` is the number of
/// passphrases already rejected in this suspend session.
///
/// Doubles from [`BASE_DELAY_SECS`] once [`FREE_ATTEMPTS`] are exhausted, capped
/// at [`MAX_DELAY_SECS`].
pub fn backoff_delay(failures: u32) -> Duration {
    if failures <= FREE_ATTEMPTS {
        return Duration::from_secs(0);
    }
    let steps = failures - FREE_ATTEMPTS - 1;
    // Saturating, and the shift is bounded before it is applied: `1u64 << 64` is
    // undefined-behaviour-adjacent in release builds and would wrap to a delay
    // of zero, turning the ceiling into a hole that opens after ~68 guesses.
    let delay = if steps >= 32 {
        MAX_DELAY_SECS
    } else {
        BASE_DELAY_SECS.saturating_mul(1u64 << steps)
    };
    Duration::from_secs(delay.min(MAX_DELAY_SECS))
}

/// Parses an idle interval into seconds.
///
/// Accepts the presets the front ends offer (`5m`, `15m`, `1h`, `8h`) and a
/// free-form combination of days, hours and minutes (`2d`, `1h30m`, `3d4h15m`).
/// A bare number is read as minutes, which is what someone typing `30` means.
///
/// Rejects zero. An interval of zero would suspend the volume the instant the
/// timer started, which reads as "off" to a user and as "lock immediately, over
/// and over" to a timer — the difference between those two matters enough to
/// refuse rather than guess. Use `never` to disable.
pub fn parse_interval(spec: &str) -> Result<u64, String> {
    let s = spec.trim().to_ascii_lowercase();
    if s.is_empty() {
        return Err("No interval given.".into());
    }
    if s == "never" || s == "off" || s == "disabled" {
        return Ok(0);
    }

    // A bare number means minutes.
    if s.chars().all(|c| c.is_ascii_digit()) {
        let mins: u64 = s.parse().map_err(|_| format!("Not a number: {spec}"))?;
        return checked_nonzero(mins.saturating_mul(60));
    }

    let mut total: u64 = 0;
    let mut num = String::new();
    let mut saw_unit = false;
    for c in s.chars() {
        if c.is_ascii_digit() {
            num.push(c);
            continue;
        }
        if c.is_whitespace() {
            continue;
        }
        let n: u64 = num
            .parse()
            .map_err(|_| format!("Expected a number before '{c}' in {spec:?}"))?;
        num.clear();
        let mult = match c {
            'd' => 86_400,
            'h' => 3_600,
            'm' => 60,
            's' => 1,
            other => return Err(format!("Unknown unit '{other}'. Use d, h, m or s.")),
        };
        total = total.saturating_add(n.saturating_mul(mult));
        saw_unit = true;
    }
    if !num.is_empty() {
        return Err(format!("Trailing number with no unit in {spec:?}"));
    }
    if !saw_unit {
        return Err(format!("No recognisable interval in {spec:?}"));
    }
    checked_nonzero(total)
}

fn checked_nonzero(secs: u64) -> Result<u64, String> {
    if secs == 0 {
        Err("An interval of zero would lock the disk continuously. \
             Use 'never' to turn auto-lock off."
            .into())
    } else {
        Ok(secs)
    }
}

/// Renders seconds back into the shortest human form, for confirming a setting.
pub fn format_interval(secs: u64) -> String {
    if secs == 0 {
        return "never".into();
    }
    let (d, h, m, s) = (
        secs / 86_400,
        (secs % 86_400) / 3_600,
        (secs % 3_600) / 60,
        secs % 60,
    );
    let mut out = String::new();
    if d > 0 {
        out.push_str(&format!("{d}d"));
    }
    if h > 0 {
        out.push_str(&format!("{h}h"));
    }
    if m > 0 {
        out.push_str(&format!("{m}m"));
    }
    if s > 0 {
        out.push_str(&format!("{s}s"));
    }
    out
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::Path;
    use std::process::{Command, Stdio};

    /// Parsed contents of [`AUTOLOCK_CONF`].
    #[derive(Debug, Clone)]
    pub struct AutoLockConfig {
        /// The device-mapper name, as in `/dev/mapper/<name>`.
        pub mapper: String,
        /// Idle seconds before an automatic lock; 0 means auto-lock is off.
        pub idle_seconds: u64,
    }

    pub fn load_config() -> Result<AutoLockConfig, String> {
        let raw = fs::read_to_string(AUTOLOCK_CONF)
            .map_err(|e| format!("Could not read {AUTOLOCK_CONF}: {e}"))?;
        let mut mapper = String::new();
        let mut idle_seconds = 0u64;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            match line.split_once('=') {
                Some(("mapper", v)) => mapper = v.trim().to_string(),
                Some(("idle_seconds", v)) => idle_seconds = v.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
        if mapper.is_empty() {
            return Err(format!("{AUTOLOCK_CONF} names no mapper device."));
        }
        Ok(AutoLockConfig {
            mapper,
            idle_seconds,
        })
    }

    fn write_private(path: &str, contents: &str) -> std::io::Result<()> {
        if let Some(parent) = Path::new(path).parent() {
            fs::create_dir_all(parent)?;
        }
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(contents.as_bytes())
    }

    /// Lists open LUKS mappings, so the user picks from what exists rather than
    /// typing a name that will only fail later, at the worst possible moment.
    fn open_luks_mappings() -> Vec<String> {
        let mut out = Vec::new();
        let Ok(entries) = fs::read_dir("/dev/mapper") else {
            return out;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == "control" {
                continue;
            }
            let status = Command::new("cryptsetup")
                .args(["status", &name])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output();
            if let Ok(o) = status
                && String::from_utf8_lossy(&o.stdout).contains("type:    LUKS")
            {
                out.push(name);
            }
        }
        out.sort();
        out
    }

    /// True when `/` is served by this mapping.
    ///
    /// Not a refusal — suspending the root volume is the useful case — but it
    /// decides whether the helper has to be staged into tmpfs first, and whether
    /// getting it wrong costs a hard power cycle.
    pub fn is_root_backed(mapper: &str) -> bool {
        let target = format!("/dev/mapper/{mapper}");
        let Ok(mounts) = fs::read_to_string("/proc/mounts") else {
            // Unknowable means assume yes: the expensive mistake is assuming a
            // volume is not the root one and skipping the staging.
            return true;
        };
        let canonical = fs::canonicalize(&target).ok();
        for line in mounts.lines() {
            let mut parts = line.split_whitespace();
            let (Some(src), Some(mnt)) = (parts.next(), parts.next()) else {
                continue;
            };
            if mnt != "/" {
                continue;
            }
            if src == target {
                return true;
            }
            if let (Some(c), Ok(s)) = (&canonical, fs::canonicalize(src))
                && *c == s
            {
                return true;
            }
        }
        false
    }

    /// Copies `cryptsetup` and every shared library it links into tmpfs.
    ///
    /// Everything the resume path touches must already be in RAM before the
    /// device freezes. `ldd` is read here, while the root filesystem is still
    /// live; afterwards nothing on disk is readable.
    fn stage_helper() -> Result<String, String> {
        let bin = which("cryptsetup").ok_or("cryptsetup is not on PATH.")?;

        fs::create_dir_all(STAGE_DIR).map_err(|e| format!("Could not create {STAGE_DIR}: {e}"))?;
        // /run is tmpfs on any systemd machine, but verify rather than assume:
        // staging onto the very disk that is about to freeze is the deadlock
        // this function exists to prevent, and it would look like it worked
        // right up until the suspend.
        if !is_memory_backed(STAGE_DIR) {
            return Err(format!(
                "{STAGE_DIR} is not on a memory-backed filesystem. Refusing to suspend: \
                 the helper would be read from the device it is freezing."
            ));
        }

        let staged_bin = format!("{STAGE_DIR}/cryptsetup");
        fs::copy(&bin, &staged_bin).map_err(|e| format!("Could not stage {bin}: {e}"))?;
        set_exec(&staged_bin)?;

        let libs = Command::new("ldd")
            .arg(&bin)
            .output()
            .map_err(|e| format!("Could not run ldd: {e}"))?;
        for line in String::from_utf8_lossy(&libs.stdout).lines() {
            // "libfoo.so.1 => /usr/lib/libfoo.so.1 (0x...)" and the bare
            // "/lib64/ld-linux.so.2 (0x...)" form.
            let path = match line.split(" => ").nth(1) {
                Some(rest) => rest.split(" (").next().unwrap_or("").trim(),
                None => line.split(" (").next().unwrap_or("").trim(),
            };
            if path.is_empty() || !path.starts_with('/') {
                continue;
            }
            if let Some(name) = Path::new(path).file_name() {
                let dest = format!("{}/{}", STAGE_DIR, name.to_string_lossy());
                let _ = fs::copy(path, &dest);
            }
        }
        Ok(staged_bin)
    }

    fn is_memory_backed(path: &str) -> bool {
        let Ok(mounts) = fs::read_to_string("/proc/mounts") else {
            return false;
        };
        let mut best = ("", "");
        for line in mounts.lines() {
            let mut p = line.split_whitespace();
            let (Some(_src), Some(mnt), Some(fstype)) = (p.next(), p.next(), p.next()) else {
                continue;
            };
            if path.starts_with(mnt) && mnt.len() >= best.0.len() {
                best = (mnt, fstype);
            }
        }
        matches!(best.1, "tmpfs" | "ramfs")
    }

    fn set_exec(path: &str) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Could not make {path} executable: {e}"))
    }

    fn which(prog: &str) -> Option<String> {
        for dir in std::env::var("PATH").unwrap_or_default().split(':') {
            let cand = format!("{dir}/{prog}");
            if Path::new(&cand).exists() {
                return Some(cand);
            }
        }
        for cand in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            let p = format!("{cand}/{prog}");
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
        None
    }

    /// Locks this process's pages into RAM.
    ///
    /// Without this the kernel may page the resume helper out to swap — and swap
    /// is very often on the volume being suspended, so the next instruction
    /// fetch blocks forever.
    ///
    /// Returns whether it succeeded and decides nothing itself. **The caller
    /// treats failure as fatal when the volume is root-backed** and continues
    /// otherwise, which is not the best-effort posture the rest of the suite's
    /// hardening takes: elsewhere a failed `mlockall` costs some secrecy, and
    /// here it costs the machine. Read `lock_now` before relaxing that check.
    fn mlock_self() -> bool {
        // SAFETY: mlockall takes flags and touches no memory this program owns.
        unsafe { libc::mlockall(libc::MCL_CURRENT | libc::MCL_FUTURE) == 0 }
    }

    /// Suspends the volume, then holds the resume prompt with escalating delays.
    ///
    /// Everything that can fail is checked *before* the suspend. Once the device
    /// is frozen there is no recovering from a missing binary except a power
    /// cycle, so a failure after that point is not an error path, it is data
    /// loss.
    /// Everything that must happen while the disk is still readable.
    ///
    /// Split out because two callers need the suspend and only one of them
    /// wants the resume prompt afterwards: `lock_now` holds the prompt so the
    /// owner can come back, while `suspend_only` returns so the caller can go
    /// on to power the machine off. Duplicating this would mean two copies of
    /// the staging and mlock logic, and the deadlock it prevents is not
    /// something to get right twice.
    ///
    /// On success the volume is suspended and the staged helper path is
    /// returned — the caller may exec it, but must not touch the disk for
    /// anything else.
    fn suspend_volume() -> Result<(AutoLockConfig, String), u8> {
        let cfg = match load_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("{e}");
                eprintln!("Configure it first:  sudo anti-evil-maid --configure-autolock");
                return Err(1);
            }
        };

        if !Path::new(&format!("/dev/mapper/{}", cfg.mapper)).exists() {
            eprintln!(
                "/dev/mapper/{} does not exist. Nothing to suspend.",
                cfg.mapper
            );
            return Err(1);
        }

        let root_backed = is_root_backed(&cfg.mapper);
        let helper = match stage_helper() {
            Ok(h) => h,
            Err(e) => {
                eprintln!("{e}");
                eprintln!("Refusing to suspend. Nothing was changed.");
                return Err(1);
            }
        };

        if !mlock_self() {
            eprintln!(
                "warning: could not lock memory (mlockall). If swap is on the volume \
                 being suspended, this can hang the machine. Raise RLIMIT_MEMLOCK or \
                 run as root."
            );
            if root_backed {
                eprintln!("Refusing to suspend the root volume without locked memory.");
                return Err(1);
            }
        }

        // Flush dirty pages before the device freezes. Anything still in the
        // page cache at suspend cannot be written afterwards, and for the
        // lockdown path the next step is a power cut — so this is the last
        // chance to avoid losing it.
        let _ = Command::new("sync").status();

        eprintln!("Suspending /dev/mapper/{} …", cfg.mapper);
        eprintln!("The master key is being flushed from RAM. The disk is unreadable");
        eprintln!("until the passphrase is entered.");

        let suspended = Command::new(&helper)
            .args(["luksSuspend", &cfg.mapper])
            .status();
        match suspended {
            Ok(s) if s.success() => Ok((cfg, helper)),
            Ok(s) => {
                eprintln!("cryptsetup luksSuspend failed ({s}). The volume is still open.");
                Err(1)
            }
            Err(e) => {
                eprintln!("Could not run the staged cryptsetup: {e}");
                Err(1)
            }
        }
    }

    /// Suspend the volume and return, without holding the resume prompt.
    ///
    /// For callers that are about to power the machine off — `anti-ducky`'s
    /// lockdown response. Holding a passphrase prompt would be pointless there
    /// and would stop the shutdown from ever happening.
    ///
    /// **The caller must not touch the disk after this returns.** Every path on
    /// the suspended volume blocks forever. Writes to `/proc` and `/sys` are
    /// safe because those are virtual filesystems, which is exactly why the
    /// power-off that follows uses the sysrq trigger rather than
    /// `/sbin/poweroff`.
    pub fn suspend_only() -> u8 {
        match suspend_volume() {
            Ok(_) => {
                eprintln!("Volume suspended. The master key is no longer in RAM.");
                0
            }
            Err(code) => code,
        }
    }

    pub fn lock_now() -> u8 {
        let (cfg, helper) = match suspend_volume() {
            Ok(v) => v,
            Err(code) => return code,
        };

        // From here on: no disk reads, no logging to /var, no reading /etc.
        // The counter is held in memory only — it cannot be written to a
        // suspended device, and a reboot clears it. That is acceptable, because
        // a reboot also drops the volume entirely and demands the passphrase at
        // boot; the counter is not the thing standing between an attacker and
        // the data.
        let mut failures: u32 = 0;
        loop {
            let wait = backoff_delay(failures);
            if !wait.is_zero() {
                eprintln!(
                    "Too many incorrect attempts. Waiting {} before the next try.",
                    format_interval(wait.as_secs())
                );
                std::thread::sleep(wait);
            }

            let pass = match rpassword::prompt_password("Passphrase to resume: ") {
                Ok(p) => p,
                Err(_) => {
                    // stdin is gone. Looping on a closed terminal would spin the
                    // CPU forever on a frozen disk, so wait instead and retry —
                    // exiting here would leave the volume suspended with nothing
                    // able to resume it.
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            let mut child = match Command::new(&helper)
                .args(["luksResume", &cfg.mapper, "--key-file", "-"])
                .stdin(Stdio::piped())
                .spawn()
            {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Could not run the staged cryptsetup: {e}");
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };
            if let Some(mut si) = child.stdin.take() {
                let _ = si.write_all(pass.as_bytes());
            }
            drop(pass);

            match child.wait() {
                Ok(s) if s.success() => {
                    eprintln!("Resumed.");
                    let _ = fs::remove_dir_all(STAGE_DIR);
                    return 0;
                }
                _ => {
                    failures = failures.saturating_add(1);
                    eprintln!("Incorrect passphrase.");
                }
            }
        }
    }

    /// Writes the config and the systemd units that drive the timer.
    pub fn configure(mapper: Option<String>, interval: Option<String>) -> u8 {
        let mapper = match mapper {
            Some(m) => m,
            None => {
                let found = open_luks_mappings();
                match found.len() {
                    0 => {
                        eprintln!("No open LUKS volumes found. Nothing to auto-lock.");
                        return 1;
                    }
                    1 => {
                        println!("Using the only open LUKS volume: {}", found[0]);
                        found[0].clone()
                    }
                    _ => {
                        eprintln!("Several open LUKS volumes: {}", found.join(", "));
                        eprintln!("Name one:  --configure-autolock --mapper <name>");
                        return 1;
                    }
                }
            }
        };

        let secs = match interval.as_deref() {
            Some(spec) => match parse_interval(spec) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("{e}");
                    return 1;
                }
            },
            None => 900, // 15 minutes: long enough not to interrupt, short
            // enough that a machine left on a desk is not open all afternoon.
        };

        let conf = format!(
            "# anti-evil-maid auto-lock\n\
             # Written by `anti-evil-maid --configure-autolock`.\n\
             mapper={mapper}\n\
             idle_seconds={secs}\n"
        );
        if let Err(e) = write_private(AUTOLOCK_CONF, &conf) {
            eprintln!("Could not write {AUTOLOCK_CONF}: {e}");
            eprintln!("This needs root.");
            return 1;
        }

        if let Err(e) = write_units(secs) {
            eprintln!("Could not write the systemd units: {e}");
            return 1;
        }

        println!("Auto-lock configured.");
        println!("  volume : /dev/mapper/{mapper}");
        println!("  idle   : {}", format_interval(secs));
        println!();
        if is_root_backed(&mapper) {
            println!("This is the volume backing /. Suspending it freezes every disk read");
            println!("until the passphrase is entered, so test it once while you can still");
            println!("reach the machine physically — a mistake here needs a power cycle.");
            println!();
        }
        println!("Nothing is enabled yet. When you are ready:");
        println!("  sudo systemctl enable --now anti-evil-maid-autolock.timer");
        println!();
        println!("Lock on demand at any time with:");
        println!("  sudo anti-evil-maid --lock-now");
        0
    }

    fn write_units(secs: u64) -> std::io::Result<()> {
        let service = "[Unit]\n\
             Description=Suspend the LUKS volume (flush the master key from RAM)\n\
             Documentation=https://tilas01.github.io/unix-guides-dynamic/\n\
             DefaultDependencies=no\n\
             \n\
             [Service]\n\
             Type=oneshot\n\
             ExecStart=/usr/bin/anti-evil-maid --lock-now\n\
             # The resume prompt must reach a real terminal, and the process must\n\
             # not be paged out to a swap device that is about to freeze.\n\
             StandardInput=tty-force\n\
             StandardOutput=tty\n\
             TTYPath=/dev/tty1\n\
             LimitMEMLOCK=infinity\n\
             \n\
             [Install]\n\
             WantedBy=multi-user.target\n";
        fs::write("/etc/systemd/system/anti-evil-maid-autolock.service", service)?;

        let timer = format!(
            "[Unit]\n\
             Description=Auto-lock the LUKS volume after {} idle\n\
             \n\
             [Timer]\n\
             OnUnitActiveSec={secs}\n\
             OnBootSec={secs}\n\
             AccuracySec=30s\n\
             Unit=anti-evil-maid-autolock.service\n\
             \n\
             [Install]\n\
             WantedBy=timers.target\n",
            format_interval(secs)
        );
        fs::write("/etc/systemd/system/anti-evil-maid-autolock.timer", timer)?;

        // A session-lock hook, installed but not enabled. Locking the screen is
        // the moment the user has decided they are done, which is exactly when
        // the key should stop being resident.
        let hook = "#!/bin/sh\n\
             # Suspend the LUKS volume when the session locks.\n\
             # Install: point your screen locker at this, e.g. in the lock script\n\
             # used by swaylock/hyprlock/i3lock, or via a loginctl monitor.\n\
             exec /usr/bin/anti-evil-maid --lock-now\n";
        let hook_path = "/usr/local/bin/anti-evil-maid-on-lock";
        fs::write(hook_path, hook)?;
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(hook_path, fs::Permissions::from_mode(0o700))?;
        Ok(())
    }

    /// Make the lock screen an actual cryptographic barrier.
    ///
    /// Locking the session hides the desktop. It does nothing to the LUKS master
    /// key, which stays in kernel memory for as long as the volume is open — so
    /// to anyone with a DMA-capable port or a can of freeze spray, a locked
    /// screen and an unlocked one are the same machine. This wires the two
    /// together: when logind reports the session locked, the volume is
    /// suspended and the key leaves RAM.
    ///
    /// The watcher listens for logind's `Lock` signal on the system bus rather
    /// than polling, so there is no timer-shaped window between locking the
    /// screen and the key going away. `dbus-monitor` is used rather than a
    /// D-Bus crate deliberately: it is already present on any systemd machine,
    /// and taking on a dependency to catch a signal a one-line filter already
    /// catches is not worth the supply chain.
    ///
    /// **Opt-in, and installed disabled.** Suspending the root volume freezes
    /// every disk read until the passphrase is entered, so enabling this without
    /// understanding it means the first screensaver locks you out of a running
    /// machine.
    pub fn install_lock_hook() -> u8 {
        if load_config().is_err() {
            eprintln!("Auto-lock is not configured yet, so there is no volume to suspend.");
            eprintln!("Run this first:  sudo anti-evil-maid --configure-autolock");
            return 1;
        }

        let watcher = "#!/usr/bin/env bash\n\
             # Suspend the LUKS volume whenever a session locks.\n\
             #\n\
             # A lock screen is a UI. This is what makes it a boundary: the master\n\
             # key leaves RAM the moment the screen locks, so the disk is as\n\
             # protected as it is when the machine is powered off.\n\
             set -uo pipefail\n\
             \n\
             # --profile emits one terse line per signal, which is all that is\n\
             # needed and far cheaper to parse than the default output.\n\
             dbus-monitor --system --profile \\\n\
             \x20 \"type='signal',interface='org.freedesktop.login1.Session',member='Lock'\" |\n\
             while read -r _signal; do\n\
             \x20   # Backgrounded so a suspend that is holding the resume prompt\n\
             \x20   # cannot block the watcher from seeing the next lock.\n\
             \x20   /usr/bin/anti-evil-maid --lock-now &\n\
             done\n";

        let unit = "[Unit]\n\
             Description=Suspend the LUKS volume when the session locks\n\
             Documentation=https://tilas01.github.io/unix-guides-dynamic/wiki.html#luks-autolock\n\
             After=dbus.service systemd-logind.service\n\
             Requires=dbus.service\n\
             \n\
             [Service]\n\
             Type=simple\n\
             ExecStart=/usr/local/bin/anti-evil-maid-lock-watch\n\
             Restart=on-failure\n\
             RestartSec=5\n\
             # The resume prompt has to reach a real terminal, and the process\n\
             # must not be paged out to a swap device that is about to freeze.\n\
             StandardInput=tty-force\n\
             StandardOutput=tty\n\
             TTYPath=/dev/tty1\n\
             LimitMEMLOCK=infinity\n\
             \n\
             [Install]\n\
             WantedBy=multi-user.target\n";

        let watch_path = "/usr/local/bin/anti-evil-maid-lock-watch";
        if let Err(e) = fs::write(watch_path, watcher) {
            eprintln!("Could not write {watch_path}: {e}");
            eprintln!("This needs root.");
            return 1;
        }
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(watch_path, fs::Permissions::from_mode(0o755)) {
            eprintln!("Could not make {watch_path} executable: {e}");
            return 1;
        }
        if let Err(e) = fs::write("/etc/systemd/system/anti-evil-maid-lock-watch.service", unit) {
            eprintln!("Could not write the systemd unit: {e}");
            return 1;
        }

        println!("Lock hook installed, and NOT enabled.");
        println!();
        println!("Once enabled, locking your session suspends the LUKS volume — so");
        println!("getting back in needs the disk passphrase, not just your login");
        println!("password. That is the point: it turns the lock screen from a UI");
        println!("into a cryptographic boundary.");
        println!();
        println!("`dbus-monitor` must be present (package: dbus). Check:");
        println!("  command -v dbus-monitor");
        println!();
        println!("Test it while you can still reach the machine physically, then:");
        println!("  sudo systemctl enable --now anti-evil-maid-lock-watch.service");
        0
    }

    pub fn status() -> u8 {
        match load_config() {
            Ok(c) => {
                println!("volume : /dev/mapper/{}", c.mapper);
                println!("idle   : {}", format_interval(c.idle_seconds));
                println!(
                    "root   : {}",
                    if is_root_backed(&c.mapper) {
                        "yes — suspending this freezes all disk I/O"
                    } else {
                        "no"
                    }
                );
                println!();
                println!("Backoff after {FREE_ATTEMPTS} failed attempts, doubling from");
                println!(
                    "{} to a ceiling of {}.",
                    format_interval(BASE_DELAY_SECS),
                    format_interval(MAX_DELAY_SECS)
                );
                println!();
                println!("This delay applies to someone typing at THIS machine's prompt.");
                println!("It does nothing against an attacker who images the disk and");
                println!("attacks the header offline — only the LUKS2 Argon2id cost and");
                println!("the strength of the passphrase do that.");
                0
            }
            Err(e) => {
                println!("{e}");
                1
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub use imp::{
    AutoLockConfig, configure, install_lock_hook, is_root_backed, load_config, lock_now, status,
    suspend_only,
};

#[cfg(not(target_os = "linux"))]
mod imp_stub {
    /// LUKS has no meaning off Linux; the stubs keep the crate checkable on
    /// other hosts rather than pretending the feature exists.
    pub fn lock_now() -> u8 {
        eprintln!("LUKS auto-lock is Linux-only.");
        1
    }
    pub fn suspend_only() -> u8 {
        eprintln!("LUKS auto-lock is Linux-only.");
        1
    }
    pub fn install_lock_hook() -> u8 {
        eprintln!("LUKS auto-lock is Linux-only.");
        1
    }
    pub fn configure(_mapper: Option<String>, _interval: Option<String>) -> u8 {
        eprintln!("LUKS auto-lock is Linux-only.");
        1
    }
    pub fn status() -> u8 {
        eprintln!("LUKS auto-lock is Linux-only.");
        1
    }
}

#[cfg(not(target_os = "linux"))]
pub use imp_stub::{configure, install_lock_hook, lock_now, status, suspend_only};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_attempts_are_not_delayed() {
        for n in 0..=FREE_ATTEMPTS {
            assert_eq!(backoff_delay(n), Duration::from_secs(0), "attempt {n}");
        }
    }

    #[test]
    fn backoff_doubles_then_caps() {
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 1).as_secs(), 30);
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 2).as_secs(), 60);
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 3).as_secs(), 120);
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 7).as_secs(), 1920);
        // 30 * 2^7 = 3840, over the ceiling, so this is where it flattens.
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 8).as_secs(), MAX_DELAY_SECS);
        assert_eq!(backoff_delay(FREE_ATTEMPTS + 40).as_secs(), MAX_DELAY_SECS);
        // The shift must not wrap and hand out a zero delay after ~68 guesses.
        assert_eq!(backoff_delay(u32::MAX).as_secs(), MAX_DELAY_SECS);
    }

    #[test]
    fn zero_intervals_are_rejected_but_never_is_not() {
        assert!(parse_interval("0").is_err());
        assert!(parse_interval("0m").is_err());
        assert_eq!(parse_interval("never").unwrap(), 0);
        assert_eq!(parse_interval("off").unwrap(), 0);
    }

    #[test]
    fn intervals_parse() {
        assert_eq!(parse_interval("30").unwrap(), 1800); // bare = minutes
        assert_eq!(parse_interval("15m").unwrap(), 900);
        assert_eq!(parse_interval("1h").unwrap(), 3600);
        assert_eq!(parse_interval("1h30m").unwrap(), 5400);
        assert_eq!(parse_interval("2d").unwrap(), 172_800);
        assert_eq!(parse_interval("3d4h15m").unwrap(), 274_500);
        assert_eq!(parse_interval(" 1H 30M ").unwrap(), 5400);
    }

    #[test]
    fn nonsense_intervals_are_rejected() {
        assert!(parse_interval("").is_err());
        assert!(parse_interval("soon").is_err());
        assert!(parse_interval("5x").is_err());
        assert!(parse_interval("5m30").is_err()); // trailing number, no unit
    }

    #[test]
    fn intervals_round_trip() {
        for spec in ["15m", "1h", "8h", "2d", "3d4h15m"] {
            let secs = parse_interval(spec).unwrap();
            assert_eq!(parse_interval(&format_interval(secs)).unwrap(), secs);
        }
    }
}
