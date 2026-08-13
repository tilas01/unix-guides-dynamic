/* Permutation harness for the manual walkthrough.
 *
 * Loads manual-data.js and manual-guide.js the way the browser does, sweeps a
 * large set of answer combinations, and asserts on the *content* of what comes
 * out — not merely that it did not throw. Then hands every generated script to
 * `bash -n`, because a guide that produces a script bash cannot parse is worse
 * than no script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const WEB = process.argv[2] || 'website';

function load(file) {
    return fs.readFileSync(path.join(WEB, file), 'utf8');
}

// Evaluate the files in one shared scope, as the browser does. os-meta.js
// first: it holds the only definition of the target systems, and manual-data.js
// throws rather than assuming Arch if it is missing.
const sandbox = { window: {}, module: undefined };
const fn = new Function('window', 'module',
    load('os-meta.js') + '\n' + load('os-install.js') + '\n' + load('manual-data.js') + '\n' + load('manual-guide.js') +
    '\nreturn { STEPS, DUSKY_LOCKS, build: window.buildManualGuide, script: window.buildManualScript, ' +
    'commandSteps: window.buildCommandSteps, isDestructive: window.isDestructiveCommand };');
const { STEPS, DUSKY_LOCKS, build, script, commandSteps, isDestructive } = fn(sandbox.window, undefined);

let checks = 0, fails = 0;
const failures = [];
function ok(cond, label) {
    checks++;
    if (!cond) { fails++; failures.push(label); }
}

function applies(step, s) {
    if (typeof step.when !== 'function') return true;
    return !!step.when(s);
}

/** Fill every applicable question, choosing option `pickIndex` where possible. */
function complete(seed, chooser) {
    const s = Object.assign({}, seed);
    let guard = 0;
    let changed = true;
    while (changed && guard++ < 50) {
        changed = false;
        for (const step of STEPS) {
            if (!applies(step, s)) { if (s[step.id] !== undefined) { delete s[step.id]; changed = true; } continue; }
            if (s[step.id] !== undefined) continue;
            if (s.desktop === 'dusky' && Object.hasOwn(DUSKY_LOCKS, step.id)) {
                s[step.id] = DUSKY_LOCKS[step.id];
            } else if (step.type === 'text') {
                s[step.id] = { disk: '/dev/nvme0n1', dualboot_esp: '/dev/nvme0n1p1',
                               hostname: 'archbox', username: 'tester',
                               timezone: 'Europe/London' }[step.id] || 'x';
            } else if (step.type === 'multi') {
                const opts = (step.options || []).filter(o => !o.when || o.when(s));
                s[step.id] = chooser.multi(step, opts);
            } else {
                const opts = (step.options || []).filter(o => !o.when || o.when(s));
                s[step.id] = chooser.one(step, opts);
            }
            changed = true;
        }
    }
    return s;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archgen-'));
let scriptsChecked = 0;

function assertGuide(s, label) {
    const md = build(s);
    const sh = script(s);

    // ── content assertions ──
    ok(md.includes(s.disk), `${label}: guide never names the target disk`);
    ok(md.includes('## 3. Install the base system'), `${label}: missing install section`);
    ok(md.includes('genfstab'), `${label}: missing genfstab`);
    ok(md.includes(s.hostname), `${label}: hostname absent`);
    ok(md.includes(s.username), `${label}: username absent`);

    // encryption reaches cryptsetup only when encryption was chosen
    const hasCrypt = /cryptsetup luksFormat/.test(md);
    ok(hasCrypt === (s.encryption !== 'none'),
        `${label}: cryptsetup present=${hasCrypt} but encryption=${s.encryption}`);
    if (s.encryption === 'luks2') {
        ok(/--type luks2 --pbkdf argon2id/.test(md), `${label}: luks2 chosen but argon2id not requested`);
    }
    if (s.encryption === 'luks1') {
        ok(/--type luks1/.test(md), `${label}: luks1 chosen but not emitted`);
        ok(!/argon2id/.test(md.split('### Encrypt')[1]?.split('```')[1] || ''),
            `${label}: argon2id emitted for luks1`);
    }

    // the right mkfs
    if (s.filesystem === 'btrfs') ok(/mkfs\.btrfs/.test(md), `${label}: btrfs chosen, mkfs.btrfs missing`);
    if (s.filesystem === 'ext4') ok(/mkfs\.ext4/.test(md), `${label}: ext4 chosen, mkfs.ext4 missing`);
    if (s.filesystem === 'xfs') ok(/mkfs\.xfs/.test(md), `${label}: xfs chosen, mkfs.xfs missing`);
    ok(/subvolume create/.test(md) === (s.filesystem === 'btrfs'),
        `${label}: subvolumes present without btrfs`);

    // snapshots only offered on btrfs
    ok(!(s.snapshots && s.filesystem !== 'btrfs'),
        `${label}: snapshots=${s.snapshots} on ${s.filesystem}`);

    // microcode: never on ARM, never under a libre policy
    const ucode = /(intel-ucode|amd-ucode)/.test(md.split('## 4.')[0]);
    if (s.arch === 'aarch64') ok(!ucode, `${label}: microcode on aarch64`);
    if (s.libre === 'yes') ok(!ucode, `${label}: microcode under a libre policy`);

    // proprietary apps must not survive a libre policy
    if (s.libre === 'yes') {
        const after = md.split('## 8.')[1] || '';
        ok(!/\bsteam\b/.test(after.split('```')[1] || ''), `${label}: steam installed under libre policy`);
        ok(!/\bdiscord\b/.test(after.split('```')[1] || ''), `${label}: discord installed under libre policy`);
    }

    // bootloader branch reaches the right commands
    if (s.arch === 'x86_64') {
        if (s.bootloader === 'grub') ok(/grub-install/.test(md), `${label}: grub chosen, grub-install missing`);
        if (s.bootloader === 'systemd-boot') ok(/bootctl install/.test(md), `${label}: systemd-boot chosen, bootctl missing`);
        if (s.bootloader === 'uki') ok(/\/etc\/kernel\/cmdline/.test(md), `${label}: uki chosen, cmdline missing`);
        if (s.bootloader === 'systemd-boot') ok(/editor no/.test(md), `${label}: systemd-boot without editor no`);
        if (s.secureboot === 'own-keys' && s.bootloader === 'uki') {
            ok(/sbctl enroll-keys/.test(md), `${label}: own keys chosen, sbctl missing`);
        }
        // sbctl must never appear when Secure Boot was declined
        if (s.secureboot === 'off') ok(!/sbctl enroll-keys/.test(md), `${label}: sbctl with secureboot off`);
    } else {
        ok(!/grub-install --target=x86_64/.test(md), `${label}: x86 grub on aarch64`);
        ok(/Arch Linux ARM|archlinuxarm/.test(md), `${label}: aarch64 without any ARM guidance`);
    }

    /* Dual boot and the EFI system partition.
     *
     * The rule is about *sharing*, not about dual booting. A partition this
     * system made for itself is ours to format; the other system's never is.
     * Keying this on `dualboot` alone was right while sharing was the only
     * option, and would now forbid the arrangement the guide recommends.
     *
     * An absent `dualboot_esp_mode` means shared, matching the emitter, so a
     * config saved before the question existed is still held to the old rule.
     *
     * Install order overrides it. Going on first means the other system is not
     * there yet, so there is no partition of its own to share and the answer to
     * the sharing question cannot be carried out whatever it says. The emitter
     * resolves that the same way, and this has to agree or the gate demands an
     * arrangement that cannot exist. */
    if (s.dualboot && s.dualboot !== 'none') {
        const espRe = new RegExp('mkfs\\.fat[^\\n]*' + s.dualboot_esp.replace(/\//g, '\\/'));
        const goesFirst = s.dualboot_order === 'first';
        if (goesFirst) {
            ok(/leave the rest of the disk unpartitioned|unpartitioned/i.test(md),
                `${label}: installed first but never says to leave space for the other system`);
            ok(!/NOT formatted/.test(md),
                `${label}: installed first, yet still says an existing ESP is shared`);
        } else if (s.dualboot_esp_mode === 'separate') {
            ok(espRe.test(md),
                `${label}: own ESP chosen but never formatted — it would be empty at boot`);
            ok(!/NOT formatted/.test(md),
                `${label}: own ESP chosen, still says the ESP is not formatted`);
            ok(/second|own EFI|this system's ESP/i.test(md),
                `${label}: own ESP chosen without saying a second one is being made`);
        } else {
            ok(!espRe.test(md), `${label}: formats the shared ESP`);
            ok(/NOT formatted/.test(md), `${label}: dual boot without the ESP warning`);
        }
        if (s.dualboot === 'windows') ok(/powercfg \/h off/.test(md), `${label}: windows dual boot without Fast Startup step`);
        if (s.dualboot === 'windows') ok(/BitLocker|manage-bde/.test(md), `${label}: windows dual boot without BitLocker warning`);
    } else {
        ok(/mkfs\.fat -F32/.test(md), `${label}: single-OS install never formats an ESP`);
    }

    // Dusky locking must actually take effect in the output
    if (s.desktop === 'dusky') {
        for (const [k, v] of Object.entries(DUSKY_LOCKS)) {
            if (STEPS.find(st => st.id === k && applies(st, s))) {
                ok(s[k] === v, `${label}: dusky lock ${k}=${s[k]} expected ${v}`);
            }
        }
        ok(/Dusky is preconfigured/.test(md), `${label}: dusky chosen without the lock explanation`);
        ok(/youtube\.com/.test(md), `${label}: dusky chosen without the video link`);
    }

    /* Command-by-command mode parses the finished guide rather than emitting a
       second time, so it is checked here against every permutation: a config
       whose guide cannot be split into steps is a config that cannot be followed
       one command at a time. */
    const cmds = commandSteps(md);
    ok(cmds.length >= 8, `${label}: guide split into only ${cmds.length} command steps`);
    ok(cmds.every(c => c.commands.trim().length > 0), `${label}: a command step has no command`);
    ok(cmds.every(c => c.title && c.title.trim().length > 0), `${label}: a command step has no title`);
    ok(cmds.every((c, i) => c.n === i + 1), `${label}: command steps are misnumbered`);
    // At least half must carry either a reason or an expected output, or the
    // mode degenerates into a list of bare commands.
    const explained = cmds.filter(c => c.why || c.expected).length;
    ok(explained * 2 >= cmds.length,
       `${label}: only ${explained}/${cmds.length} command steps explain themselves`);
    // Destructive detection has to fire where the guide really does destroy
    // data, because that is what gates the typed confirmation.
    if (/cryptsetup\s+luksFormat|sgdisk|mkfs\./.test(md)) {
        ok(cmds.some(c => c.destructive),
           `${label}: the guide partitions or formats but no command step is flagged destructive`);
    }
    // The flag must agree with the predicate the UI actually gates on. Asserted
    // against the exported function rather than a second copy of the pattern
    // list here, because that is precisely how the two drifted: the test called
    // snapper's `rm -rf /.snapshots` destructive and the implementation did not.
    const disagree = cmds.find(c => c.destructive !== isDestructive(c.commands));
    ok(!disagree,
       `${label}: "${disagree ? disagree.title : ''}" disagrees with isDestructiveCommand()`);
    // And routine plumbing must not be gated. Confirmation fatigue on a
    // non-event is what makes people type past the one that matters.
    const overGated = cmds.find(c => c.destructive &&
        /^(?:Snapshots|Services|Firewall|Post-install|Ricing)/i.test(c.title));
    ok(!overGated,
       `${label}: "${overGated ? overGated.title : ''}" gated behind a destructive confirmation`);

    // destructive options must always carry a warning
    if (s.buskill === 'shutdown') ok(/cuts power|Unsaved\s+work is gone/i.test(md), `${label}: buskill shutdown without warning`);

    // the script must be parseable
    const p = path.join(tmp, 'g.sh');
    fs.writeFileSync(p, sh);
    try {
        execFileSync('bash', ['-n', p], { stdio: 'pipe' });
        scriptsChecked++;
    } catch (e) {
        fails++; checks++;
        failures.push(`${label}: bash -n rejected the generated script: ${String(e.stderr || e).slice(0, 300)}`);
    }
    ok(sh.includes('set -Eeuo pipefail'), `${label}: script without strict mode`);
    ok(/Type YES to continue/.test(sh), `${label}: script without the read-it confirmation`);
    if (s.verbosity === 'debug') {
        ok(sh.split(/\r?\n/).some(x => x.startsWith('set -x')),
            `${label}: debug verbosity without set -x`);
    }

    return { md, sh };
}

// ── Sweep ────────────────────────────────────────────────────────────────────
// Every combination of the axes that actually branch the output, with the
// remaining questions filled by first / last / recommended option in rotation.
const AXES = {
    arch: ['x86_64', 'aarch64'],
    dualboot: ['none', 'windows', 'linux', 'arch'],
    encryption: ['luks2', 'luks1', 'none'],
    filesystem: ['btrfs', 'ext4', 'xfs'],
    desktop: ['dusky', 'hyprland', 'dwm', 'none'],
    libre: ['yes', 'no']
};

const strategies = [
    { name: 'first', one: (st, o) => o[0].value, multi: (st, o) => o.length ? [o[0].value] : [] },
    { name: 'last', one: (st, o) => o[o.length - 1].value, multi: (st, o) => o.map(x => x.value) },
    { name: 'rec', one: (st, o) => (o.find(x => x.recommended) || o[0]).value,
      multi: (st, o) => o.filter(x => x.recommended).map(x => x.value) }
];

let n = 0;
for (const arch of AXES.arch)
for (const dualboot of AXES.dualboot)
for (const encryption of AXES.encryption)
for (const filesystem of AXES.filesystem)
for (const desktop of AXES.desktop)
for (const libre of AXES.libre) {
    const strat = strategies[n % strategies.length];
    const seed = { arch, dualboot, encryption, filesystem, desktop, libre };
    const s = complete(seed, strat);
    assertGuide(s, `#${n} ${arch}/${dualboot}/${encryption}/${filesystem}/${desktop}/libre=${libre}/${strat.name}`);
    n++;
}

// Targeted cases the sweep does not reach.
assertGuide(complete({ arch: 'x86_64', dualboot: 'none', encryption: 'luks2', filesystem: 'btrfs',
                       desktop: 'none', libre: 'no', bootloader: 'uki', secureboot: 'own-keys',
                       verbosity: 'debug' }, strategies[2]), 'targeted: uki+ownkeys+debug');
assertGuide(complete({ arch: 'x86_64', dualboot: 'none', encryption: 'none', filesystem: 'ext4',
                       desktop: 'none', libre: 'no', buskill: 'shutdown' }, strategies[2]),
            'targeted: buskill shutdown');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`permutations: ${n + 2}`);
console.log(`assertions:   ${checks}`);
console.log(`scripts parsed by bash -n: ${scriptsChecked}`);
if (fails) {
    console.log(`\nFAILURES (${fails}):`);
    [...new Set(failures)].slice(0, 40).forEach(f => console.log('  - ' + f));
    process.exit(1);
}
console.log('\nALL PASS');
