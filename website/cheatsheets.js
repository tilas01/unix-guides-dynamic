/* ============================================================================
   cheatsheets.js — every cheatsheet, as tabs.
   ----------------------------------------------------------------------------
   The cheatsheets already exist as markdown in docs/. Rather than duplicating
   them into HTML (which guarantees the two copies drift), this fetches the
   markdown and renders it, so docs/ stays the single source and the repo-only
   route reads exactly what the site shows.

   Rendering is markdown.js, shared with wiki.html?page= and the Live Editor
   preview, so all three agree and a fix lands once. It escapes before inserting
   any markup: the fetched files are our own, but treating them as untrusted
   costs nothing and means a docs edit cannot introduce script.
   ========================================================================= */

'use strict';

(function () {

    /* Tab order: the per-system sheets first, then the long combined
       reference, then the desktop-specific ones.

       `os` marks a sheet as belonging to one system. Those are all shown — a
       reader comparing two systems is a reader this page should help — but the
       one matching the current selection opens first and is marked as such, so
       the page answers the question actually being asked without hiding the
       others. A sheet with no `os` is shared and applies everywhere. */
    /* Which file belongs to which system comes from os-meta.js, so adding a
       system's cheatsheet there puts a tab here without touching this file —
       and so this page and the generated install cannot disagree about which
       sheet a Gentoo reader gets. The label and blurb stay here because they
       are about this page rather than about the system. */
    var OS_SHEET_TEXT = {
        arch:   { label: '📦 Arch commands',
                  desc: 'pacman, the AUR, systemd, Btrfs snapshots and the security suite.' },
        gentoo: { label: '🐧 Gentoo commands',
                  desc: 'Portage, USE flags, profiles, the three kernel routes, dracut, and OpenRC beside systemd.' }
    };

    function osSheets() {
        var meta = (typeof window !== 'undefined' && window.OS_META) || {};
        var out = [];
        Object.keys(meta).forEach(function (id) {
            if (!meta[id].cheatsheet) return;      // no sheet written yet
            var text = OS_SHEET_TEXT[id] || {};
            out.push({
                id: id,
                os: id,
                label: text.label || meta[id].label + ' commands',
                file: 'docs/cheatsheets/' + meta[id].cheatsheet,
                desc: text.desc || ('Commands for ' + meta[id].label + '.')
            });
        });
        return out;
    }

    var SHEETS = osSheets().concat([
        { id: 'dusky',   label: '🌙 Dusky / Hyprland',
          file: 'docs/cheatsheets/duskyos-hyprland.md',
          desc: 'Every keybind, the advanced commands, and what to do when it misbehaves.' },
        { id: 'full',    label: '📖 Full command reference',
          file: 'docs/helpful-commands.md',
          desc: 'The long one: packages, services, disks, permissions, security auditing, and per-desktop shortcuts.' },
        { id: 'duskyq',  label: '⚡ Dusky quick card',
          file: 'docs/dusky-cheatsheet.md',
          desc: 'The short version, for printing or keeping on a second screen.' }
    ]);

    /* The sheet for the system the reader has selected, or the first one when
       that system has no sheet of its own yet. Read at open time rather than
       cached, because the header switcher can change it under us. */
    function sheetForSelectedOs() {
        var key = (typeof window.targetOS === 'function') ? window.targetOS() : 'arch';
        var match = SHEETS.filter(function (s) { return s.os === key; })[0];
        return match || SHEETS[0];
    }

    var cache = {};   // file -> raw markdown, so switching tabs refetches nothing

    // Rendering is markdown.js's job now. There were three copies of a
    // markdown renderer on this site — one here, one in live.html, and none at
    // all in wiki.html, whose ?page= handler redirected to the raw .md file
    // instead. One implementation means a fix lands in all three places, and
    // this file no longer carries its own escaping rules to get wrong.
    function render(md) {
        if (typeof window.renderMarkdown !== 'function') {
            // No renderer: show the source as preformatted text rather than a
            // blank tab. Still escaped, still readable, just not styled.
            var pre = document.createElement('pre');
            pre.className = 'md-code';
            pre.textContent = md;
            return pre.outerHTML;
        }
        return window.renderMarkdown(md, { headingPrefix: 'cs-' }).html;
    }

    function el(id) { return document.getElementById(id); }

    function show(sheet) {
        var host = el('cs-content');
        var status = el('cs-status');

        // Reflect the choice in the URL so a tab is shareable and survives reload.
        try {
            var u = new URL(location.href);
            u.searchParams.set('sheet', sheet.id);
            history.replaceState(null, '', u);
        } catch (_) { /* file:// — not important */ }

        [].forEach.call(document.querySelectorAll('.cs-tab'), function (b) {
            var on = b.getAttribute('data-sheet') === sheet.id;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });

        el('cs-desc').textContent = sheet.desc;
        el('cs-source').href = sheet.file;

        function paint(mdText) {
            host.innerHTML = render(mdText);
            host.classList.remove('cs-in');
            // Next frame, so the transition actually runs rather than being
            // collapsed into the same style recalculation.
            requestAnimationFrame(function () { host.classList.add('cs-in'); });
            if (status) status.textContent = '';
            // Highlight the fenced blocks this render just produced. Scoped to
            // the host so it does not re-walk the rest of the page on every
            // tab switch.
            if (typeof window.highlightAll === 'function') window.highlightAll(host);
            wireCopyButtons();
        }

        if (cache[sheet.file]) { paint(cache[sheet.file]); return; }

        if (status) status.textContent = 'Loading…';
        fetch(sheet.file)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (t) { cache[sheet.file] = t; paint(t); })
            .catch(function (err) {
                host.innerHTML = '';
                if (status) {
                    status.innerHTML = '<strong style="color:var(--accent-orange);">' +
                        'Could not load this cheatsheet.</strong> It is still readable in ' +
                        'the repository: <a href="' + sheet.file + '">' + sheet.file +
                        '</a> (' + esc(err.message) + ')';
                }
            });
    }

    /* A copy button on every code block — the whole point of a cheatsheet is
       getting the command into a terminal. */
    function wireCopyButtons() {
        [].forEach.call(document.querySelectorAll('#cs-content pre.cs-code'), function (pre) {
            if (pre.querySelector('.cs-copy')) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'cs-copy';
            b.textContent = 'Copy';
            b.addEventListener('click', function () {
                var code = pre.querySelector('code');
                navigator.clipboard.writeText(code ? code.textContent : '').then(function () {
                    b.textContent = 'Copied';
                    setTimeout(function () { b.textContent = 'Copy'; }, 1400);
                }, function () {
                    b.textContent = 'Blocked';
                    setTimeout(function () { b.textContent = 'Copy'; }, 1800);
                });
            });
            pre.appendChild(b);
        });
    }

    function init() {
        var tabs = el('cs-tabs');
        if (!tabs) return;

        SHEETS.forEach(function (s) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'cs-tab nav-tooltip';
            b.textContent = s.label;
            b.setAttribute('data-sheet', s.id);
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('data-title', s.label);
            b.setAttribute('data-desc', s.desc);
            b.addEventListener('click', function () { show(s); });
            tabs.appendChild(b);
        });

        // Left/right arrows move between tabs, as a tablist should.
        tabs.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            var list = [].slice.call(tabs.querySelectorAll('.cs-tab'));
            var at = list.indexOf(document.activeElement);
            if (at === -1) return;
            e.preventDefault();
            var next = list[(at + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
            next.focus();
            next.click();
        });

        /* An explicit ?sheet= wins, because it is what a shared link means.
           Otherwise open the one for the selected system. */
        var want = null;
        try { want = new URL(location.href).searchParams.get('sheet'); } catch (_) { /* ignore */ }
        var start = SHEETS.filter(function (s) { return s.id === want; })[0] || sheetForSelectedOs();
        markSelectedOs();
        show(start);

        /* Switching system from the header re-points the page at that system's
           sheet, unless the reader has since chosen a different tab by hand —
           moving them off a sheet they deliberately opened would be the page
           arguing with them. */
        document.addEventListener('unix:os-changed', function () {
            markSelectedOs();
            var current = document.querySelector('.cs-tab.active');
            var currentId = current && current.getAttribute('data-sheet');
            var currentSheet = SHEETS.filter(function (s) { return s.id === currentId; })[0];
            if (currentSheet && !currentSheet.os) return;   // a shared sheet: leave it
            show(sheetForSelectedOs());
        });

        if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
    }

    /* Say which tab belongs to the system currently selected. Without this the
       tabs read as five equal options and nothing connects the page to the
       choice made in the header. */
    function markSelectedOs() {
        var mine = sheetForSelectedOs();
        [].forEach.call(document.querySelectorAll('.cs-tab'), function (b) {
            var id = b.getAttribute('data-sheet');
            var sheet = SHEETS.filter(function (s) { return s.id === id; })[0];
            var isMine = !!(sheet && sheet.os && sheet.id === mine.id);
            b.classList.toggle('cs-tab-current-os', isMine);
            if (isMine) b.setAttribute('data-current-os', 'yes');
            else b.removeAttribute('data-current-os');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
