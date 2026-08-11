/* The same question os-permutations.mjs asks, aimed at the other front end.
 *
 * `os-permutations` loads manual-data.js and manual-guide.js and sweeps every
 * system through them. That is the walkthrough. The generator is index.html
 * plus script.js — a different implementation by an explicit decision, sharing
 * only the JSON envelope — and nothing measured it, so its leakage numbers were
 * not merely unknown, they were being read as the walkthrough's.
 *
 * The generator is DOM-driven and cannot be called as a function, which is why
 * `parity-five-installs` reports it "not driveable headlessly" and skips it. It
 * is driveable: served over real HTTP and loaded with scripts running, exactly
 * as page-runtime-audit does, `window.generateOutput()` runs and stages its
 * output in sessionStorage through stageForLiveEditor(). That staging is the
 * capture point — the same three keys the Live Editor reads, so this measures
 * what a reader would actually carry away rather than a private variable.
 *
 * Severity follows os-permutations exactly, and for the same reason:
 *
 *   FAIL, always      output that did not build, a hole where an answer should
 *                     be, or a script `bash -n` cannot parse
 *   FAIL, if complete tooling belonging to another system
 *   REPORT, if badged the same leakage, counted — that is the remaining work,
 *                     and the number is the size of it
 *
 * Reaching a badged system needs the lock lifted. `setTargetOS()` refuses one,
 * and so does `chosenOS()`, so a hand-written sessionStorage value will not do
 * it either — that defence in depth is deliberate and worth keeping. The badge
 * is lifted on the loaded page instead, which asks precisely the question the
 * completion plan asks: what would a reader see the day this badge comes off?
 * The real value is read first, so severity is decided by what os-meta.js
 * actually says and not by what the harness did to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { serve, loadPage } from './serve.mjs';

const WEB = process.argv[2] || '../website';

/* Kept in step with the same table in os-permutations.mjs. Two copies rather
   than a shared module because these are plain scripts with no build step; if
   one gains an entry the other wants it too. */
const OWNED = [
    { re: /\bpacstrap\b/g,   owner: 'arch',    what: 'pacstrap' },
    { re: /\bpacman\b/g,     owner: 'arch',    what: 'pacman' },
    { re: /\bmakepkg\b/g,    owner: 'arch',    what: 'makepkg' },
    { re: /\bparu\b/g,       owner: 'arch',    what: 'paru' },
    { re: /\bmkinitcpio\b/g, owner: 'arch',    what: 'mkinitcpio' },
    { re: /\bemerge\b/g,     owner: 'gentoo',  what: 'emerge' },
    { re: /\bpkg_add\b/g,    owner: 'openbsd', what: 'pkg_add' },
    { re: /\bbsdinstall\b/g, owner: 'freebsd', what: 'bsdinstall' },
];

const HOLES = [
    { re: /\bundefined\b/, what: 'undefined' },
    { re: /\[object Object\]/, what: '[object Object]' },
    { re: /\bNaN\b/, what: 'NaN' },
];

let checks = 0, fails = 0;
const failures = [];
const ok = (cond, label) => { checks++; if (!cond) { fails++; failures.push(label); } };

/* Wait for the page to have finished running its scripts, rather than sleeping
   a fixed time and hoping.

   A fixed wait is a race that only shows up under load: run alone this gate
   passed, and run inside the full suite — with another jsdom server and a
   dozen Node processes competing — index.html had not finished executing when
   it was inspected, and the gate reported that os-meta.js exposed nothing. A
   gate that fails when the machine is busy is one people learn to re-run
   instead of believe. */
async function waitFor(window, predicate, what, ms = 15000) {
    const deadline = Date.now() + ms;
    for (;;) {
        try { if (predicate(window)) return true; } catch (_) { /* still loading */ }
        if (Date.now() > deadline) {
            fails++; checks++;
            failures.push(`timed out after ${ms}ms waiting for ${what}`);
            return false;
        }
        await new Promise(r => setTimeout(r, 100));
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-os-'));
const server = await serve(WEB);

// Read the real metadata once, before any page mutates its own copy.
const probe = await loadPage(JSDOM, VirtualConsole, server.origin, 'index.html', { wait: 300 });
await waitFor(probe.window, w => w.OS_META && Object.keys(w.OS_META).length,
              'os-meta.js to define OS_META');
const META = JSON.parse(JSON.stringify(probe.window.OS_META || {}));
probe.window.close();
ok(Object.keys(META).length > 0, 'os-meta.js exposed no OS_META — nothing could be measured');

const leakage = {};
const rows = [];

for (const id of Object.keys(META)) {
    const meta = META[id];
    const complete = meta.complete === true;

    const { window } = await loadPage(JSDOM, VirtualConsole, server.origin, 'index.html', { wait: 300 });
    if (!await waitFor(window, w => typeof w.generateOutput === 'function' &&
                                    typeof w.setTargetOS === 'function' && w.OS_META,
                       `${meta.label}: the generator's scripts to finish running`)) {
        window.close();
        continue;
    }

    /* The lock, against the real metadata: an unfinished system must not be
       selectable, and the refusal has to happen here rather than in whichever
       screen drew the chooser. Checked before anything is mutated. */
    const honest = window.setTargetOS(id);
    if (complete) {
        ok(honest === id, `${meta.label} is marked complete but setTargetOS refused it`);
    } else {
        ok(honest === 'arch',
           `${meta.label} is unfinished and setTargetOS accepted it — a reader can reach ` +
           `a guide that prints another system's commands`);
    }

    /* Now lift the badge and keep it lifted, because `chosenOS()` re-checks on
       every read and not only at the moment of choosing. What is generated below
       is therefore the guide as it would stand the day this badge comes off,
       which is exactly the question the completion plan asks. */
    const live = window.OS_META && window.OS_META[id];
    if (!complete && live) live.complete = true;
    const got = window.setTargetOS(id);
    ok(got === id, `setTargetOS('${id}') settled on '${got}' — the system could not be reached`);

    window.generateOutput(true);

    const md   = window.sessionStorage.getItem('live_md') || '';
    const sh   = window.sessionStorage.getItem('live_sh') || '';
    const post = window.sessionStorage.getItem('live_post_sh') || '';
    const all = [md, sh, post].join('\n');

    ok(md.length > 200, `${meta.label}: the generator produced no guide`);
    ok(sh.length > 200, `${meta.label}: the generator produced no script`);

    for (const h of HOLES) {
        ok(!h.re.test(all),
           `${meta.label}: ${h.what} reached the output — a question went unanswered ` +
           `and the emitter printed the hole`);
    }

    /* The work-in-progress banner is not asserted here, and that is worth
       saying plainly rather than leaving as an omission.

       script.js decides it from `complete === false`, read at the moment the
       guide is built. Reaching a badged system at all requires the badge to be
       lifted, and lifting it necessarily turns the banner off — so any
       assertion about it here would only be measuring what this harness just
       did to the page. What genuinely protects a reader today is the lock
       checked above: an unfinished system cannot be selected, so no reader
       reaches a guide that would need the banner. The banner is the second
       line of that defence, for the day a badge lifts before its guide is
       ready, and it is exercised where it can be — against the walkthrough's
       emitter in os-permutations, which takes its system as an argument. */

    /* The answers must survive both outputs, in the shape each format can
       actually hold. The script carried an HTML comment for a long time: valid
       in the markdown, a syntax error in shell, and it sat above every command
       so the downloaded .sh did not parse at all. Asserting the round trip and
       not merely the presence of a marker is what makes this catch a block that
       is well-formed and empty. */
    const inScript = sh.match(/^###\s*CONFIG_START\s+([^\n]*?)\s+###\s*CONFIG_END\s*$/m);
    const inGuide  = md.match(/<!--\s*CONFIG_START\s*([\s\S]*?)\s*CONFIG_END\s*-->/);
    ok(!!inScript, `${meta.label}: the script carries no restorable config block`);
    ok(!!inGuide,  `${meta.label}: the guide carries no restorable config block`);
    let a = null, b = null;
    try { a = JSON.parse(inScript[1]); } catch (_) { /* reported below */ }
    try { b = JSON.parse(inGuide[1]); } catch (_) { /* reported below */ }
    ok(a && a.answers, `${meta.label}: the script's config block is not parseable JSON`);
    ok(b && b.answers, `${meta.label}: the guide's config block is not parseable JSON`);
    if (a && b) {
        // `created` is a timestamp taken per output and is expected to differ.
        const strip = o => { const c = JSON.parse(JSON.stringify(o)); delete c.created; return c; };
        ok(JSON.stringify(strip(a)) === JSON.stringify(strip(b)),
           `${meta.label}: the guide and the script disagree about the answers they came from`);
    }
    // The shebang only works on line 1, so nothing may be emitted above it.
    ok(sh.split('\n')[0] === '#!/bin/bash',
       `${meta.label}: the script does not open with its shebang, so ./script will not run`);

    // Every generated script through bash -n. A guide whose script bash cannot
    // parse is worse than no script.
    const file = path.join(tmp, `${id}.sh`);
    fs.writeFileSync(file, sh.startsWith('#!') ? sh : '#!/usr/bin/env bash\n' + sh);
    try {
        execFileSync('bash', ['-n', file], { stdio: 'pipe' });
        checks++;
    } catch (e) {
        fails++; checks++;
        failures.push(`${meta.label}: bash -n rejected the generated script — ` +
                      String(e.stderr || e.message).split('\n')[0]);
    }

    const found = [];
    for (const t of OWNED) {
        if (t.owner === id) continue;
        const n = (all.match(t.re) || []).length;
        if (!n) continue;
        found.push(`${t.what}x${n}`);
        if (complete) {
            fails++; checks++;
            failures.push(`${meta.label} is marked complete and its guide prints ` +
                          `${t.what}, which belongs to ${t.owner}`);
        }
    }
    if (found.length) leakage[meta.label] = found;

    rows.push(`${meta.label.padEnd(18)} guide ${String(md.length).padStart(6)} chars, ` +
              `script ${String(sh.length).padStart(6)} chars, post ${String(post.length).padStart(6)}`);
    window.close();
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`generator-os: ${Object.keys(META).length} systems driven through index.html`);
console.log(`assertions:   ${checks}`);
rows.forEach(r => console.log('  ' + r));

if (Object.keys(leakage).length) {
    console.log('');
    console.log('STILL ARCH-SHAPED — the generator emits tooling that is not theirs.');
    console.log('None of these can be selected, which is why this is reported rather');
    console.log('than failed: no reader reaches one. It becomes a failure the moment a');
    console.log('badge lifts, and the number is the work needed before one can.');
    for (const [label, found] of Object.entries(leakage)) {
        console.log(`  ${label.padEnd(18)} ${found.join(', ')}`);
    }
}

console.log('');
if (fails) {
    failures.forEach(f => console.log('  x ' + f));
    console.log(`FAILED: ${fails} of ${checks}`);
} else {
    console.log('ALL PASS');
}
process.exit(fails ? 1 : 0);
