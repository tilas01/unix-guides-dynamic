<p align="center">
  <img src="assets/banner.png" width="880" alt="pi-boot-guard">
</p>

# pi-boot-guard

Reports what a Raspberry Pi is actually doing about boot integrity, and tells
you when the boot partition changes underneath you.

It reads and compares. It does not write to the EEPROM, and it does not fuse
anything.

---

## Verified boot, not measured boot

These two get used interchangeably and they are not the same thing. The
difference decides what this tool can honestly offer.

**Verified boot exists on Raspberry Pi 4 and 5.** The second-stage bootloader
lives in an on-board EEPROM and can be told to require a signed `boot.img`. The
image carries an RSA signature; a hash of the public key is burned into the
SoC's one-time-programmable memory. After that the board will not boot an image
signed by anybody else.

**Measured boot does not exist on any Raspberry Pi.** Measured boot means each
stage hashes the next and extends the result into a tamper-evident register — a
TPM's PCRs — so that releasing a secret later can be made conditional on the
whole chain. No Pi board has a TPM, so there is nowhere to extend into. An
add-on SPI or I2C TPM module can provide one. That is a piece of hardware, not
a setting, and nothing in software changes it.

So: this tool reports and checks verified boot, and says plainly that measured
boot is not available. It will not describe the EEPROM path as "measured",
and there is a test that fails the build if that word ever appears in its
summary without being denied in the same breath.

---

## Why it will not enable signed boot for you

The final step burns a hash of your public key into one-time-programmable
memory. It cannot be undone. If the private half is lost, or the wrong key is
fused, that board will never boot an image you are able to sign again.

A single command that does that, on a machine somebody is experimenting with,
is a brick generator. `--how` prints the sequence with its consequences instead,
for you to run deliberately, checking each reversible step before the one that
is not.

---

## Usage

```bash
pi-boot-guard --check                 # what is this board doing right now
pi-boot-guard --setup                 # record the boot partition as it stands
pi-boot-guard --verify                # compare it against that record
pi-boot-guard --how                   # the steps to enable signed boot, and the cost
pi-boot-guard --check --json          # the same, machine-readable
pi-boot-guard --verify --json
```

Inspecting a card from another machine, rather than running on the Pi itself:

```bash
pi-boot-guard --check --assume-pi --boot-dir /mnt/pi-boot
```

`--boot-dir` points at a mounted boot partition. `--assume-pi` skips the
hardware check, and the report says it was used, so a saved report cannot later
be mistaken for one taken on the board.

`--verify` exits non-zero when anything differs, so a timer or a script can act
on it without parsing the text.

---

## What `--setup` and `--verify` are worth

On a Pi 4 or 5 with signed boot enabled, the firmware enforces the boot image
itself and this is a second opinion.

On every other Pi — a 3, a Zero, a board where nobody has fused a key — it is
the only boot integrity available. The boot partition is a FAT filesystem that
anything with physical access can rewrite, and there is no signature check in
front of it. Noticing that it changed is worth having.

`--verify` also reports one thing no amount of file hashing would reveal: that
signed boot was enabled when the baseline was taken and is not enabled now. The
files can all match while the board's own enforcement has been switched off.

Take the baseline on a system you have reason to trust. A baseline recorded
after somebody else has had the card records their changes as normal.

---

## Honest limitations

- **It cannot tell you the boot image is genuine.** Only the firmware can, and
  only when signed boot is enabled and a key is fused. Without that, a matching
  baseline means "unchanged since you last looked", not "authentic".
- **A firmware update rewrites these files.** `--verify` will report it, and it
  is not an attack. Compare the output against what you did.
- **It does not read the OTP.** Whether a key hash is actually fused is not
  something it claims to know; it reports the EEPROM configuration and what is
  on the partition.
- **`--assume-pi` disables the only hardware check there is.** Use it for
  inspecting a mounted card, not for pretending a machine is a Pi.
- **It runs after the firmware.** Anything that has already compromised the
  bootloader can lie to everything above it, this included. That is a general
  property of software attestation and no amount of care here changes it.

---

## Building

```bash
cargo build --release
cargo test
cargo clippy --all-targets --release -- -D warnings
```

`overflow-checks` stays on in release builds, as across the whole suite: these
parse untrusted input, and a silent integer wrap in a parser is how a length
check stops being a length check.

State lives in `/etc/arch-security/pi-boot-guard/`. The baseline is staged and
renamed into place, never written in pieces — a sibling tool in this suite once
wrote its hashes one at a time, and a disk that filled between the first and the
second left a record that disagreed with an untouched system, reported tampering,
and powered the machine off. A transient disk-full should not look like an attack.

---

Licensed CC BY-NC-SA 4.0. Part of the
[*nix Install Guides](https://github.com/tilas01/Unix-SIT) security suite.
