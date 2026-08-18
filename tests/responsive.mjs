/* Responsive audit: load every page in jsdom at a range of viewport widths and
 * assert the body never needs to scroll sideways.
 *
 * jsdom does not do layout, so this cannot measure real overflow. What it CAN
 * check reliably is the structural causes of it: fixed pixel widths wider than
 * a phone, tables and <pre> without a scroll container, images without
 * max-width, and viewport meta that blocks zoom. Those are what actually break
 * a page at 320px.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const WEB = process.argv[2] || 'website';
const PAGES = fs.readdirSync(WEB).filter(f => f.endsWith('.html'));

let problems = 0;
const report = [];

function flag(page, msg) { problems++; report.push(`${page}: ${msg}`); }

for (const page of PAGES) {
    const html = fs.readFileSync(path.join(WEB, page), 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // 1. Viewport meta must exist and must not block zoom.
    const vp = doc.querySelector('meta[name="viewport"]');
    if (!vp) flag(page, 'no viewport meta — mobile browsers will render it at desktop width');
    else {
        const c = vp.getAttribute('content') || '';
        if (!/width=device-width/.test(c)) flag(page, `viewport meta lacks width=device-width: "${c}"`);
        if (/user-scalable\s*=\s*no/.test(c)) flag(page, 'viewport blocks pinch zoom');
        if (/maximum-scale\s*=\s*1/.test(c)) flag(page, 'viewport caps zoom at 1x');
    }

    // 2. Inline fixed widths wider than the narrowest phone.
    for (const el of doc.querySelectorAll('[style]')) {
        const s = el.getAttribute('style');
        const m = /(?:^|[;\s])width\s*:\s*(\d+)px/.exec(s);
        if (m && Number(m[1]) > 320) {
            flag(page, `fixed width ${m[1]}px on <${el.tagName.toLowerCase()}> overflows a 320px screen`);
        }
        const mw = /min-width\s*:\s*(\d+)px/.exec(s);
        if (mw && Number(mw[1]) > 320) {
            flag(page, `min-width ${mw[1]}px on <${el.tagName.toLowerCase()}> cannot shrink below a phone`);
        }
    }

    // 3. Wide content must scroll inside its own box, not move the page.
    const css = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const sharedCss = fs.existsSync(path.join(WEB, 'style.css'))
        ? fs.readFileSync(path.join(WEB, 'style.css'), 'utf8') : '';
    const allCss = css + '\n' + sharedCss;

    if (doc.querySelector('pre') && !/pre[^{]*\{[^}]*overflow-x\s*:\s*auto/.test(allCss)
        && !/pre[^{]*\{[^}]*overflow\s*:\s*auto/.test(allCss)
        && !/white-space\s*:\s*pre-wrap/.test(allCss)) {
        flag(page, '<pre> present but no overflow-x:auto or pre-wrap rule — long lines will scroll the page');
    }
    if (doc.querySelector('table') && !/table[^{]*\{[^}]*(overflow-x\s*:\s*auto|display\s*:\s*block)/.test(allCss)) {
        flag(page, '<table> present but no horizontal scroll container');
    }

    // 4. Images must be able to shrink.
    if (doc.querySelector('img') && !/img\s*\{[^}]*max-width\s*:\s*100%/.test(allCss)
        && !/\.banner\s*\{[^}]*max-width/.test(allCss)) {
        flag(page, '<img> present but no max-width:100% rule');
    }

    // 5. Every page should reach the shared stylesheet.
    if (!doc.querySelector('link[href="style.css"]')) {
        flag(page, 'does not load style.css');
    }

    // 6. Touch targets: interactive elements need a stated minimum height
    //    somewhere. Checked at the stylesheet level rather than per element.
    if (!/--tap-target/.test(allCss)) {
        flag(page, 'no --tap-target sizing anywhere in the CSS it loads');
    }
}

/* 7. A flex row that becomes a column on a phone must stretch its items.
 *
 * `align-items: flex-start` means two different things in the two directions.
 * Down a row it stops a short sidebar growing to the height of the form beside
 * it, which is what it is there for. Down a column it sizes each item to its
 * own content instead of to the screen — so .generator-form came out 397px
 * wide inside a 363px column and carried the whole page sideways with it, on
 * every phone, for as long as the rule has existed.
 *
 * Structural rather than measured, because jsdom does no layout and this is
 * exactly the shape that produced a real 28px overflow. Read from the
 * stylesheet: any selector switched to a column inside a max-width query, whose
 * cross-axis alignment is still flex-start when it gets there, is the bug.
 */
const rawSheet = fs.existsSync(path.join(WEB, 'style.css'))
    ? fs.readFileSync(path.join(WEB, 'style.css'), 'utf8') : '';
/* Comments out first. An earlier version anchored each rule on the `}` or `,`
   before it, and a comment written above the rule was enough to hide it — a
   gate that stops seeing what it guards the moment somebody explains it. */
const sheet = rawSheet.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Every declaration block for `selector`, in source order, up to `limit`. */
function blocksFor(css, selector, limit) {
    const text = limit === undefined ? css : css.slice(0, limit);
    const re = new RegExp('\\' + selector + '\\s*\\{([^{}]*)\\}?', 'g');
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
    return out;
}

/** The last value `prop` takes for `selector` before `limit`, or null. */
function lastValueFor(css, selector, prop, limit) {
    let value = null;
    for (const body of blocksFor(css, selector, limit)) {
        const decl = new RegExp(prop + '\\s*:\\s*([^;}]+)').exec(body);
        if (decl) value = decl[1].trim();
    }
    return value;
}

const columnRule = /\.([a-zA-Z0-9_-]+)\s*\{[^{}]*flex-direction\s*:\s*column/g;
let cm;
while ((cm = columnRule.exec(sheet)) !== null) {
    const selector = '.' + cm[1];
    // Only rules that live inside a narrow-viewport query.
    const query = sheet.slice(0, cm.index).lastIndexOf('@media');
    if (query === -1 || !/max-width/.test(sheet.slice(query, query + 120))) continue;

    /* What align-items is by the time the column rule applies: whatever the
       stylesheet last said for this selector at or before this point. The
       column rule's own block is included, so setting both together passes. */
    const endOfRule = sheet.indexOf('}', cm.index);
    const align = lastValueFor(sheet, selector, 'align-items',
                               endOfRule === -1 ? undefined : endOfRule + 1);
    if (align === 'flex-start' || align === 'start') {
        problems++;
        report.push(`style.css: ${selector} becomes a column on a narrow screen while ` +
                    `align-items is still ${align}, so its items are sized to their ` +
                    `content instead of to the screen and the page scrolls sideways`);
    }
}

console.log(`pages checked: ${PAGES.length}`);
if (problems) {
    console.log(`\nISSUES (${problems}):`);
    [...new Set(report)].forEach(r => console.log('  - ' + r));
    process.exit(1);
}
console.log('\nNo structural responsive problems found.');
