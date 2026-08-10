/* ============================================================================
   site-index.js — the search behind the site index.
   ----------------------------------------------------------------------------
   Loads search-index.json (built by scripts/gen-search-index.py) and ranks
   matches. No search library: 300 entries is small enough that a scored
   substring match is both faster than loading a library and easier to reason
   about than one.

   Ranking, highest first:
     exact title match · title starts with the query · title contains it ·
     section contains it · description contains it
   with a bonus for matching every word of a multi-word query, so "dual boot
   windows" beats a page that merely says "windows".
   ========================================================================= */

'use strict';

(function () {
    var INDEX_URL = 'search-index.json';
    var entries = [];
    var loaded = false;
    var sortMode = 'relevance';   // 'relevance' | 'az' | 'section'
    var lastResults = [];         // scored+sorted, for re-sorting without re-scoring
    var lastWords = [];
    var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function el(id) { return document.getElementById(id); }

    function normalise(s) {
        return String(s || '').toLowerCase()
            // Fold the punctuation people leave out when searching.
            .replace(/[·—–\-_/]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function score(entry, q, words) {
        var t = normalise(entry.t);
        var s = normalise(entry.s);
        var d = normalise(entry.d);
        var n = 0;

        if (t === q) n += 1000;
        else if (t.indexOf(q) === 0) n += 500;
        else if (t.indexOf(q) !== -1) n += 300;

        if (s.indexOf(q) !== -1) n += 60;
        if (d.indexOf(q) !== -1) n += 40;

        // Every word present somewhere is a strong signal for a phrase query.
        var hitAll = words.every(function (w) {
            return t.indexOf(w) !== -1 || s.indexOf(w) !== -1 || d.indexOf(w) !== -1;
        });
        if (hitAll) n += 120 * words.length;

        words.forEach(function (w) {
            if (t.indexOf(w) !== -1) n += 45;
            else if (s.indexOf(w) !== -1) n += 12;
            else if (d.indexOf(w) !== -1) n += 8;
        });

        // Shorter titles are usually the more specific destination.
        if (n > 0) n += Math.max(0, 40 - t.length) / 4;
        return n;
    }

    /* Human-readable location instead of a raw href.
       "wiki.html#bios-lockdown" says less at a glance than
       "Wiki → Bios lockdown", and "docs/05-secure-boot/shim-grub.md#signing"
       says much less than "Docs → 05 secure boot → Shim grub → Signing". */
    var PAGE_NAMES = {
        'index.html': 'Generator',
        'manual.html': 'Manual walkthrough',
        'wiki.html': 'Wiki',
        'iso-verify.html': 'Verify Arch ISO',
        'security-tools.html': 'Security tools',
        'live.html': 'Live editor',
        'releases.html': 'Releases',
        'repo.html': 'Repository',
        'site-index.html': 'Index'
    };

    function titleCase(s) {
        s = String(s).replace(/\.(html|md)$/i, '').replace(/[-_]+/g, ' ').trim();
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    function breadcrumb(href) {
        var hash = '';
        var path = String(href);
        var at = path.indexOf('#');
        if (at !== -1) { hash = path.slice(at + 1); path = path.slice(0, at); }

        /* Documents are linked as `wiki.html?page=<path>.md` so they render
           inside the wiki rather than being served as raw markdown. The reader
           should still be told where the thing is, not how it is fetched, so
           the crumb is built from the document's own path. */
        var q = path.indexOf('?page=');
        if (q !== -1) {
            var doc = decodeURIComponent(path.slice(q + 6));
            // The handler resolves everything against docs/ except the
            // agreements, which it serves from the site root.
            path = doc.indexOf('user-agreements/') === 0 ? doc : 'docs/' + doc;
            // The renderer prefixes every heading id, which is plumbing rather
            // than part of the section's name.
            hash = hash.replace(/^doc-/, '');
        }

        var parts = path.split('/').filter(Boolean);
        var crumbs;
        if (parts.length === 1 && PAGE_NAMES[parts[0]]) {
            crumbs = [PAGE_NAMES[parts[0]]];
        } else {
            crumbs = parts.map(function (p, i) {
                if (i === 0 && p === 'docs') return 'Docs';
                return titleCase(p);
            });
        }
        if (hash) crumbs.push(titleCase(hash.replace(/^q-/, '')));
        return crumbs.join(' → ');
    }

    function highlight(text, words) {
        var out = document.createDocumentFragment();
        var lower = String(text).toLowerCase();
        var marks = [];
        words.forEach(function (w) {
            if (!w) return;
            var from = 0, at;
            while ((at = lower.indexOf(w, from)) !== -1) {
                marks.push([at, at + w.length]);
                from = at + w.length;
            }
        });
        if (!marks.length) { out.appendChild(document.createTextNode(text)); return out; }
        marks.sort(function (a, b) { return a[0] - b[0]; });
        // Merge overlaps so nested <mark>s cannot happen.
        var merged = [marks[0]];
        for (var i = 1; i < marks.length; i++) {
            var last = merged[merged.length - 1];
            if (marks[i][0] <= last[1]) last[1] = Math.max(last[1], marks[i][1]);
            else merged.push(marks[i]);
        }
        var pos = 0;
        merged.forEach(function (m) {
            if (m[0] > pos) out.appendChild(document.createTextNode(text.slice(pos, m[0])));
            var mk = document.createElement('mark');
            mk.textContent = text.slice(m[0], m[1]);
            out.appendChild(mk);
            pos = m[1];
        });
        if (pos < text.length) out.appendChild(document.createTextNode(text.slice(pos)));
        return out;
    }

    /* Re-order already-scored results for the current sort mode. Relevance is
       the order they arrive in (highest score first); the others are stable
       alphabetical, so toggling sort never reshuffles equal items at random. */
    function applySort(results) {
        if (sortMode === 'az') {
            return results.slice().sort(function (a, b) {
                return normalise(a.t).localeCompare(normalise(b.t));
            });
        }
        if (sortMode === 'section') {
            return results.slice().sort(function (a, b) {
                return normalise(a.s).localeCompare(normalise(b.s)) ||
                       normalise(a.t).localeCompare(normalise(b.t));
            });
        }
        return results; // relevance: leave as scored
    }

    function render(results, words) {
        var host = el('search-results');
        var contents = el('site-contents');
        var count = el('result-count');
        var sortWrap = el('sort-wrap');
        host.innerHTML = '';

        lastResults = results;
        lastWords = words;

        if (!results.length) {
            contents.hidden = false;
            host.hidden = true;
            count.textContent = '';
            if (sortWrap) sortWrap.hidden = true;
            return;
        }
        contents.hidden = true;
        host.hidden = false;
        if (sortWrap) sortWrap.hidden = false;
        count.textContent = results.length + (results.length === 1 ? ' result' : ' results');

        var ordered = applySort(results);
        ordered.forEach(function (r, i) {
            var a = document.createElement('a');
            a.className = 'result';
            // Staggered entrance: each card starts a beat after the one above,
            // capped so a 60-result view finishes settling quickly. Pure
            // transform/opacity, and skipped entirely under reduced-motion.
            if (!reducedMotion) {
                a.classList.add('result-enter');
                a.style.animationDelay = Math.min(i * 22, 400) + 'ms';
            }
            a.href = r.u;
            // Drives the colour coding: one accent per place a result can
            // come from, matching the wiki sidebar.
            a.setAttribute('data-src', r.s);
            var head = document.createElement('span');
            head.className = 'result-title';
            head.appendChild(highlight(r.t, words));
            var sec = document.createElement('span');
            sec.className = 'result-section';
            sec.textContent = r.s;
            var desc = document.createElement('span');
            desc.className = 'result-desc';
            desc.appendChild(highlight(r.d || '', words));
            var url = document.createElement('span');
            url.className = 'result-url';
            url.textContent = breadcrumb(r.u);
            a.appendChild(head);
            a.appendChild(sec);
            if (r.d) a.appendChild(desc);
            a.appendChild(url);
            host.appendChild(a);
        });
    }

    function search(raw) {
        var q = normalise(raw);
        if (q.length < 2) { render([], []); return; }
        var words = q.split(' ').filter(Boolean);
        var scored = [];
        for (var i = 0; i < entries.length; i++) {
            var n = score(entries[i], q, words);
            if (n > 0) scored.push({ e: entries[i], n: n });
        }
        scored.sort(function (a, b) { return b.n - a.n; });
        render(scored.slice(0, 60).map(function (x) { return x.e; }), words);
    }

    function wire() {
        var box = el('site-search');
        if (!box) return;

        var pending = null;
        box.addEventListener('input', function () {
            // Debounced, because scoring 300 entries per keystroke on a phone
            // is wasted work when the next keystroke is 80ms away.
            clearTimeout(pending);
            pending = setTimeout(function () { search(box.value); }, 90);
        });

        box.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { box.value = ''; search(''); }
            if (e.key === 'Enter') {
                var first = document.querySelector('#search-results .result');
                if (first) { e.preventDefault(); location.href = first.getAttribute('href'); }
            }
            if (e.key === 'ArrowDown') {
                var f = document.querySelector('#search-results .result');
                if (f) { e.preventDefault(); f.focus(); }
            }
        });

        // "/" focuses search from anywhere on the page, the way every
        // documentation site does. Not while you are typing in a field.
        document.addEventListener('keydown', function (e) {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            var tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
            e.preventDefault();
            box.focus();
            box.select();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var active = document.activeElement;
            if (!active || !active.classList.contains('result')) return;
            e.preventDefault();
            var next = e.key === 'ArrowDown' ? active.nextElementSibling : active.previousElementSibling;
            if (next) next.focus();
            else if (e.key === 'ArrowUp') el('site-search').focus();
        });

        // Sort control: re-orders the current results without re-scoring.
        var sortSel = el('sort-mode');
        if (sortSel) {
            sortSel.addEventListener('change', function () {
                sortMode = sortSel.value;
                if (lastResults.length) render(lastResults, lastWords);
            });
        }

        // A query in the URL makes a search shareable: site-index.html?q=luks
        var params = new URLSearchParams(location.search);
        var q = params.get('q');
        if (q) { box.value = q; }
    }

    function load() {
        // Feature-detect fetch so a browser without it takes the same graceful
        // path as a failed request — the full contents list below still works —
        // instead of throwing a ReferenceError that would leave the search box
        // stuck on "Loading the search index…" forever.
        if (typeof fetch !== 'function') {
            var st = el('search-status');
            if (st) {
                st.innerHTML =
                    '<strong style="color:var(--accent-orange);">Search needs a newer browser.</strong> ' +
                    'Every destination is still listed below, and the ' +
                    '<a href="wiki.html">wiki</a> has its own section filter.';
            }
            return;
        }
        fetch(INDEX_URL, { cache: 'default' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                entries = Array.isArray(data) ? data : [];
                loaded = true;
                var status = el('search-status');
                if (status) {
                    status.textContent = 'Searching ' + entries.length +
                        ' pages, sections, questions and documents.';
                }
                var box = el('site-search');
                if (box) {
                    box.disabled = false;
                    box.placeholder = 'Search everything — try "luks", "dual boot", "aur"…';
                    if (box.value) search(box.value);
                }
            })
            .catch(function (err) {
                var status = el('search-status');
                if (status) {
                    status.innerHTML =
                        '<strong style="color:var(--accent-orange);">Search index unavailable.</strong> ' +
                        'Every destination is still listed below, and the ' +
                        '<a href="wiki.html">wiki</a> has its own section filter. (' +
                        String(err.message) + ')';
                }
            });
    }

    function init() { wire(); load(); }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
