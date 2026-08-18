/**
 * Pre-generate example guides and scripts, so the repository shows what the
 * generator produces without anyone having to run it.
 *
 * Why a curated set rather than every permutation: the walkthrough has 578
 * distinct answer combinations across the axes that actually branch the output.
 * Committing 1,156 near-duplicate files would bury the repository in content
 * nobody reads and that every diff has to scroll past, and it would go stale
 * the moment a command changes. The test harness already verifies all 578 on
 * every run; what belongs *here* is a readable sample that covers each branch
 * at least once and can be reviewed by eye.
 *
 * Each example ships as both markdown and bash, because those are the two forms
 * the site offers and they should be inspectable side by side.
 *
 *     node scripts/gen-examples.mjs
 *
 * Output: docs/examples/<slug>.md, docs/examples/<slug>.sh, docs/examples/README.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, 'website');
const OUT = path.join(ROOT, 'docs', 'examples');

const src = f => fs.readFileSync(path.join(WEB, f), 'utf8');
const load = new Function('window', 'module',
    src('manual-data.js') + '\n' + src('manual-guide.js') +
    '\nreturn { STEPS, DUSKY_LOCKS, build: window.buildManualGuide, script: window.buildManualScript };');
const { STEPS, DUSKY_LOCKS, build, script } = load({}, undefined);

const applies = (step, s) => typeof step.when !== 'function' || !!step.when(s);

/** Fills every question left unanswered by a seed, preferring the recommended option. */
function complete(seed) {
    const s = { ...seed };
    const TEXT = {
        disk: '/dev/nvme0n1', dualboot_esp: '/dev/nvme0n1p1',
        hostname: 'archbox', username: 'you', timezone: 'Europe/London'
    };
    for (let pass = 0; pass < 40; pass++) {
        let changed = false;
        for (const step of STEPS) {
            if (!applies(step, s)) {
                if (s[step.id] !== undefined) { delete s[step.id]; changed = true; }
                continue;
            }
            if (s[step.id] !== undefined) continue;
            if (s.desktop === 'dusky' && Object.hasOwn(DUSKY_LOCKS, step.id)) {
                s[step.id] = DUSKY_LOCKS[step.id];
            } else if (step.type === 'text') {
                s[step.id] = TEXT[step.id] || 'value';
            } else {
                const opts = (step.options || []).filter(o => !o.when || o.when(s));
                if (!opts.length) continue;
                const rec = opts.find(o => o.recommended) || opts[0];
                s[step.id] = step.type === 'multi'
                    ? opts.filter(o => o.recommended).map(o => o.value) || [rec.value]
                    : rec.value;
            }
            changed = true;
        }
        if (!changed) break;
    }
    return s;
}

/* One example per branch worth showing, named for what it demonstrates. */
const EXAMPLES = [
    ['01-recommended-desktop',
     'The recommended baseline: x86_64, whole disk, LUKS2, Btrfs with snapshots, UKI with your own Secure Boot keys.',
     {}],
    ['02-dual-boot-windows',
     'Alongside an existing Windows install. Shares the EFI system partition and never formats it; adds the Fast Startup, BitLocker and clock steps.',
     { dualboot: 'windows' }],
    ['03-dual-boot-linux',
     'Alongside another Linux distribution, sharing the ESP and the bootloader.',
     { dualboot: 'linux' }],
    ['04-unencrypted-ext4',
     'No encryption, ext4, systemd-boot. A desktop that never leaves the room.',
     { encryption: 'none', filesystem: 'ext4', bootloader: 'systemd-boot', snapshots: undefined }],
    ['05-luks1-legacy-bios',
     'Legacy BIOS with GRUB and LUKS1 — the constrained path, for firmware with no UEFI.',
     { firmware: 'bios', encryption: 'luks1', bootloader: 'grub' }],
    ['06-headless-server',
     'No GUI, no audio, nftables, OpenSSH hardened. A server.',
     { desktop: 'none', firewall: 'nftables', apps: ['openssh', 'git', 'btop'] }],
    ['07-libre-only',
     'Strictly libre: no microcode, no proprietary drivers, no proprietary applications.',
     { libre: 'yes' }],
    ['08-duskyos',
     'DuskyOS, the one preconfigured desktop this project installs. Shows which options it fixes for you.',
     { desktop: 'dusky' }],
    ['09-arm-raspberry-pi',
     'aarch64 on a Raspberry Pi: no ISO, no microcode, EEPROM firmware, config.txt instead of an EFI loader.',
     { arch: 'aarch64', board: 'rpi', arm_boot: 'rpi-firmware' }],
    ['10-arm-uboot-sbc',
     'aarch64 on a generic U-Boot single-board computer, booting via extlinux.conf and a device tree.',
     { arch: 'aarch64', board: 'uboot', arm_boot: 'extlinux' }],
    ['11-arm-uefi',
     'aarch64 on a board whose firmware implements UEFI — the closest ARM gets to the x86 path.',
     { arch: 'aarch64', board: 'uefi-arm', arm_boot: 'efi-arm' }],
    ['12-maximum-hardening',
     'Every non-destructive protection on: own Secure Boot keys, the whole security suite, UFW, snapshots, BusKill set to lock.',
     { secureboot: 'own-keys',
       security_tools: ['libre-otp', 'anti-ducky', 'anti-evil-maid', 'kernel-watcher', 'scarecrow', 'aur-guard'],
       buskill: 'lock', verbosity: 'debug' }]
];

fs.mkdirSync(OUT, { recursive: true });

// Clear previously generated examples so a removed one does not linger.
for (const f of fs.readdirSync(OUT)) {
    if (/^\d\d-.*\.(md|sh)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
}

const rows = [];
for (const [slug, blurb, seed] of EXAMPLES) {
    const s = complete(seed);
    const md = build(s);
    const sh = script(s);
    fs.writeFileSync(path.join(OUT, slug + '.md'), md, 'utf8');
    fs.writeFileSync(path.join(OUT, slug + '.sh'), sh, 'utf8');
    rows.push({ slug, blurb, s, mdLines: md.split('\n').length, shLines: sh.split('\n').length });
    console.log(`${slug}  ${String(md.length).padStart(6)} B md  ${String(sh.length).padStart(6)} B sh`);
}

const readme = `# Generated examples

These are real output from the [manual walkthrough](https://tilas01.github.io/Unix-SIT/manual.html)
and the [generator](https://tilas01.github.io/Unix-SIT/index.html),
committed so you can read what they produce without running anything.

Each example exists in both forms the site offers:

* **\`.md\`** — the guide. Every command with the reason it is there. Read this one.
* **\`.sh\`** — the same commands as a runnable script, built by extracting the
  fenced blocks from that same markdown, so the two cannot disagree.

> **These are examples, not something to run.** Every one of them partitions
> \`/dev/nvme0n1\` and sets the hostname to \`archbox\`. Generate your own, with
> your own disk, or read these and adapt.

## Why twelve and not all of them

The walkthrough has **578** distinct answer combinations across the axes that
actually change the output. All 578 are verified on every test run — 11,695
content assertions, and every generated script parsed by \`bash -n\`. Committing
1,156 near-identical files would bury the repository in content nobody reads and
that every diff has to scroll past. What belongs here is a sample that covers
each branch at least once and can be reviewed by eye.

Regenerate with:

\`\`\`bash
node scripts/gen-examples.mjs
\`\`\`

## The examples

| Example | What it demonstrates |
|---|---|
${rows.map(r => `| [\`${r.slug}\`](${r.slug}.md) · [script](${r.slug}.sh) | ${r.blurb} |`).join('\n')}

## What each one chose

| Example | Arch | Alongside | Encryption | Filesystem | Bootloader | Desktop |
|---|---|---|---|---|---|---|
${rows.map(r => `| \`${r.slug}\` | ${r.s.arch} | ${r.s.dualboot} | ${r.s.encryption} | ${r.s.filesystem} | ${r.s.bootloader || r.s.arm_boot} | ${r.s.desktop} |`).join('\n')}
`;

fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');
console.log(`\nwrote ${rows.length} examples + README.md to docs/examples/`);
