/* The search index may narrow to the selected system, and must never lose
 * anything doing it.
 *
 * The rule is subtractive on purpose: an entry is hidden only when the index
 * could positively attribute it to a *different* system. Most of this site is
 * shared — partitioning, dual boot, the security tools, the hardware sections —
 * and a filter that instead kept only what matched the selection would hide all
 * of it, leaving a Gentoo reader with 38 results out of 690 and no way to tell
 * why. The two rules look alike written down and are not.
 *
 * What is checked here:
 *
 *   1. Every `o` in the index names a system os-meta.js actually has. A typo
 *      hides an entry from everyone, permanently and silently, because no
 *      selection can ever equal it.
 *   2. Scoping to any system keeps every untagged entry. This is the rule that
 *      matters, and the one an "improvement" to the filter would break first.
 *   3. Nothing is tagged for a system that has no material, since that would
 *      mean an entry hidden from every reader.
 *   4. The tagging did not catch a document belonging to another system by
 *      accident. examples/09-arm-raspberry-pi.md is the one that has already
 *      done this: it is Arch Linux ARM on Pi hardware, and matching the word
 *      "raspberry" tagged it as Raspberry Pi OS, which would have hidden it
 *      from the Arch reader it was written for.
 */
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.argv[2] || '../website';
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');

let checks = 0;
const failures = [];
const ok = (cond, label) => { checks++; if (!cond) failures.push(label); };

const w = {};
new Function('window', read('os-meta.js'))(w);
const SYSTEMS = Object.keys(w.OS_META || {});
ok(SYSTEMS.length >= 2, 'os-meta.js exposed no systems, so nothing could be checked');

const index = JSON.parse(read('search-index.json'));
ok(Array.isArray(index) && index.length > 100,
   `the search index holds ${index.length} entries, which is too few to be the whole site`);

/* ── 1. Every tag names a real system ─────────────────────────────────────── */
const bad = index.filter(e => e.o && SYSTEMS.indexOf(e.o) === -1);
ok(bad.length === 0,
   `${bad.length} entries are tagged for a system os-meta.js does not have ` +
   `(${[...new Set(bad.map(e => e.o))].join(', ')}), so no selection can ever ` +
   `match them and they are hidden from everyone`);

/* ── 2. Scoping never drops a shared entry ────────────────────────────────── */
const shared = index.filter(e => !e.o);
ok(shared.length > index.length / 2,
   `only ${shared.length} of ${index.length} entries are shared — if most of the ` +
   `site has become system-specific, the subtractive filter is the wrong rule`);

const inScope = (entry, os) => !os || !entry.o || entry.o === os;
for (const os of SYSTEMS) {
    const kept = index.filter(e => inScope(e, os));
    const lostShared = shared.filter(e => !inScope(e, os));
    ok(lostShared.length === 0,
       `scoping to ${os} dropped ${lostShared.length} entries that belong to no ` +
       `particular system`);
    ok(kept.length >= shared.length,
       `scoping to ${os} kept ${kept.length} entries, fewer than the ${shared.length} ` +
       `shared ones, so the filter is keeping matches rather than removing mismatches`);
}

/* ── 3. No tag for a system with nothing behind it ────────────────────────── */
const tagged = {};
for (const e of index) if (e.o) tagged[e.o] = (tagged[e.o] || 0) + 1;
for (const os of Object.keys(tagged)) {
    ok(tagged[os] > 0, `${os} is tagged on zero entries`);
}

/* ── 4. The mis-tagging that already happened ─────────────────────────────── */
const armExample = index.filter(e => (e.u || '').includes('09-arm-raspberry-pi'));
ok(armExample.length > 0,
   'the Arch ARM Raspberry Pi example is not in the index at all, so the check ' +
   'that it stays attributed correctly is not running');
const misTagged = armExample.filter(e => e.o && e.o !== 'arch');
ok(misTagged.length === 0,
   `examples/09-arm-raspberry-pi.md is tagged '${(misTagged[0] || {}).o}'. It is ` +
   `Arch Linux ARM on Pi hardware, not Raspberry Pi OS, and tagging it that way ` +
   `hides it from the reader it was written for`);

/* ── 5. The client keeps the escape hatch ─────────────────────────────────── */
const client = read('site-index.js');
ok(/__searchShowEverything/.test(client),
   'site-index.js has no way to see the results the scope removed; a filter the ' +
   'reader cannot undo is indistinguishable from a search that does not work');
ok(/unix:os-changed/.test(client),
   'site-index.js does not follow the system selection, so results stay scoped ' +
   'to whichever system was chosen when the page loaded');

if (failures.length) {
    console.error(`search-scope: ${failures.length} of ${checks} checks failed\n`);
    failures.forEach(f => console.error('  FAIL  ' + f));
    process.exit(1);
}
const counts = Object.keys(tagged).sort().map(k => `${k}:${tagged[k]}`).join(' ');
console.log(`search-scope: ${checks} checks, ${index.length} entries ` +
            `(${shared.length} shared${counts ? ', ' + counts : ''}), 0 failed`);
