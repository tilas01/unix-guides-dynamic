/* The shared markdown renderer, and the promise that no link lands on raw .md.
 *
 * Two things are being guarded.
 *
 * 1. Injection. Every document this renders is fetched at runtime from docs/,
 *    and those documents are full of shell, angle brackets and HTML-looking
 *    text. Correctness here is asserted by parsing the output and asking the DOM
 *    what elements and attributes actually exist — not by grepping the string
 *    for "onerror", which passes happily on escaped text and fails happily on
 *    harmless prose.
 *
 * 2. Raw markdown as a destination. wiki.html's ?page= handler used to do
 *    `location.replace('docs/' + page)`, so 26 right-click targets and every
 *    docs link on the index dropped the reader onto an unstyled .md file. The
 *    renderer exists so that cannot happen; this asserts nothing reintroduces
 *    a link straight to one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const WEB = process.argv[2] || '../website';
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');

let checks = 0;
const failures = [];
const ok = (cond, label) => { checks++; if (!cond) failures.push(label); };

/* ── Load the renderer the way a page does ─────────────────────────────────── */
const sandbox = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
sandbox.window.eval(read('markdown.js'));
const render = sandbox.window.renderMarkdown;
ok(typeof render === 'function', 'markdown.js does not expose window.renderMarkdown');
ok(typeof sandbox.window.renderMarkdownInto === 'function',
   'markdown.js does not expose window.renderMarkdownInto');

/** Parse rendered HTML and report what the browser would actually build. */
function inspect(html) {
    const d = new JSDOM('<div id="h"></div>');
    d.window.document.getElementById('h').innerHTML = html;
    const els = [...d.window.document.querySelectorAll('#h *')];
    return {
        tags: els.map(e => e.tagName),
        eventAttrs: els.flatMap(e => [...e.attributes].filter(a => /^on/i.test(a.name)).map(a => a.name)),
        hrefs: els.filter(e => e.tagName === 'A').map(e => e.getAttribute('href') || ''),
        srcs: els.filter(e => e.tagName === 'IMG').map(e => e.getAttribute('src') || ''),
        doc: d.window.document.getElementById('h'),
    };
}

/* ── No markdown syntax may survive into the rendered text ──────────────────
   A `**bold**` that renders as literal asterisks means the reader is looking at
   source, not a page. Checked against the *visible text* with code blocks
   removed, because a fenced block legitimately contains every one of these
   characters and inline code is meant to show them verbatim. */
const RESIDUE = [
    [/\*\*[^*\n]+\*\*/,          'unrendered **bold**'],
    [/(?:^|\s)__[^_\n]+__/,      'unrendered __bold__'],
    [/\[[^\]\n]+\]\([^)\n]+\)/,  'unrendered [link](url)'],
    [/^#{1,6}\s+\S/m,            'unrendered # heading'],
    [/\[!(?:NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i, 'unrendered [!ALERT] marker'],
    [/^\s*\|[^\n]*\|\s*$/m,      'unrendered | table | row |'],
    [/^\s*```/m,                 'unrendered ``` fence'],
];

function visibleText(html) {
    const d = new JSDOM('<div id="h"></div>');
    const host = d.window.document.getElementById('h');
    host.innerHTML = html;
    // Code is exempt: it is supposed to show these characters literally.
    host.querySelectorAll('pre, code').forEach(el => el.remove());
    return host.textContent;
}

let residueChecked = 0;
function assertNoResidue(html, label) {
    const text = visibleText(html);
    residueChecked++;
    for (const [rx, what] of RESIDUE) {
        const m = rx.exec(text);
        ok(!m, `${label}: ${what} left in the rendered text — "${m ? m[0].slice(0, 60) : ''}"`);
    }
}

/* ── 1. Injection ──────────────────────────────────────────────────────────── */
const HOSTILE = [
    'Raw danger: <script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload=alert(1)></svg>',
    'a < b && c > d',
    '[click me](javascript:alert(1))',
    '[click me](JaVaScRiPt:alert(1))',
    '![pic](javascript:alert(2))',
    '[ok](data:text/html;base64,PHNjcmlwdD4=)',
    '`<script>alert(1)</script>`',
    '| <script>x</script> | b |\n|---|---|\n| c | d |',
];

for (const src of HOSTILE) {
    const { tags, eventAttrs, hrefs, srcs } = inspect(render(src).html);
    const label = JSON.stringify(src.slice(0, 40));
    ok(!tags.includes('SCRIPT'), `${label} produced a <script> element`);
    ok(!tags.includes('IFRAME'), `${label} produced an <iframe> element`);
    ok(eventAttrs.length === 0, `${label} produced event attributes: ${eventAttrs.join(',')}`);
    ok(!hrefs.some(h => /^\s*(javascript|data|vbscript):/i.test(h)),
       `${label} produced a live scripting URL: ${hrefs.join(' ')}`);
    ok(!srcs.some(s => /^\s*(javascript|data|vbscript):/i.test(s)),
       `${label} produced a scripting img src: ${srcs.join(' ')}`);
}

/* Fenced code is verbatim: nothing inside it may be reinterpreted. */
const fenced = render('```bash\n**not bold** and <b>not bold</b> and `x`\n```').html;
const fi = inspect(fenced);
ok(!fi.tags.includes('STRONG'), 'markdown inside a fenced block was interpreted as markdown');
ok(!fi.tags.includes('B'), 'HTML inside a fenced block became a real element');
ok(/language-bash/.test(fenced), 'a fenced block carries no language- class for the highlighter');

/* ── 2. The features the docs actually use ─────────────────────────────────── */
const rich = render([
    '# Title', '', 'Text with **bold** and `code`.', '',
    '> [!WARNING]', '> Destroys data.', '',
    '> [!TIP]', '> Read first.', '',
    '> [!NOTE]', '> Worth knowing.', '',
    '> [!IMPORTANT]', '> Do not skip.', '',
    '> [!CAUTION]', '> Careful.', '',
    '| A | B |', '|---|---|', '| 1 | 2 |', '',
    '- one', '- two', '',
    '1. first', '2. second', '',
    '---', '',
    '<kbd>Super</kbd> + <kbd>Q</kbd>', '',
    '[Arch Wiki](https://wiki.archlinux.org/)',
].join('\n'));

ok(/<h1 id="title">/.test(rich.html), 'headings get no id, so nothing can deep-link into a rendered doc');
ok(rich.headings.length === 1 && rich.headings[0].id === 'title',
   'the heading list is not returned, so a rendered doc cannot build its own contents');
ok(!/\[!/.test(rich.html),
   'GitHub alert syntax is still being rendered literally as "[!TIP]" text');
for (const cls of ['md-warning', 'md-tip', 'md-note', 'md-important', 'md-caution']) {
    ok(rich.html.includes(cls), `alert type ${cls} is not rendered as a callout`);
}
ok(/<table class="md-table">/.test(rich.html) && /<th>A<\/th>/.test(rich.html),
   'tables do not render, or the first row is not treated as a header');
ok(/<ul>\s*<li>one<\/li>/.test(rich.html), 'unordered lists do not render');
ok(/<ol>\s*<li>first<\/li>/.test(rich.html), 'ordered lists do not render as <ol>');
ok(/<hr>/.test(rich.html), 'horizontal rules do not render');
ok(/<kbd>Super<\/kbd>/.test(rich.html), '<kbd> is escaped instead of rendered');
ok(/rel="noopener"/.test(rich.html), 'external links carry no rel="noopener"');

/* ── Soft wraps must be joined ──────────────────────────────────────────────
   Every document in docs/ is hard-wrapped at about 80 columns, so one sentence
   is three or four source lines. Rendering each line as its own block turned a
   paragraph into three <p>s and cut list items in half: the first line became
   the <li> and the remainder became loose paragraphs outside the list,
   unindented and visually detached from the bullet they belonged to. */
const wrapped = render([
    '### Warnings', '',
    '- **Dusky + Xorg = broken.** Dusky is Hyprland, and Hyprland is a Wayland',
    '  compositor with no Xorg backend. An earlier version said the opposite.', '',
    'A paragraph hard wrapped at eighty columns the way every document in the',
    'docs directory is, spanning several source lines, which must still render',
    'as a single paragraph.', '',
    '> [!WARNING]',
    '> This spans two source lines and must stay inside the one callout',
    '> rather than spilling out below it.', '',
    '| A | B |', '|---|---|', '| 1 | 2 |', '',
    '```bash', '# a comment', 'echo one', '', 'echo after a blank line', '```', '',
].join('\n'));

{
    const d = new JSDOM('<div id="h"></div>');
    d.window.document.getElementById('h').innerHTML = wrapped.html;
    const q = d.window.document;
    const code = q.querySelector('#h pre.md-code code');

    ok(q.querySelectorAll('#h li').length === 1,
       `a wrapped list item split into ${q.querySelectorAll('#h li').length} items`);
    ok(q.querySelectorAll('#h > p').length === 1,
       `a wrapped paragraph split into ${q.querySelectorAll('#h > p').length} top-level paragraphs`);
    ok(q.querySelectorAll('#h .md-alert').length === 1, 'the wrapped alert did not stay one callout');
    ok(q.querySelectorAll('#h .md-alert p').length === 1,
       `the alert's two source lines became ${q.querySelectorAll('#h .md-alert p').length} paragraphs`);
    ok(/⚠️ Warning/.test(wrapped.html),
       'joining the alert body swallowed its [!WARNING] label');
    ok(q.querySelectorAll('#h tr').length === 2,
       `table rows were joined together (${q.querySelectorAll('#h tr').length} rows, expected 2)`);
    ok(code && /# a comment\necho one\n\necho after a blank line/.test(code.textContent),
       'joining altered the inside of a fenced block — code must stay verbatim');
}

assertNoResidue(rich.html, 'the feature sample');
assertNoResidue(wrapped.html, 'the wrapped sample');

/* Real documents, not just synthetic ones: every doc the site links to must
   render without throwing and produce something. A doc that renders to nothing
   is a blank page where an explanation should be. */
const docsDir = path.join(WEB, 'docs');
let rendered = 0;
function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.md')) continue;
        const text = fs.readFileSync(p, 'utf8');
        if (text.trim().length < 20) continue;
        let res;
        try { res = render(text); } catch (err) {
            failures.push(`${e.name} threw while rendering: ${err.message}`); checks++; continue;
        }
        rendered++;
        const rel = path.relative(WEB, p).replace(/\\/g, '/');
        ok(res.html.trim().length > 0, `${rel} renders to nothing`);
        const ins = inspect(res.html);
        ok(!ins.tags.includes('SCRIPT'), `${rel} produced a <script> element`);
        ok(ins.eventAttrs.length === 0, `${rel} produced event attributes`);
        // Every real document too, not just the synthetic samples.
        assertNoResidue(res.html, rel);
    }
}
if (fs.existsSync(docsDir)) walk(docsDir);

/* ── 3. Nothing may link straight to raw markdown ──────────────────────────── */
// A path straight to a .md file. `wiki.html?page=x.md` also ends in .md but is
// the rendered route, so only flag hrefs with no query string.
const RAW_MD = /href="((?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.md(?:#[^"?]*)?)"/g;
for (const f of fs.readdirSync(WEB).filter(x => x.endsWith('.html'))) {
    const src = read(f);
    for (const m of src.matchAll(RAW_MD)) {
        checks++;
        failures.push(`${f} links straight to raw markdown: ${m[1]} — route it through ` +
                      `wiki.html?page= or cheatsheets.html?sheet=`);
    }
}

/* And the handler that serves ?page= must render, not redirect. */
// Strip comments first: this file and markdown.js both *describe* the old
// redirect in prose, and matching that text made the check fail on its own
// documentation.
const wiki = read('wiki.html');
const wikiCode = wiki.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(!/location\.replace\(\s*['"]docs\/['"]\s*\+/.test(wikiCode),
   'wiki.html?page= redirects to the raw .md file again instead of rendering it');
ok(/renderMarkdownInto|renderMarkdown/.test(wiki),
   'wiki.html never calls the markdown renderer, so ?page= cannot render anything');

/* Every ?page= target named anywhere on the site must exist. */
// Comments are stripped first: a note explaining that a stale target was
// removed must not read as that target still being linked.
const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

// .txt as well as .md: the three plain-text agreements are served through the
// same handler so they render inside the site rather than as a bare file.
const PAGE_RE = /[?&]page=([\w./-]+\.(?:md|txt))/g;
const seenPages = new Set();
for (const f of fs.readdirSync(WEB).filter(x => /\.(html|js)$/.test(x))) {
    for (const m of stripComments(read(f)).matchAll(PAGE_RE)) seenPages.add(m[1]);
}
for (const doc of seenPages) {
    // Agreements resolve from the site root; everything else from docs/.
    const rel = doc.startsWith('user-agreements/') ? doc : path.join('docs', doc);
    ok(fs.existsSync(path.join(WEB, rel)),
       `?page=${doc} is linked but website/${rel.split(path.sep).join('/')} does not exist`);
}

/* Every ?sheet= target must be a real tab in cheatsheets.js. */
const sheetIds = new Set([...read('cheatsheets.js').matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map(m => m[1]));
const SHEET_RE = /[?&]sheet=([\w-]+)/g;
for (const f of fs.readdirSync(WEB).filter(x => /\.(html|js)$/.test(x))) {
    for (const m of stripComments(read(f)).matchAll(SHEET_RE)) {
        ok(sheetIds.has(m[1]),
           `${f} links to ?sheet=${m[1]}, which is not a tab in cheatsheets.js ` +
           `(have: ${[...sheetIds].join(', ')})`);
    }
}

/* ── 4. The search index is a set of destinations too ───────────────────────
   Checks 3 reads .html files, and the index is JSON, so it was outside every
   guard here while holding more links than the whole site: hundreds of results
   pointed straight at .md files, and their fragments named anchors built by a
   different slug rule than the renderer's, so they resolved nowhere at either
   end. Generated by scripts/gen-search-index.py — if this fails, fix the
   generator and re-run it rather than editing the JSON. */
const indexPath = path.join(WEB, 'search-index.json');
if (fs.existsSync(indexPath)) {
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    ok(Array.isArray(entries) && entries.length > 0, 'search-index.json holds no entries');

    // Heading ids per document, from the renderer itself rather than from a
    // second copy of its slug rule.
    const idsFor = new Map();
    const idsOf = page => {
        if (idsFor.has(page)) return idsFor.get(page);
        const file = path.join(WEB, 'docs', page);
        let set = null;
        if (fs.existsSync(file)) {
            const res = render(fs.readFileSync(file, 'utf8'), { headingPrefix: 'doc-' });
            set = new Set((res.headings || []).map(h => h.id));
        }
        idsFor.set(page, set);
        return set;
    };

    for (const e of entries) {
        const u = String(e.u || '');
        ok(!/\.md(#|$)/.test(u.split('?')[0]),
           `search result "${e.t}" links straight to raw markdown: ${u}`);

        const m = /^wiki\.html\?page=([^#]+)(?:#(.+))?$/.exec(u);
        if (!m) continue;
        const [, page, frag] = m;
        // Agreements are served from the site root and are plain text, so they
        // have no rendered headings to check against.
        if (page.startsWith('user-agreements/')) continue;
        ok(fs.existsSync(path.join(WEB, 'docs', page)),
           `search result "${e.t}" points at ?page=${page}, which does not exist`);
        if (!frag) continue;
        const ids = idsOf(page);
        ok(ids !== null && ids.has(frag),
           `search result "${e.t}" points at #${frag} in ${page}, ` +
           `which the renderer never mints`);
    }
}

console.log(`markdown-render: ${checks} checks, ${failures.length} failed`);
console.log(`  ${rendered} real documents rendered, ${seenPages.size} ?page= targets, ` +
            `${sheetIds.size} cheatsheet tabs`);
failures.forEach(f => console.log('  x ' + f));
process.exit(failures.length ? 1 : 0);
