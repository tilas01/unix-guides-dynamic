/* A tool's name must be one name, everywhere.
 *
 * This exists because of a real incident. The BadUSB tool is the crate
 * `anti-ducky`, ships as `/usr/bin/anti-ducky`, is enabled as
 * `anti-ducky.service`, and keeps its unlock PIN hash in
 * `/etc/arch-security/anti-ducky/`. A display rename to "Input Guard" was
 * applied to the README, the website, the docs and the icon artwork — but not,
 * of course, to any of those paths, because they are on machines that already
 * exist. For a while the site documented a tool by a name that appears nowhere
 * on a system running it, and one of the replaced strings was
 * `journalctl -u input-guard`, a unit that has never existed under that name.
 *
 * That is the same defect as documenting a command-line flag no crate handles,
 * pointed at names instead of arguments, and `tests/cli-flags.mjs` already
 * guards the flags. This guards the names.
 *
 * Two checks:
 *
 *   1. Every crate's artwork label has to be recognisably that crate. Not
 *      character-identical — "LIBRE OTP" for `libre-otp` and "SECURITY SUITE"
 *      for `unix-security-suite` are both fine — but the words have to belong
 *      to each other in one direction or the other. "INPUT GUARD" against
 *      `anti-ducky` shares nothing, which is exactly the failure.
 *
 *   2. Retired names must not come back. A name that once shipped and was
 *      withdrawn is worse than a new one, because search results and old
 *      issues still carry it.
 *
 * It fails rather than skips when it cannot find the crates or the artwork: a
 * check that quietly tests nothing reads as a pass, which this repository has
 * been bitten by before.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '..';
const TOOLS_DIR = path.join(ROOT, 'security-tools');
const ICONS = path.join(ROOT, 'scripts', 'gen-icons.py');

let checks = 0, fails = 0;
const problems = [];
function ok(cond, msg) { checks++; if (!cond) { fails++; problems.push(msg); } }

/* Names that shipped and were withdrawn. Anything here appearing in tracked
   text is a regression, not a stylistic choice.

   `retired` is matched case-insensitively as a whole phrase; `why` is printed
   so whoever trips it learns the reason rather than only the rule. */
const RETIRED = [
    { retired: 'Input Guard',
      instead: 'Anti-Ducky',
      why: 'renames a published binary: machines already carry /usr/bin/anti-ducky, ' +
           'enabled anti-ducky.service units and /etc/arch-security/anti-ducky/' },
    { retired: 'input-guard',
      instead: 'anti-ducky',
      why: 'names a systemd unit that has never existed' },
    /* The suite covers systems that are not Arch, so the Arch name in it had
       become a claim about scope rather than a name. The crate, the binary and
       the artwork moved together; only the on-disk state directory stayed, and
       deliberately — see below. */
    { retired: 'arch-security-suite',
      instead: 'unix-security-suite',
      why: 'names a crate and a binary that no longer exist under that name' },
    { retired: 'Arch Security Suite',
      instead: 'Unix Security Suite',
      why: 'describes the suite as Arch-only, which is no longer what it targets' },
    /* The repository is Unix-SIT. The old name is not merely stale: the Pages
       site moved with the repository, so every link written under the old
       spelling now returns 404.

       `allow` is the deliberate exception and it is narrow on purpose. The
       retired string survives as the legacy configuration identifier, because
       every config the site has handed out carries it and those are files
       people keep. Reading it is a promise; writing it is the regression. */
    { retired: 'unix-guides-dynamic',
      instead: 'Unix-SIT',
      why: 'names a repository and a Pages site that both 404 under that spelling',
      allow: line => line.includes('unix-guides-dynamic/config') ||
                     line.includes('CONFIG_SCHEMA_LEGACY') ||
                     line.includes('CONFIG_GENERATOR_LEGACY') }
];

/* Not retired, and not an oversight: `/etc/arch-security/` keeps its name.
   Every tool in the suite stores state there — scarecrow's three Argon2id PIN
   hashes, anti-ducky's device registry and unlock PIN, anti-evil-maid's boot
   baseline. Machines already have those files. Renaming the directory would
   orphan them silently, and a duress PIN that has quietly stopped being read is
   worse than an inelegantly named path. Moving it needs a migration step that
   runs on upgrade, not a find-and-replace. */

// ── 1. Crates exist and are readable ─────────────────────────────────────────
let crates = [];
try {
    crates = fs.readdirSync(TOOLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .filter(d => fs.existsSync(path.join(TOOLS_DIR, d.name, 'Cargo.toml')))
        .map(d => d.name);
} catch (e) {
    crates = [];
}
ok(crates.length > 0,
   `No crates found under ${TOOLS_DIR}. Treated as a failure, not a skip — ` +
   `this gate cannot verify names it cannot see.`);

// ── 2. Artwork labels belong to their crate ──────────────────────────────────
let iconSrc = '';
try { iconSrc = fs.readFileSync(ICONS, 'utf8'); } catch (_) { iconSrc = ''; }
ok(iconSrc.length > 0,
   `Could not read ${ICONS}, so no artwork label was checked. Treated as a failure.`);

/** `anti-ducky` → ['anti','ducky'];  "ANTI-DUCKY" → ['anti','ducky'] */
const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

if (iconSrc) {
    // icon("<name>", "<LABEL>", ... — the label may sit on the next line.
    const declared = new Map();
    const re = /icon\(\s*"([^"]+)"\s*,\s*\n?\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(iconSrc)) !== null) declared.set(m[1], m[2]);

    for (const crate of crates) {
        const label = declared.get(crate);
        // A crate with no mark is fine; a crate whose mark says something else
        // is not. Only assert when there is a label to assert about.
        if (!label) continue;
        const cw = new Set(words(crate));
        const lw = words(label);
        const labelInCrate = lw.every(w => cw.has(w));
        const crateInLabel = [...cw].every(w => lw.includes(w));
        ok(labelInCrate || crateInLabel,
           `crate "${crate}" is drawn with the label "${label}" — the words do not ` +
           `belong to each other, so the artwork names a different tool from the binary`);
    }
}

// ── 3. Retired names must stay retired ───────────────────────────────────────
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', 'target', '.ai']);
/* The gitignored working notes are where the decision to retire a name is
   recorded, so they have to be able to write it down. They are never published
   — see .gitignore — so a retired name there reaches no reader. */
const SKIP_FILES = new Set(['claude.md', 'gemini.md', 'agents.md', 'name-parity.mjs']);
const TEXT = /\.(md|js|mjs|html|css|json|rs|py|txt|yml|yaml|sh|toml)$/i;

function walk(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (TEXT.test(e.name) && !SKIP_FILES.has(e.name.toLowerCase()) &&
                 !e.name.toLowerCase().endsWith('.agent.md')) out.push(p);
    }
    return out;
}

const files = walk(ROOT);
ok(files.length > 50,
   `Only ${files.length} text files walked from ${ROOT} — that is too few to be the ` +
   `whole repository, so the retired-name sweep did not really run.`);

for (const spec of RETIRED) {
    const needle = spec.retired.toLowerCase();
    const hits = [];
    for (const f of files) {
        let text;
        try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
        // This gate necessarily contains the strings it forbids.
        if (path.resolve(f) === path.resolve(process.argv[1])) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().indexOf(needle) === -1) continue;
            // A named exception, judged against the line it appears on, so an
            // allowance covers the one construction it was written for and not
            // whatever else happens to sit near it.
            if (spec.allow && spec.allow(lines[i])) continue;
            hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
        }
    }
    checks++;
    if (hits.length) {
        fails++;
        problems.push(
            `"${spec.retired}" is back in ${hits.length} place(s) — use "${spec.instead}". ` +
            `It ${spec.why}.\n      ${hits.slice(0, 8).join('\n      ')}`);
    }
}

console.log(`name-parity: ${checks} checks across ${crates.length} crates and ` +
            `${files.length} files, ${fails} failed`);

if (fails) {
    console.error('\nName problems:\n');
    for (const p of problems) console.error('  - ' + p);
    console.error('\nOne name per tool, matching the binary it ships as. A tool documented\n' +
                  'under a name that appears nowhere on a machine running it is the same\n' +
                  'defect as a documented flag no crate handles.');
    process.exit(1);
}
process.exit(0);
