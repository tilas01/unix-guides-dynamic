/* Memory-safety accounting for the crates.
 *
 * These tools parse untrusted input, hold passphrases in memory and erase LUKS
 * keyslots. Rust makes most of that safe by construction, which is exactly why
 * the places where it does not are worth counting: every `unsafe` block is a
 * spot where the compiler stopped checking and a person promised instead.
 *
 * The rule is not "no unsafe" — these tools need libc for `mlockall`, `prctl`
 * and `setrlimit`, and there is no safe way to make those calls. The rule is
 * that the promise is written down. An `unsafe` block with a `SAFETY:` comment
 * naming the invariant can be reviewed; one without it cannot be distinguished
 * from an oversight, and reviewing it means re-deriving what the author knew.
 *
 * Also checked: `overflow-checks` stays on in release builds. These parse
 * untrusted lengths, and a silent wrap is a bug that only exists in the build
 * people actually install.
 *
 * Only the crates' own sources are read. `target/` holds generated bindings
 * for dependencies, which are full of `unsafe` and are not ours to annotate.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '..';
const TOOLS = path.join(ROOT, 'security-tools');

let checks = 0, fails = 0;
const failures = [];
const ok = (cond, label) => { checks++; if (!cond) { fails++; failures.push(label); } };

function sources(dir) {
    const out = [];
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                // Build output, not source. It carries other people's unsafe.
                if (e.name === 'target' || e.name === '.git') continue;
                walk(p);
            } else if (e.name.endsWith('.rs')) {
                out.push(p);
            }
        }
    };
    walk(dir);
    return out;
}

const crates = fs.readdirSync(TOOLS, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(TOOLS, name, 'Cargo.toml')));

ok(crates.length > 0, 'no crates found — this gate checked nothing');

let unsafeTotal = 0, annotated = 0;

for (const crate of crates) {
    const src = path.join(TOOLS, crate, 'src');
    if (!fs.existsSync(src)) continue;

    for (const file of sources(src)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');

        lines.forEach((line, i) => {
            /* `unsafe` as a keyword introducing a block or an expression.
               Skipped: the word inside a comment or a string, which is prose
               about unsafety rather than an instance of it. */
            const code = line.replace(/\/\/.*$/, '');
            if (!/\bunsafe\s*[{(]|\bunsafe\s+(fn|impl|extern)\b/.test(code)) return;
            unsafeTotal++;

            /* The justification may sit on the same line or in the comment
               block immediately above, which is where rustfmt tends to leave
               it. Six lines back is generous enough for a wrapped sentence and
               tight enough that it cannot pick up an unrelated comment from a
               previous item. */
            let found = /SAFETY:/i.test(line);
            for (let back = 1; back <= 6 && !found; back++) {
                const prev = lines[i - back];
                if (prev === undefined) break;
                if (/SAFETY:/i.test(prev)) { found = true; break; }
                // A non-comment, non-blank line means the comment block above
                // belongs to something else.
                if (prev.trim() !== '' && !/^\s*(\/\/|\/\*|\*)/.test(prev)) break;
            }
            if (found) annotated++;
            ok(found,
               `${rel}:${i + 1}: unsafe with no SAFETY: comment — the compiler stopped ` +
               `checking here and nothing records what makes it sound\n      ${line.trim()}`);
        });
    }

    /* overflow-checks in release. Absent means Rust's default, which is OFF for
       release — so absence is a finding, not a neutral state. */
    const manifest = fs.readFileSync(path.join(TOOLS, crate, 'Cargo.toml'), 'utf8');
    const isBin = /\[\[bin\]\]|^name\s*=/m.test(manifest);
    if (!isBin) continue;
    const relProfile = /\[profile\.release\][\s\S]*?(?=\n\[|$)/.exec(manifest);
    const hasOverflow = relProfile && /overflow-checks\s*=\s*true/.test(relProfile[0]);
    ok(hasOverflow,
       `security-tools/${crate}/Cargo.toml: no 'overflow-checks = true' under ` +
       `[profile.release] — release is the build people install, and it is the ` +
       `one where a wrap is silent`);
}

/* ── Every binary that can hold a secret hardens itself ──────────────────────
 *
 * `harden_process()` locks memory against swap, turns off core dumps and
 * refuses ptrace attach. It has to be called by the binary that actually runs,
 * and "the binary that runs" is not always the crate you think: the all-in-one
 * build has its own `main()` and dispatches into the other tools' *library*
 * functions, so it inherits nothing from their `main()`s. That gap shipped once
 * — the artefact the site recommends, because it is one file to install and
 * verify, was the only one running unhardened.
 *
 * Listed by name rather than inferred. A crate that genuinely holds no secret
 * does not need this, and saying which is which in a table beats a rule that
 * quietly grows exceptions. */
const MUST_HARDEN = {
    'libre-otp': 'holds OTP secrets and reads passphrases through PAM',
    'anti-evil-maid': 'reads the LUKS passphrase and suspends the volume',
    'scarecrow': 'compares duress PIN hashes',
    'anti-ducky': 'holds the unlock PIN and the device registry',
    'kernel-watcher': 'reads process and connection state across the machine',
    'pi-boot-guard': 'reads boot state and can write EEPROM configuration',
    'unix-security-suite': 'dispatches into all of the above from its own main()'
};

for (const [crate, why] of Object.entries(MUST_HARDEN)) {
    const dir = path.join(TOOLS, crate, 'src');
    if (!fs.existsSync(dir)) {
        ok(false, `${crate}: listed as needing hardening and has no src/ — renamed or removed?`);
        continue;
    }
    const called = sources(dir).some(f =>
        /suite_hardening::harden_process\s*\(|\bharden_process\s*\(/.test(fs.readFileSync(f, 'utf8')));
    ok(called,
       `security-tools/${crate}: never calls harden_process() — it ${why}, so its ` +
       `memory can be swapped to disk, core-dumped and read by ptrace`);

    const manifest = fs.readFileSync(path.join(TOOLS, crate, 'Cargo.toml'), 'utf8');
    ok(/suite-hardening\s*=/.test(manifest),
       `security-tools/${crate}/Cargo.toml: does not depend on suite-hardening, so the ` +
       `call above cannot be the real one`);
}

console.log(`rust-safety: ${crates.length} crates, ${checks} checks, ${fails} failed`);
console.log(`  unsafe blocks: ${unsafeTotal}, of which ${annotated} carry a SAFETY: comment`);
console.log('');
if (fails) {
    failures.forEach(f => console.log('  x ' + f));
    process.exit(1);
}
console.log('ALL PASS');
