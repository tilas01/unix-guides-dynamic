/* Every page, loaded over real HTTP, with every script actually running.
 *
 * This file used to load pages with
 *     JSDOM.fromFile(page, { url: 'http://localhost:8731/' + page })
 * and nothing listening on that port. jsdom resolves relative <script src>
 * against the `url` option, so it tried to fetch each one over HTTP and every
 * one failed. jsdom reported "Could not load script: ...", and the JSDOM_GAPS
 * filter discarded exactly that message as environmental noise — so a page with
 * no JavaScript running at all reported "NO RUNTIME ERRORS".
 *
 * The nav and tooltip counts in the output were the only evidence, and nothing
 * asserted they stayed sane, so they drifted towards zero unnoticed.
 *
 * Now: a real static server, a fetch shim pointed at it, load failures treated
 * as failures, and a floor under the counts so an empty page cannot pass.
 */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { serve, loadPage } from './serve.mjs';

const WEB = process.argv[2] || '../website';
const pages = fs.readdirSync(WEB).filter(f => f.endsWith('.html'));

/* upload.html is a redirect stub with no chrome of its own. Everything else
   must carry the canonical nav built by shared-ui.js. */
const NO_NAV = new Set(['upload.html']);

/* The number of destinations in shared-ui.js's NAV. Asserted rather than
   inferred, so removing one from the nav fails here instead of silently. */
const NAV_COUNT = 9;

/* Genuine jsdom gaps. Deliberately narrow: it must not be possible for a
   script that failed to load to be filtered out as "environmental". */
const JSDOM_GAPS = [
    /Not implemented: HTMLCanvasElement/i,
    /Not implemented: window\.(scrollTo|alert|confirm|prompt|open)/i,
    /Could not parse CSS/i,
    /Error: Could not load link/i,          // stylesheets: jsdom parses no CSS
    /Not implemented: navigation to another Document/i,   // upload.html is a redirect stub
    // serve.mjs refuses cross-origin fetches on purpose, so the suite does not
    // depend on the network or burn a shared GitHub rate limit. Pages that ask
    // for live release statistics report the failure through their own error
    // path, which is the branch worth exercising. Matched narrowly: any other
    // console.error still fails.
    /blocked cross-origin fetch to /,
];
const isGap = e => JSDOM_GAPS.some(rx => rx.test(e));

const server = await serve(WEB);
let failures = 0;
const rows = [];

for (const page of pages) {
    const { window, document: d, errors } = await loadPage(JSDOM, VirtualConsole, server.origin, page);

    const scripts = d.querySelectorAll('script[src]').length;
    const nav = d.querySelectorAll('.main-nav .nav-link, .nav-bar .nav-link').length;
    const tips = d.querySelectorAll('[data-title]').length;
    const manual = !!d.querySelector('a[href="manual.html"]');
    const viewport = !!d.querySelector('meta[name="viewport"]');

    // Did the scripts actually run? shared-ui.js is on every page and always
    // produces one of these, so their absence means nothing executed.
    const ran = typeof window.refreshTooltips === 'function' ||
                d.querySelector('#header-controls') !== null;

    const real = errors.filter(e => !isGap(e));
    const problems = [];

    if (real.length) problems.push(...real.map(e => 'error: ' + e.slice(0, 130)));
    if (scripts === 0) problems.push('page loads no scripts at all');
    if (!ran) problems.push('no script produced any effect — nothing executed');
    if (!NO_NAV.has(page) && nav < NAV_COUNT) {
        problems.push(`nav has ${nav} links, expected the ${NAV_COUNT} canonical destinations`);
    }
    // The history clock must exist on every page. It used to be built only when
    // window.toggleHistoryModal was defined — that lives in script.js, so nine
    // of eleven pages had no clock and no route to the session's history.
    if (!d.getElementById('history-btn')) {
        problems.push('no #history-btn — the session history is unreachable from this page');
    }
    if (!d.getElementById('repo-link-btn')) {
        problems.push('no #repo-link-btn in the control cluster');
    }
    if (!d.getElementById('toggle-tooltips-btn')) {
        problems.push('no #toggle-tooltips-btn in the control cluster');
    }
    if (typeof window.openSharedHistory !== 'function') {
        problems.push('shared-ui.js exposes no openSharedHistory(), so the clock opens nothing');
    }

    /* A page must actually load the file that defines the globals it calls.
       index.html and live.html both called window.renderMarkdown and neither
       loaded markdown.js — the Live Editor's preview button switched panes and
       rendered nothing, and the generator's live preview was blank. It survived
       because the calls are guarded (`if (typeof window.renderMarkdown ===
       'function')`), so the failure was silent by design.

       Checking the global rather than the <script> tag is deliberate: a tag that
       is present but 404s, or a file with a SyntaxError, both leave the global
       undefined and both should fail here. */
    for (const [fn, provider] of [
        ['renderMarkdown', 'markdown.js'],
        ['renderMarkdownInto', 'markdown.js'],
        ['highlightAll', 'highlight.js'],
        ['setHighlightedCode', 'highlight.js'],
    ]) {
        if (typeof window[fn] !== 'function') {
            problems.push(`window.${fn} is undefined — ${provider} is not loaded or did not run`);
        }
    }

    if (!viewport) problems.push('no viewport meta, so mobile rendering is wrong');
    if (!manual) problems.push('no link to manual.html (required in every header)');

    // The footer is three separate blocks — waiver, licence, project credits —
    // built by shared-ui.js. They were one red .legal-notice box copied into ten
    // files, with the project's own name and navigation tacked onto the end of
    // the disclaimer. An empty <footer class="site-footer"></footer> means the
    // builder did not run, which is invisible on the page itself.
    const fBlocks = d.querySelectorAll('.site-footer .footer-block').length;
    const fLinks = d.querySelectorAll('.site-footer .footer-links a').length;
    if (d.querySelector('.site-footer')) {
        if (fBlocks !== 3) {
            problems.push(`footer has ${fBlocks} blocks, expected 3 (waiver, licence, project)`);
        }
        if (fLinks !== NAV_COUNT) {
            problems.push(`footer links to ${fLinks} pages, expected the ${NAV_COUNT} in NAV`);
        }
        for (const cls of ['footer-waiver', 'footer-licence', 'footer-project']) {
            if (!d.querySelector('.site-footer .' + cls)) {
                problems.push(`footer is missing its .${cls} block`);
            }
        }
        if (!d.querySelector('.site-footer a[href$="LEGAL-WAIVER.txt"]')) {
            problems.push('footer does not link to the full waiver text');
        }
        if (!d.querySelector('.site-footer a[href$="LICENSE.txt"]')) {
            problems.push('footer does not link to the licence text');
        }
        if (d.querySelector('.site-footer .legal-notice')) {
            problems.push('the old single-box .legal-notice footer is back');
        }
    }

    failures += problems.length;
    rows.push({ page, scripts, nav, tips, ran, problems });
    window.close();
}

/* Nothing on any page may reference a file that is not there. The server
   recorded every 404 it served while the pages were loading. */
const missing = [...new Set(server.missing)]
    // Requested by the browser itself whether or not the page mentions it.
    .filter(m => !/^\/favicon\.ico$/.test(m));
await server.close();

for (const r of rows) {
    console.log(`${r.page.padEnd(22)} scripts=${String(r.scripts).padStart(2)} ` +
                `nav=${String(r.nav).padStart(2)} tooltips=${String(r.tips).padStart(3)} ` +
                `ran=${r.ran ? 'Y' : 'n'} ${r.problems.length ? 'x' : 'ok'}`);
    r.problems.forEach(p => console.log('      x ' + p));
}

if (missing.length) {
    console.log(`\n${missing.length} referenced files returned 404:`);
    missing.slice(0, 20).forEach(m => console.log('      x ' + m));
    failures += missing.length;
}

console.log(failures === 0
    ? `\nALL ${pages.length} PAGES RUN CLEAN`
    : `\n${failures} problems across ${pages.length} pages`);
process.exit(failures ? 1 : 0);
