/* Characters that are always a mistake, anywhere in the tree.
 *
 * Text passes through a lot of hands here — editors, PowerShell redirection,
 * generated files, hand-written prose in six languages of markup — and every
 * one of them has a way of leaving something behind that nobody typed. The
 * damage is quiet: a byte-order mark makes a .json unparseable while looking
 * identical in an editor, a non-breaking space inside a shell command makes it
 * fail with an error naming the wrong thing, and a replacement character means
 * a decode already went wrong somewhere upstream and the original text is gone.
 *
 * This repository has been bitten by two of these already. `tilas01.asc` was
 * committed as UTF-16 and GnuPG could never parse it. A commit message written
 * through `Set-Content -Encoding utf8` picked up a BOM and re-encoded its box
 * drawing into `â”€`.
 *
 * Nothing here is a style opinion. Curly quotes, em dashes and emoji are all
 * used on purpose in places and are not flagged. Every character below is one
 * that no author intends.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.argv[2] || '..';

/* Only what is actually in the repository. The AI working notes are gitignored
   and never published, and one of them quotes a mangled string on purpose as a
   warning about the tool that produced it — scanning those would fail this on
   its own documentation. Asked of git rather than reimplemented, so the two
   cannot disagree about what is ignored. */
function ignoredSet(paths) {
    if (!paths.length) return new Set();
    try {
        const out = execFileSync('git', ['check-ignore', '--stdin'],
            { cwd: ROOT, input: paths.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return new Set(out.split('\n').filter(Boolean).map(p => p.split(path.sep).join('/')));
    } catch (e) {
        // Exit code 1 simply means nothing matched; anything else and we would
        // rather scan too much than silently scan nothing.
        const out = String(e.stdout || '');
        return new Set(out.split('\n').filter(Boolean).map(p => p.split(path.sep).join('/')));
    }
}

/* Directories with no hand-written text in them, or with content that is
   legitimately not UTF-8. `img` holds binaries; `.keys` holds key material;
   `archive` is kept verbatim as a record and must not be rewritten. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'img', '.keys', 'target', 'WIP']);

const TEXT = /\.(js|mjs|html|md|py|rs|sh|json|yml|yaml|css|toml|txt|asc)$/;

/* Files that are meant to hold exactly these characters, because they are
   about them. Narrow by design: a blanket exemption here would defeat the
   whole check, so each entry names one file and one reason. */
const EXEMPT = new Map([
    ['tests/stray-characters.mjs', 'this file lists the characters it forbids'],
]);

const FORBIDDEN = [
    ['�', 'U+FFFD replacement character — a decode already failed and the original text is lost'],
    ['​', 'U+200B zero-width space'],
    ['‌', 'U+200C zero-width non-joiner'],
    ['‍', 'U+200D zero-width joiner'],
    [' ', 'U+00A0 non-breaking space — write &nbsp; in markup, or a real space in code'],
    [' ', 'U+2028 line separator — a line break JavaScript sees and an editor does not'],
    [' ', 'U+2029 paragraph separator'],
];

/* Byte sequences that appear when UTF-8 is read as Latin-1 and written back.
   Matched as text after decoding, which is what the round trip leaves behind. */
const MOJIBAKE = /(â€\S|Ã¢â|â”€|Ã¯Â»Â¿|ð)/;

let checked = 0;
const failures = [];

// Collect first, so git is asked about every candidate in one call.
const candidates = [];
function collect(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) collect(p);
            continue;
        }
        if (TEXT.test(e.name)) candidates.push(p);
    }
}

function scan(files, ignored) {
    for (const p of files) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (EXEMPT.has(rel) || ignored.has(rel)) continue;

        const raw = fs.readFileSync(p);
        checked++;

        /* A byte-order mark. Legal in UTF-8 and still wrong here: it breaks
           JSON.parse, it becomes a stray character on the first line of a shell
           script, and it is invisible in every editor that would let you find
           it. */
        if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
            failures.push(`${rel}: begins with a UTF-8 byte-order mark`);
        }
        /* UTF-16, which is how tilas01.asc was once committed. A NUL byte in a
           file this list calls text is the reliable tell. */
        if (raw.includes(0x00)) {
            failures.push(`${rel}: contains NUL bytes — probably UTF-16, which parsers of this format cannot read`);
            continue;
        }

        const text = raw.toString('utf8');
        for (const [ch, why] of FORBIDDEN) {
            let n = 0, at = -1;
            while ((at = text.indexOf(ch, at + 1)) !== -1) n++;
            if (n) {
                const line = text.slice(0, text.indexOf(ch)).split('\n').length;
                failures.push(`${rel}:${line}: ${n}x ${why}`);
            }
        }
        const m = MOJIBAKE.exec(text);
        if (m) {
            const line = text.slice(0, m.index).split('\n').length;
            failures.push(`${rel}:${line}: mojibake ${JSON.stringify(m[1])} — ` +
                          `UTF-8 read as Latin-1 and written back`);
        }
    }
}

collect(ROOT);
scan(candidates, ignoredSet(candidates.map(p => path.relative(ROOT, p))));

/* A gate that reaches nothing must fail rather than report success. An earlier
   check in this suite skipped an entire block and still printed a pass, and
   only the count gave it away. */
if (checked < 50) {
    failures.push(`only ${checked} files were scanned — this gate is not reaching the tree`);
}

console.log(`stray-characters: ${checked} text files scanned, ${failures.length} problems`);
failures.forEach(f => console.log('  x ' + f));
process.exit(failures.length ? 1 : 0);
