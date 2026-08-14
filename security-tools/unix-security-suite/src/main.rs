//! unix-security-suite — all five tilas01 security tools in one binary.
//!
//! Each tool remains its own crate and can still be built and shipped
//! standalone; this links them all in and dispatches by subcommand, so a user
//! who wants the whole suite installs and updates exactly one file.
//!
//! Why a dispatcher rather than a merged program: the tools have genuinely
//! different lifetimes. Anti-Ducky and Kernel Watcher are long-running daemons,
//! Anti-Evil Maid is a one-shot boot check, and Libre OTP is invoked by PAM.
//! Merging them into a single process would mean one crash takes down all five,
//! and PAM would be loading a binary that also wants to run watcher threads.
//! Separate subcommands keep the failure domains apart while still shipping one
//! artefact.
//!
//! Every subcommand also accepts `--gui`, which opens that tool's own interface.
//! Where no display server is available the tools fall back to their interactive
//! CLI, so the same command works on Wayland, Xorg and a bare TTY.

use clap::{Parser, Subcommand};
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "unix-security-suite",
    version,
    about = "All five tilas01 security tools in one binary",
    long_about = None,
    after_help = "\
Docs:      https://tilas01.github.io/unix-guides-dynamic/wiki.html#security-suite
Verify:    gpg --verify unix-security-suite.sig unix-security-suite

Provided AS IS with no warranty. Several of these can lock you out of your own
machine if misconfigured. Read the wiki before enabling anything."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// TOTP/HOTP two-factor for boot, login and SSH.
    ///
    /// Defaults to a silent tamper check: one secret, never displayed, compared
    /// internally at boot so a mismatch means the boot chain changed.
    Otp {
        /// Open the graphical interface instead of the CLI.
        #[arg(long)]
        gui: bool,
    },

    /// Anti-Ducky — blocks BadUSB keystroke-injection devices.
    Ducky {
        #[arg(long)]
        gui: bool,
    },

    /// Anti-Evil Maid — boot integrity verification and decoy entries.
    Aem {
        #[arg(long)]
        gui: bool,
        /// Record a new baseline of the current boot chain.
        #[arg(long)]
        setup: bool,
        /// Run the boot check once and report (used by the systemd unit).
        #[arg(long)]
        daemon: bool,
        /// Deep filesystem hash verification.
        #[arg(long)]
        fs_hash_check: bool,
        /// Kernel to treat as the real boot target.
        #[arg(long)]
        main_kernel: Option<String>,
        /// Fallback kernel.
        #[arg(long)]
        backup_kernel: Option<String>,
        /// Number of decoy kernel entries, or "random".
        #[arg(long)]
        decoy_count: Option<String>,
    },

    /// Kernel Watcher — filesystem monitor for infostealers and rootkits.
    Watch {
        #[arg(long)]
        gui: bool,
        /// Initialise the watch list, then exit.
        #[arg(long)]
        setup: bool,
    },

    /// Scarecrow — canary tokens and sandbox spoofing.
    Scarecrow {
        #[arg(long)]
        gui: bool,
        /// Handle a duress login.
        #[arg(long)]
        duress: bool,
        /// Ask for confirmation before acting on a duress login.
        #[arg(long, default_value_t = true)]
        confirm: bool,
    },

    /// List the tools in this build and what each subcommand does.
    List,
}

/// Runs a tool's GUI, falling back to a clear message when no display is
/// available rather than failing with a raw winit error.
fn run_gui(name: &str, result: eframe::Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Could not open the {name} interface: {e}");
            eprintln!();
            eprintln!("This usually means no display server is reachable (no Wayland");
            eprintln!("compositor or X server, or DISPLAY/WAYLAND_DISPLAY is unset).");
            eprintln!("Run the same subcommand without --gui to use the CLI instead.");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    // First statement, before argument parsing, and for the same reason every
    // tool in the suite does it in its own main(): a crash any time before this
    // call still dumps the whole address space, and several of the subcommands
    // below read a passphrase, an OTP secret or a duress PIN into it.
    //
    // This binary needs its own call rather than inheriting one. The tools each
    // harden inside `main()`, and the dispatch below enters their *library*
    // functions instead — so the all-in-one build, which is the one the site
    // recommends because it is a single file to install and verify, was the
    // only artefact in the suite running with memory swappable, core dumps
    // enabled and ptrace attach permitted.
    let _hardening = suite_hardening::harden_process();

    let cli = Cli::parse();

    match cli.command {
        Command::Otp { gui } => {
            if gui {
                return run_gui("Libre OTP", libre_otp::gui::start_gui());
            }
            // run() inspects the remaining argv for its own flags (--setup,
            // --hash=, ...), so passing them through after the subcommand works.
            libre_otp::run();
            ExitCode::SUCCESS
        }

        Command::Ducky { gui } => {
            if gui {
                return run_gui("Anti-Ducky", anti_ducky::gui::start_gui());
            }
            anti_ducky::run();
            ExitCode::SUCCESS
        }

        Command::Aem {
            gui,
            setup,
            daemon,
            fs_hash_check,
            main_kernel,
            backup_kernel,
            decoy_count,
        } => {
            if gui {
                return run_gui("Anti-Evil Maid", anti_evil_maid::gui::start_gui());
            }
            // With no action flag, default to the check rather than printing
            // usage: this is what the systemd unit and the boot hook invoke.
            if !setup && !daemon && !fs_hash_check {
                anti_evil_maid::start_monitor();
                return ExitCode::SUCCESS;
            }
            anti_evil_maid::run(
                setup,
                main_kernel,
                backup_kernel,
                daemon,
                decoy_count,
                fs_hash_check,
            );
            ExitCode::SUCCESS
        }

        Command::Watch { gui, setup } => {
            if gui {
                return run_gui("Kernel Watcher", kernel_watcher::gui::start_gui());
            }
            if setup {
                kernel_watcher::run_setup();
            } else {
                kernel_watcher::start_watcher();
            }
            ExitCode::SUCCESS
        }

        Command::Scarecrow {
            gui,
            duress,
            confirm,
        } => {
            if gui {
                return run_gui("Scarecrow", scarecrow::gui::start_gui());
            }
            if duress {
                scarecrow::handle_duress_login(confirm);
            } else {
                scarecrow::init_scarecrow();
            }
            ExitCode::SUCCESS
        }

        Command::List => {
            println!("unix-security-suite {}", env!("CARGO_PKG_VERSION"));
            println!("All five tools are linked into this single binary.\n");
            println!("  otp        Libre OTP — two-factor / silent boot tamper check");
            println!("  ducky      Anti-Ducky — blocks BadUSB keystroke injection");
            println!("  aem        Anti-Evil Maid — boot integrity and decoy entries");
            println!("  watch      Kernel Watcher — infostealer and rootkit monitor");
            println!("  scarecrow  Scarecrow — canary tokens and sandbox spoofing");
            println!("\nEvery subcommand accepts --gui for that tool's interface,");
            println!("and falls back to the interactive CLI when no display is available.");
            println!("\nDocs: https://tilas01.github.io/unix-guides-dynamic/wiki.html#security-suite");
            ExitCode::SUCCESS
        }
    }
}
