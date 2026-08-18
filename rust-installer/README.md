# 🦀 *nix Install Guides: Async Rust Builder

This is a highly optimized, asynchronous deployment tool designed for rapid, multi-system Arch Linux installations.

### ⚡ The Difference: Bash vs Rust
* **Bash Script (`arch-installer.sh`)**: Runs sequentially. Standard execution logic, highly readable, and executes commands top-to-bottom.
* **Rust Builder (`arch-installer`)**: Executes network calls concurrently utilizing the `tokio` async runtime. It pre-fetches the required markdown blocks directly into RAM in parallel, entirely bypassing image downloads and Git blob history to aggressively conserve bandwidth. It compiles with maximum release optimizations (`opt-level = 3`, `lto = true`, `strip = true`).

### 🚀 One-Liner Quick Execution
To automatically install the Rust toolchain, clone the repo, compile the binary, execute it, and seamlessly clean up all dependencies afterward, simply run this from the Arch ISO:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tilas01/Unix-SIT/main/scripts/run-rust-installer.sh)"
```

### 🛠️ Manual Build Instructions
If you wish to audit and build the binary manually:
```bash
pacman -Sy --needed rustup git
rustup default stable
git clone https://github.com/tilas01/Unix-SIT.git
cd Unix-SIT/rust-installer
cargo build --release
./target/release/arch-installer
```
