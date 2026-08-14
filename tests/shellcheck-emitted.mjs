/* shellcheck over the scripts this project hands people.
 *
 * `permutations` and `os-permutations` already run every generated script
 * through `bash -n`. That proves the file parses and nothing else: `bash -n`
 * has no opinion about an unquoted variable that word-splits on a path with a
 * space, a `cd` whose failure is ignored before an `rm -rf`, or a comparison
 * that is always true. Those are the mistakes that turn a working install into
 * a destroyed disk, and they parse perfectly.
 *
 * The emitted scripts are the product here, so they are held to the same
 * standard as source. Every system is swept, not only Arch, because the systems
 * that are still being written are the ones most likely to grow a new one.
 *
 * ── Severity ────────────────────────────────────────────────────────────────
 * `error` and `warning` fail. `info` and `style` are printed and do not, since
 * those are largely preference and this generator emits a deliberate house
 * style. The exclusions below are narrow and each one carries its reason; a
 * blanket `--severity=error` would hide exactly the class of defect this gate
 * exists to find.
 *
 * ── When shellcheck is not installed ────────────────────────────────────────
 * Locally it is skipped with a visible notice, because requiring it would stop
 * anyone working on the site from running the suite at all. In CI a missing
 * shellcheck is a FAILURE, not a skip — a gate that quietly does not run reads
 * as a pass, and this repository has been bitten by exactly that before.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const WEB = process.argv[2] || '../website';

function load(file) { return fs.readFileSync(path.join(WEB, file), 'utf8'); }

const sandbox = { window: {} };
const fn = new Function('window', 'module',
    load('os-meta.js') + '\n' + load('os-install.js') + '\n' + load('dns-providers.js') + '\n' +
    load('manual-data.js') + '\n' + load('manual-guide.js') +
    '\nreturn { STEPS, OS_META: window.OS_META, script: window.buildManualScript };');
const { STEPS, OS_META, script } = fn(sandbox.window, undefined);

let checks = 0, fails = 0;
const failures = [];
const ok = (cond, label) => { checks++; if (!cond) { fails++; failures.push(label); } };

/* Checks that are switched off, each for a stated reason rather than because it
   was noisy. Anything not listed here is enforced. */
const EXCLUDE = [
    /* SC2154: "referenced but not assigned". The scripts deliberately read
       variables the reader is told to set — STAGE3_URL, THIS_SYSTEM_SIZE — and
       each one is checked before use, which is the pattern this project uses
       for a blank that must fail closed. */
    'SC2154',
    /* SC2016: single quotes stopping expansion. Heredocs that write shell and
       systemd unit files quote on purpose: the point is that $VAR reaches the
       written file rather than being expanded while writing it. */
    'SC2016'
].join(',');

function have(cmd) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return !r.error;
}

const inCI = process.env.CI === 'true' || process.env.CI === '1' ||
             !!process.env.GITHUB_ACTIONS;

if (!have('shellcheck')) {
    if (inCI) {
        console.log('shellcheck-emitted: shellcheck is NOT INSTALLED and this is CI.');
        console.log('');
        console.log('Failing rather than skipping. A gate that quietly does not run reads as');
        console.log('a pass, and the emitted scripts would then ship unchecked. Install it in');
        console.log('the workflow before this step.');
        process.exit(1);
    }
    console.log('shellcheck-emitted: SKIPPED — shellcheck is not installed here.');
    console.log('  Install it to run this locally; CI treats a missing shellcheck as a');
    console.log('  failure, so the emitted scripts are checked there either way.');
    process.exit(0);
}

/* One configuration per system, chosen to exercise the paths most likely to
   produce a quoting or ordering mistake: encryption, dual boot, a desktop, and
   the security tools that write files from heredocs. */
function baseConfig(osKey) {
    return {
        os: osKey,
        arch: osKey === 'raspios' ? 'aarch64' : 'x86_64',
        disk: '/dev/nvme0n1',
        dualboot: 'linux',
        dualboot_esp: '/dev/nvme0n1p1',
        dualboot_esp_mode: 'separate',
        dualboot_order: 'second',
        dualboot_owner: 'this',
        dualboot_default: 'this',
        encryption: 'luks2',
        filesystem: 'btrfs',
        swap: 'zram',
        timezone: 'Europe/London',
        locale: 'en_US.UTF-8',
        keymap: 'us',
        bootloader: 'grub',
        kernels: ['linux'],
        microcode: 'amd-ucode',
        libre: 'no',
        desktop: 'gnome',
        network: 'networkmanager',
        firewall: 'ufw',
        snapshots: 'snapper',
        apps: ['firefox', 'openssh'],
        security_tools: ['libre-otp', 'anti-ducky', 'anti-evil-maid'],
        gentoo_stage3: 'openrc',
        gentoo_kernel: 'bin',
        gentoo_binpkgs: 'big',
        gentoo_makeopts: 'nproc',
        gentoo_use: 'profile'
    };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shellcheck-'));
const findings = [];

for (const osKey of Object.keys(OS_META)) {
    let sh;
    try {
        sh = script(baseConfig(osKey));
    } catch (e) {
        ok(false, `${OS_META[osKey].label}: the emitter threw — ${e.message}`);
        continue;
    }
    ok(typeof sh === 'string' && sh.length > 200,
       `${OS_META[osKey].label}: produced no script to check`);
    if (!sh) continue;

    const file = path.join(tmp, `${osKey}.sh`);
    fs.writeFileSync(file, sh.startsWith('#!') ? sh : '#!/usr/bin/env bash\n' + sh);

    /* --severity=warning, so `info` and `style` are not failures. Read as JSON
       so the reported line can be quoted back rather than leaving somebody to
       find it in a generated file they cannot easily reproduce. */
    let out = '';
    try {
        out = execFileSync('shellcheck',
            ['--format=json', '--severity=warning', `--exclude=${EXCLUDE}`, file],
            { encoding: 'utf8' });
        checks++;                       // clean
    } catch (e) {
        out = String(e.stdout || '');
        let items = [];
        try { items = JSON.parse(out); } catch (_) { items = []; }
        if (!items.length) {
            fails++; checks++;
            failures.push(`${OS_META[osKey].label}: shellcheck failed but produced no ` +
                          `parseable output — ${String(e.stderr || e.message).split('\n')[0]}`);
            continue;
        }
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (const it of items) {
            fails++; checks++;
            const src = (lines[it.line - 1] || '').trim();
            failures.push(`${OS_META[osKey].label}: SC${it.code} at line ${it.line} — ` +
                          `${it.message}\n      ${src}`);
        }
        findings.push(`${OS_META[osKey].label}: ${items.length}`);
    }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`shellcheck-emitted: ${Object.keys(OS_META).length} systems, ` +
            `${checks} checks, ${fails} failed`);
if (findings.length) console.log('  findings per system: ' + findings.join(', '));
console.log('');
if (fails) {
    failures.forEach(f => console.log('  x ' + f));
    console.log('');
    console.log('These parse fine. bash -n cannot see any of them, which is why this');
    console.log('gate exists: the scripts here are the product, not a build artefact.');
    process.exit(1);
}
console.log('ALL PASS');
