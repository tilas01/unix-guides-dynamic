/* Dusky must be installable end to end, in both front ends.
 *
 * Guards the bug this was written for: choosing Dusky in the Unix Install Walkthrough
 * dead-ended at "Display server". renderStep() disabled EVERY option card on a
 * locked step —
 *
 *     optionCard(step, o, locked !== null && locked !== o.value ? true
 *                                          : (locked !== null))
 *
 * both branches evaluate to true — and a choice step advances only by clicking
 * an option card. So there was nothing enabled on the page except "← Back", and
 * the walkthrough could not be finished at all.
 *
 * The existing permutation harness never saw it: it drives the data model
 * directly and fills locked answers itself, so it proves the *output* is right
 * while saying nothing about whether a person can reach that output. This test
 * drives the real page in jsdom instead, clicking what a user would click.
 *
 * It also pins the three facts the generator kept getting wrong: Dusky is
 * Hyprland, Hyprland is Wayland-only, and dwm is the Xorg case.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { serve, loadPage } from './serve.mjs';

const WEB = process.argv[2] || '../website';
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');

let checks = 0;
const failures = [];
function ok(cond, label) {
  checks++;
  if (!cond) failures.push(label);
}

/* ── 1. Every lock must name a real step and a real option ──────────────────
   A key that matches no step id locks nothing and is silently dead — which is
   what `desktop_extra: 'hyprland'` was. A value that matches no option leaves
   the question with an answer that cannot be rendered or carried forward. */
const { STEPS, DUSKY_LOCKS, OS_LOCKS, OS_META } = new Function('window', 'module',
  read('os-meta.js') + '\n' + read('os-install.js') + '\n' + read('manual-data.js') +
  '\nreturn { STEPS, DUSKY_LOCKS, OS_LOCKS, OS_META };')({}, undefined);

const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));

for (const [id, value] of Object.entries(DUSKY_LOCKS)) {
  const step = byId[id];
  ok(!!step, `DUSKY_LOCKS.${id} is not the id of any step — it locks nothing`);
  if (!step) continue;
  const values = (step.options || []).map(o => o.value);
  ok(values.includes(value),
    `DUSKY_LOCKS.${id} = '${value}' is not one of ${step.id}'s options (${values.join(', ')})`);
  ok(step.type !== 'text',
    `DUSKY_LOCKS.${id} locks a free-text question, which has no option to pin`);
}

/* The same check for the locks a target system imposes. Same failure mode: a
   key naming no step locks nothing, and a value matching no option leaves the
   question holding an answer that cannot be rendered.

   Treated as a failure rather than a skip if the table cannot be reached at
   all — an empty OS_LOCKS is a legitimate state, but an undefined one means the
   export was renamed and this block silently stopped testing anything. */
ok(OS_LOCKS && typeof OS_LOCKS === 'object',
  'OS_LOCKS is not exported from manual-data.js, so the per-system locks went unchecked');

for (const [os, locks] of Object.entries(OS_LOCKS || {})) {
  ok(!!OS_META[os], `OS_LOCKS.${os} is not a system in OS_META — it locks nothing`);
  for (const [id, value] of Object.entries(locks)) {
    const step = byId[id];
    ok(!!step, `OS_LOCKS.${os}.${id} is not the id of any step — it locks nothing`);
    if (!step) continue;
    const values = (step.options || []).map(o => o.value);
    ok(values.includes(value),
      `OS_LOCKS.${os}.${id} = '${value}' is not one of ${id}'s options (${values.join(', ')})`);
    ok(step.type !== 'text',
      `OS_LOCKS.${os}.${id} locks a free-text question, which has no option to pin`);
    // Locking the question that chooses the system would make the choice
    // unreachable the moment it was made.
    ok(id !== 'os', `OS_LOCKS.${os} locks the system question itself`);
  }
}

const duskyOpt = (byId.desktop.options || []).find(o => o.value === 'dusky');
ok(!!duskyOpt, 'the desktop question no longer offers Dusky');
ok(duskyOpt && duskyOpt.locks === DUSKY_LOCKS,
  'the Dusky option no longer carries DUSKY_LOCKS, so nothing tells the user what it fixes');

/* ── 2. The walkthrough must be completable with Dusky selected ─────────────
   Click through the real page. Every question must offer at least one enabled
   control that moves forward; the run fails loudly if any does not. */
// Served over real HTTP. The previous `fromFile` plus a fake http `url` made
// jsdom resolve every relative <script src> against that URL and try to fetch it
// from a port with nothing listening — so this suite was clicking around a page
// with no JavaScript running on it, and its 79 passing checks meant nothing.
const server = await serve(WEB);
const loaded = await loadPage(JSDOM, VirtualConsole, server.origin, 'manual.html');
const { window, document: doc } = loaded;
const pageErrors = loaded.errors.filter(e =>
  !/Could not load link|Could not parse CSS|Not implemented/i.test(e));

// The welcome/disclaimer overlay sits on top of every page. Mark the session
// accepted so it does not intercept the clicks below.
try { window.sessionStorage.setItem('legal_accepted_session', 'true'); } catch (_) { /* ignore */ }
doc.querySelectorAll('div[style*="z-index: 10000"], div[style*="z-index:10000"]')
   .forEach(el => el.remove());

function currentStepId() {
  const card = doc.querySelector('.q-card:not(.q-done)');
  return card ? card.id.replace(/^q-/, '') : null;
}

/** Everything on the current question a user could actually click to progress. */
function liveControls() {
  const card = doc.querySelector('.q-card:not(.q-done)');
  if (!card) return [];
  return [...card.querySelectorAll('.opt-card:not([disabled]), .q-next:not([disabled])')];
}

const seen = [];
let guard = 0;
let stuckOn = null;

while (doc.querySelector('.q-card:not(.q-done)') && guard++ < 120) {
  const id = currentStepId();
  // A question that renders twice in a row did not accept the answer, which
  // looks identical to a dead end from the outside. Name it rather than
  // spinning to the guard and reporting only that something repeated.
  if (seen[seen.length - 1] === id) { stuckOn = id; break; }
  seen.push(id);

  const step = byId[id];
  const controls = liveControls();
  ok(controls.length > 0,
    `"${id}" offers nothing clickable — the walkthrough dead-ends here` +
    (Object.hasOwn(DUSKY_LOCKS, id) ? ' (this is a Dusky-locked question)' : ''));
  if (!controls.length) break;

  if (step && step.type === 'text') {
    // Answer with the question's own placeholder. That keeps this test from
    // carrying a second copy of every validator, and it doubles as a check
    // that the example shown to users is one the field actually accepts — a
    // placeholder its own validator rejects is a bug in the question.
    const example = step.placeholder || '';
    ok(!step.validate || step.validate(example, {}) === null,
      `"${id}" shows the placeholder "${example}", which its own validator rejects`);
    doc.getElementById('input-' + id).value = example;
    controls.find(c => c.classList.contains('q-next')).click();
  } else if (id === 'desktop') {
    const card = [...doc.querySelectorAll('.opt-card')]
      .find(c => /Dusky/i.test(c.textContent));
    ok(!!card, 'the desktop question does not render a Dusky card');
    if (!card) break;
    ok(!card.disabled, 'the Dusky card is disabled — Dusky cannot be chosen at all');
    card.click();
  } else if (!controls.some(c => c.classList.contains('opt-card'))) {
    // No option is selectable: this is a locked question, and its Continue is
    // the only way on. Before this fix there was no such button, which is the
    // dead end the whole test exists to catch.
    ok(Object.hasOwn(DUSKY_LOCKS, id),
      `"${id}" has no selectable option but is not a Dusky-locked question`);
    controls[0].click();
  } else if (step && step.type === 'multi') {
    // Multi-select stays on the question while you toggle, so it needs a pick
    // and then an explicit Continue. Re-read the DOM after the toggle — the
    // question re-renders, so the button found a moment ago is detached.
    controls.find(c => c.classList.contains('opt-card')).click();
    const next = liveControls().find(c => c.classList.contains('q-next'));
    ok(!!next, `multi-select "${id}" has no Continue button`);
    if (!next) break;
    next.click();
  } else {
    controls.find(c => c.classList.contains('opt-card')).click();
  }
  await new Promise(r => setTimeout(r, 0));
}

ok(stuckOn === null, `"${stuckOn}" rejected its answer and re-rendered — the walkthrough cannot get past it`);
ok(guard < 120, 'the walkthrough never terminated');
ok(!!doc.querySelector('.q-done'), 'the walkthrough did not reach the "that is everything" screen');
ok(seen.includes('display_server'),
  'the display server question was never shown, so its lock was never exercised');

// Each locked question must have been shown AND passed through.
for (const id of Object.keys(DUSKY_LOCKS)) {
  ok(seen.includes(id), `Dusky-locked question "${id}" was never reached`);
}

// And the answers Dusky fixes must have survived into the finished config.
const saved = (() => {
  try { return JSON.parse(window.sessionStorage.getItem('arch_manual_state') || '{}'); }
  catch (_) { return {}; }
})();
const answers = saved.state || {};
ok(Object.keys(answers).length > 0, 'the walkthrough saved no state at all');
ok(answers.desktop === 'dusky', `finished config has desktop='${answers.desktop}', not 'dusky'`);
for (const [id, value] of Object.entries(DUSKY_LOCKS)) {
  if (answers && Object.hasOwn(answers, id)) {
    ok(answers[id] === value,
      `finished config has ${id}='${answers[id]}', but Dusky fixes it to '${value}'`);
  }
}

/* ── A finished walkthrough must save itself to the session history ─────────
   Answering thirty-one questions and losing the result to a closed tab is the
   worst outcome this page has. The generator always wrote to the history; the
   walkthrough never did, so its output existed only if you remembered to press
   a download button. */
const hist = (() => {
  try { return JSON.parse(window.sessionStorage.getItem('arch_gen_history') || '[]'); }
  catch (_) { return []; }
})();

ok(Array.isArray(hist) && hist.length >= 1,
   'finishing the walkthrough saved nothing to the generation history');

if (hist.length) {
  const top = hist[0];
  ok(top.source === 'manual-walkthrough',
     `history entry is labelled "${top.source}", not manual-walkthrough`);
  ok(typeof top.md === 'string' && top.md.includes('# Arch Linux'),
     'the saved entry carries no markdown guide');
  ok(typeof top.sh === 'string' && top.sh.length > 200,
     'the saved entry carries no install script');
  ok(!!top.timestamp, 'the saved entry has no timestamp, so history cannot order it');
  // The JSON config must be the documented envelope, not a bare answers dump —
  // the generator reads the same shape.
  let cfg = null;
  try { cfg = JSON.parse(top.sc); } catch (_) { /* stays null */ }
  ok(cfg && cfg.schema === 'unix-sit/config',
     'the saved entry has no valid config envelope');
  ok(cfg && cfg.answers && cfg.answers.desktop === 'dusky',
     'the saved config does not carry the answers that were given');
}

/* Re-rendering the done screen must not stack duplicates. It re-renders on every
   mode toggle and every tooltip refresh, so an unguarded save would fill the
   history with copies of one guide and push real entries out of the ten-entry
   limit. */
const before = hist.length;
window.document.getElementById('mode-commands')?.click();
window.document.getElementById('mode-guide')?.click();
await new Promise(r => setTimeout(r, 30));
const after = (() => {
  try { return JSON.parse(window.sessionStorage.getItem('arch_gen_history') || '[]').length; }
  catch (_) { return -1; }
})();
ok(after === before,
   `re-rendering the done screen added ${after - before} duplicate history entries`);

ok(pageErrors.length === 0, `manual.html threw during the Dusky run: ${pageErrors[0] || ''}`);
window.close();
await server.close();

/* ── 3. The generator must agree that Dusky is Wayland ──────────────────────
   Three places in script.js disagreed with each other: "auto" resolved Dusky to
   Xorg, the validator forced it to Wayland behind an alert(), and a warning
   then said Wayland would break it. Assert on the source, because these are
   plain conditionals with no seam to call into. */
const gen = read('script.js');

ok(!/displayServer === "auto" && \(desktop === "dusky"/.test(gen),
  'script.js resolves Dusky to Xorg on "Auto" — Hyprland has no Xorg backend');
ok(!/\$\{desktop\} requires X11\/Xorg/.test(gen),
  'script.js still warns that Dusky requires Xorg, contradicting the lock that pins it to Wayland');
ok(!/alert\(["'`]Invalid Config/.test(gen),
  'script.js corrects an impossible desktop/display-server pair behind alert(); pin the control instead');
ok(/DS_REQUIRED\s*=\s*\{[^}]*dusky:\s*'wayland'/.test(gen),
  'script.js no longer pins Dusky to Wayland');
ok(/DS_REQUIRED\s*=\s*\{[^}]*dwm:\s*'xorg'/.test(gen),
  'script.js no longer pins dwm to Xorg');

const idx = read('index.html');
ok(/id="ds-forced-note"/.test(idx),
  'index.html has no #ds-forced-note, so a pinned display server is never explained');

/* ── Report ─────────────────────────────────────────────────────────────── */
console.log(`dusky-locks: ${checks} checks, ${failures.length} failed`);
console.log(`  walkthrough reached ${seen.length} questions with Dusky selected`);
console.log(`  locks exercised: ${Object.keys(DUSKY_LOCKS).join(', ')}`);
failures.forEach(f => console.log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
