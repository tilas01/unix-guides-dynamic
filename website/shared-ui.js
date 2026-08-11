/* ============================================================================
   shared-ui.js — the parts of the interface that must be identical everywhere.
   ----------------------------------------------------------------------------
   Loaded by every page. Five jobs:

     1. The canonical top navigation, so every page offers the same
        destinations in the same order — hand-copied navs had already drifted.

     2. The persistent control cluster, top right. Built here rather than
        copied into nine HTML files, because a control that exists on eight
        pages and not the ninth is the one a user goes looking for on the ninth.
        Order is fixed: the tooltip switch first, because it is the control that
        explains all the others; then the source repository; then this session's
        generation history.

     3. The target-system switcher, top left. Deliberately the opposite corner
        from the control cluster: it is not one control among several, it is the
        thing that decides what everything else on the page is about.

     4. A warning before you close the tab with unsaved generation history.
        History is sessionStorage, so closing the tab is the moment it is gone
        for good.

     5. Making sure tooltips are actually initialised. tooltip.js does the work;
        this only guarantees it gets a chance to on every page.

   No dependencies, no build step, and it degrades to "nothing happens" rather
   than throwing if a page lacks a piece it expects.
   ========================================================================= */

'use strict';

(function () {
    var REPO_URL = 'https://github.com/tilas01/unix-guides-dynamic';

    /* ── The canonical top navigation ───────────────────────────────────────
       One definition, applied to every page, because hand-copied navs drift:
       an audit found manual.html labelled itself "Manual" instead of "Manual
       Walkthrough" and omitted the Live Editor, site-index.html omitted it too,
       releases.html had three extra entries nobody else had, and live.html,
       repo.html and upload.html had no navigation at all — so the Live Editor
       link appeared to vanish depending on which page you were standing on.

       Rendered here rather than in ten HTML files so that can no longer happen.
       A page that already has a .main-nav has it normalised in place; a page
       with none gets one. */
    var NAV = [
        // First, because it is where the chooser sends a reader once they have
        // picked a system: one page that says what the project is, offers the
        // four routes into it, and searches the whole index without having to
        // guess which route holds the answer.
        { href: 'home.html',          label: '🏠 Home',
          title: '🏠 Home',
          desc: 'The front door. What this project is, the four ways into it, and a search box that covers every guide, wiki section, question and document at once.' },
        { href: 'site-index.html',    label: '🔎 Index',
          title: '🔎 Index',
          desc: 'The contents page for the whole project, with a search box that looks through the wiki, every generator and walkthrough question, the security tools, the cheatsheets and the docs at once.' },
        // Named in full, matching its sibling. The nav said "Generator" beside
        // "*nix Install Walkthrough", so the two front ends read as though one were
        // the default and the other a variant of it. They are two equal routes
        // to the same install and are named as such everywhere else.
        { href: 'index.html',         label: '⚙️ *nix Install Generator',
          title: '⚙️ *nix Install Generator',
          desc: 'Set every option in one form and generate a custom Arch install script and guide. Fastest on a desktop when you already know what you want.' },
        { href: 'manual.html',        label: '🧭 *nix Install Walkthrough',
          title: '🧭 *nix Install Walkthrough',
          desc: 'One question at a time, every option explained, the guide building as you answer. Same output as the generator. Recommended on mobile, or if you are not yet sure what you want.' },
        // Live Editor sits directly after the two generators because that is
        // where their output goes — the three are one flow, and separating them
        // with the reference pages made the editor look like an unrelated tool.
        { href: 'live.html',          label: '📝 Live Editor',
          title: '📝 Live Editor',
          desc: 'Edit a generated script and guide side by side, browse this session\'s generation history, and download the results.' },
        // The only nav entry that names an operating system, so it is the only
        // one that has to follow the switcher. Its label is rebuilt whenever
        // the selection changes — see applyOsIdentity().
        { href: 'iso-verify.html',    label: '💿 Verify ISO',
          title: '💿 Verify ISO',
          desc: 'Hash an installer image in your browser and compare it against checksums from mirrors other than the one that served the image. Nothing is uploaded.' },
        { href: 'security-tools.html', label: '🦀 Security Tools',
          title: '🦀 Arch Security Tools',
          desc: 'Every Rust security tool explained, with live release statistics, plus the vetted third-party hardening tools.' },
        { href: 'wiki.html',          label: '📖 Wiki',
          title: '📖 Wiki / Documentation',
          desc: 'Every option explained in full, plus firmware lockdown, dual boot, ARM, AUR safety and the cheatsheets.' },
        // Cheatsheets last, deliberately: it is what you reach for after the
        // system is installed, not while you are deciding how to install it.
        { href: 'cheatsheets.html',   label: '📋 Cheatsheets',
          title: '📋 Cheatsheets',
          desc: 'Every cheatsheet in one tabbed page: Arch and pacman, the AUR, systemd, Btrfs snapshots, LUKS, the Rust security suite, and Dusky and Hyprland keybinds. Searchable and copyable.' }
    ];

    function currentPage() {
        return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    }

    function buildNav(header) {
        var here = currentPage();
        var nav = header.querySelector('nav.main-nav');
        if (!nav) {
            // Pages with no nav at all (live.html, repo.html, upload.html) get
            // one, so every page reaches every other page.
            nav = document.createElement('nav');
            nav.className = 'main-nav';
            var banner = header.querySelector('.banner-link');
            if (banner && banner.parentNode) banner.parentNode.insertBefore(nav, banner.nextSibling);
            else header.appendChild(nav);
        }
        nav.setAttribute('aria-label', 'Site');
        nav.innerHTML = '';

        NAV.forEach(function (item, i) {
            if (i) {
                var sep = document.createElement('span');
                sep.className = 'nav-sep';
                sep.textContent = '|';
                nav.appendChild(sep);
            }
            var a = document.createElement('a');
            a.className = 'nav-link nav-tooltip';
            a.href = item.href;
            a.textContent = item.label;
            a.setAttribute('data-title', item.title);
            a.setAttribute('data-desc', item.desc);
            // Mark, but do not disable, the page you are on: it stays clickable
            // so it doubles as a reload, and the colour says where you are.
            if (item.href.toLowerCase() === here) {
                a.setAttribute('aria-current', 'page');
                a.style.color = 'var(--accent-cyan)';
            }
            nav.appendChild(a);
        });
    }

    /* Set by iso-verify.js when a hash matches two independent mirrors. Session
       scoped on purpose: the claim "you verified an ISO" should not outlive the
       session that verified it. */
    var ISO_VERIFIED_KEY = 'arch_iso_verified';
    var HISTORY_KEY = 'arch_gen_history';
    var HISTORY_SAVED_KEY = 'arch_gen_history_saved';

    function ss(fn, fallback) {
        // sessionStorage throws in private mode in some browsers, and in any
        // sandboxed iframe. Treat it as absent rather than letting it take the
        // whole script down.
        try { return fn(); } catch (_) { return fallback; }
    }

    function isoVerified() {
        return ss(function () { return sessionStorage.getItem(ISO_VERIFIED_KEY) === '1'; }, false);
    }

    function historyCount() {
        return ss(function () {
            var raw = sessionStorage.getItem(HISTORY_KEY);
            if (!raw) return 0;
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.length : 0;
        }, 0);
    }

    function historySaved() {
        return ss(function () { return sessionStorage.getItem(HISTORY_SAVED_KEY) === '1'; }, true);
    }

    /* Pages call this when the user downloads or exports, so the close warning
       stops nagging about work that is no longer only in the tab. */
    window.markHistorySaved = function () {
        ss(function () { sessionStorage.setItem(HISTORY_SAVED_KEY, '1'); });
        refreshHistoryBadge();
    };

    window.markIsoVerified = function () {
        ss(function () { sessionStorage.setItem(ISO_VERIFIED_KEY, '1'); });
        refreshIsoBadge();
    };

    /* ── The target-system switcher ──────────────────────────────────────────
       Top left, opposite the control cluster. The placement is the point: the
       cluster on the right is a row of tools that act on the page, and this is
       not one of those — it decides which operating system the page is about,
       so it sits on its own and reads as a statement of what you are looking at
       rather than a button among buttons.

       os-meta.js owns the table and the selection; this owns the picture of it.
       Nothing here keeps its own copy of which system is current — it reads
       `chosenOS()` every time it draws, so the dropdown, the walkthrough
       question and the generated guide cannot drift apart. */

    function osApi() {
        // Feature-detected rather than assumed. If os-meta.js failed to load,
        // every page still works; it just has no switcher, which is a visible
        // absence rather than a control that silently does nothing.
        return (typeof window.OS_META === 'object' && window.OS_META &&
                typeof window.chosenOS === 'function' &&
                typeof window.setTargetOS === 'function') ? window.OS_META : null;
    }

    function osMark(slug, size) {
        var img = document.createElement('img');
        img.src = 'img/icons/' + slug + '-' + (size > 32 ? 64 : 32) + '.png';
        img.width = size;
        img.height = size;
        img.alt = '';
        img.className = 'ctrl-pixel';
        return img;
    }

    /* What the switcher button says. Before a choice has been made it invites
       one rather than showing a default: the site is neutral until asked, and a
       button already reading "Arch Linux" would look like a decision somebody
       had made. */
    function osButtonText(chosen, META) {
        return chosen ? META[chosen].label : 'Choose your system';
    }

    function buildOsSwitch(header) {
        var META = osApi();
        if (!META) return;

        var wrap = document.getElementById('os-switch');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'os-switch';
            wrap.className = 'js-only';
            header.insertBefore(wrap, header.firstChild);
        }
        wrap.innerHTML = '';

        var btn = document.createElement('button');
        btn.id = 'os-switch-btn';
        btn.type = 'button';
        btn.className = 'os-switch-btn nav-tooltip';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('data-title', '🐧 Which system you are installing');
        btn.setAttribute('data-desc',
            'Changes every guide, script and label on the site to the system you ' +
            'pick. Only Arch is finished; the other three are marked and are for ' +
            'reading, not installing. Held for this browser session only.');
        wrap.appendChild(btn);

        var menu = document.createElement('div');
        menu.id = 'os-switch-menu';
        menu.className = 'os-switch-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', 'Target operating system');
        menu.hidden = true;
        wrap.appendChild(menu);

        Object.keys(META).forEach(function (id) {
            var m = META[id];
            // Listed whether or not it can be chosen. Seeing what is coming is
            // worth something; being handed an unfinished guide is not.
            var pickable = typeof window.osSelectable !== 'function' || window.osSelectable(id);
            var opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'os-opt os-accent-' + m.accent + (pickable ? '' : ' os-opt-locked');
            opt.setAttribute('role', 'option');
            opt.setAttribute('data-os', id);
            if (!pickable) opt.setAttribute('aria-disabled', 'true');

            opt.appendChild(osMark(m.slug, 24));

            var text = document.createElement('span');
            text.className = 'os-opt-text';

            var name = document.createElement('span');
            name.className = 'os-opt-name';
            name.textContent = m.label;
            if (!pickable) {
                var wip = document.createElement('span');
                wip.className = 'os-opt-wip';
                wip.textContent = '🚧 not available yet';
                name.appendChild(document.createTextNode(' '));
                name.appendChild(wip);
            }
            text.appendChild(name);

            var sum = document.createElement('span');
            sum.className = 'os-opt-summary';
            // Incomplete systems say so here rather than only in the badge. The
            // badge is a label; this is the sentence that tells someone the
            // guide will not install anything.
            sum.textContent = pickable
                ? m.summary
                : m.summary + ' Still being written — cannot be selected yet.';
            text.appendChild(sum);

            opt.appendChild(text);
            opt.addEventListener('click', function () {
                if (!pickable) {
                    // setTargetOS would refuse anyway; saying so beats a click
                    // that silently does nothing.
                    sum.textContent = typeof window.osUnavailableReason === 'function'
                        ? window.osUnavailableReason(id)
                        : m.label + ' is not available yet.';
                    sum.style.color = 'var(--accent-orange)';
                    return;
                }
                window.setTargetOS(id);
                closeOsMenu();
                var b = document.getElementById('os-switch-btn');
                if (b) b.focus();
            });
            menu.appendChild(opt);
        });

        btn.addEventListener('click', function () {
            if (menu.hidden) openOsMenu(); else closeOsMenu();
        });

        paintOsSwitch();
    }

    /* Redrawn from the stored selection rather than from a variable this file
       keeps, so it cannot show one system while the guide is built for
       another. */
    function paintOsSwitch() {
        var META = osApi();
        var wrap = document.getElementById('os-switch');
        var btn = document.getElementById('os-switch-btn');
        if (!META || !wrap || !btn) return;

        var chosen = window.chosenOS();
        var ident = chosen ? META[chosen] : window.OS_NEUTRAL;

        btn.innerHTML = '';
        btn.appendChild(osMark(ident.slug, 22));
        var label = document.createElement('span');
        label.className = 'os-switch-label';
        label.textContent = osButtonText(chosen, META);
        btn.appendChild(label);
        var caret = document.createElement('span');
        caret.className = 'os-switch-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▾';
        btn.appendChild(caret);

        wrap.className = 'js-only os-accent-' + ident.accent +
                         (chosen && META[chosen].complete === false ? ' os-wip' : '');

        var menu = document.getElementById('os-switch-menu');
        if (menu) {
            [].forEach.call(menu.querySelectorAll('.os-opt'), function (o) {
                var is = o.getAttribute('data-os') === chosen;
                o.setAttribute('aria-selected', String(is));
                o.classList.toggle('is-current', is);
            });
        }
    }

    function openOsMenu() {
        var menu = document.getElementById('os-switch-menu');
        var btn = document.getElementById('os-switch-btn');
        if (!menu || !btn) return;
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        document.addEventListener('keydown', osMenuKeys);
        document.addEventListener('click', osMenuOutside, true);
        var first = menu.querySelector('.is-current') || menu.querySelector('.os-opt');
        if (first) first.focus();
    }

    function closeOsMenu() {
        var menu = document.getElementById('os-switch-menu');
        var btn = document.getElementById('os-switch-btn');
        if (menu) menu.hidden = true;
        if (btn) btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', osMenuKeys);
        document.removeEventListener('click', osMenuOutside, true);
    }

    function osMenuKeys(e) {
        if (e.key === 'Escape') {
            closeOsMenu();
            var btn = document.getElementById('os-switch-btn');
            if (btn) btn.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        var menu = document.getElementById('os-switch-menu');
        if (!menu || menu.hidden) return;
        var opts = [].slice.call(menu.querySelectorAll('.os-opt'));
        var at = opts.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' ? at + 1 : at - 1;
        if (next < 0) next = opts.length - 1;
        if (next >= opts.length) next = 0;
        if (opts[next]) { e.preventDefault(); opts[next].focus(); }
    }

    function osMenuOutside(e) {
        var wrap = document.getElementById('os-switch');
        if (wrap && !wrap.contains(e.target)) closeOsMenu();
    }

    /* ── Everything else that names the system ───────────────────────────────
       The banner and the one navigation entry that carries an OS name. Both
       neutral until a choice is made, which is the rule for the whole header:
       no logo and no system name before selection. */

    /* The three navigation entries that name a system. Everything else on the
       site is the same whichever one is selected, so everything else keeps a
       fixed name — a label that changes for no reason is harder to find again,
       not easier. */
    var OS_NAMED_NAV = {
        // `media` rather than a fixed "ISO": Raspberry Pi OS publishes a
        // compressed disk image you write to a card, so "Verify Raspberry Pi
        // ISO" would name a file that does not exist.
        'iso-verify.html': { icon: '💿', suffix: null, verb: 'Verify' },
        'index.html':      { icon: '⚙️', suffix: 'Install Generator' },
        'manual.html':     { icon: '🧭', suffix: 'Install Walkthrough' }
    };

    function osNavLabel(href, chosen, META) {
        var spec = OS_NAMED_NAV[href];
        var name = chosen ? (META[chosen].short || META[chosen].label) : '';
        var parts = [spec.icon];
        if (spec.verb) parts.push(spec.verb);
        if (name) parts.push(name);
        // The verify entry takes its noun from the system; the others have a
        // fixed one. Before a system is chosen it is just "Verify image".
        parts.push(spec.suffix || (chosen ? META[chosen].media : 'image'));
        return parts.join(' ');
    }

    /* The attribution that used to be inside the banner image. Placed after the
       banner's own link rather than inside it, so it is a link to the author
       rather than part of a link to the repository — two different
       destinations, and one wrapped in the other cannot be reached. */
    function addBannerCredit(img) {
        var anchor = img.closest ? img.closest('a') : null;
        var host = anchor || img;
        if (!host.parentNode) return;
        var credit = document.getElementById('banner-credit');
        if (!credit) {
            credit = document.createElement('p');
            credit.id = 'banner-credit';
            credit.className = 'banner-credit';
            var a = document.createElement('a');
            a.href = 'https://github.com/tilas01';
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = 'by tilas01 on GitHub';
            credit.appendChild(a);
            host.parentNode.insertBefore(credit, host.nextSibling);
        }
    }

    function applyOsIdentity() {
        var META = osApi();
        if (!META) return;
        var chosen = window.chosenOS();
        var ident = chosen ? META[chosen] : window.OS_NEUTRAL;
        var name = chosen ? (META[chosen].short || META[chosen].label) : '';

        /* The header banner. Matched on the file name rather than a class,
           because wiki.html's is an inline-styled <img> with no class and it
           would otherwise be the one page that kept the Arch banner.

           The `-plain` variant: the banner is scaled to a few hundred pixels
           here, and the attribution baked into the image is a 7px bitmap line
           that becomes an unreadable smudge at that size. Drawn as text below
           instead, where it scales with the viewport rather than against it.
           The README keeps the version with the credit inside, because there
           the image is full width and travels on its own. */
        var bannerImg = null;
        [].forEach.call(document.querySelectorAll('header img'), function (img) {
            var src = img.getAttribute('src') || '';
            if (src.indexOf('banner') === -1) return;
            img.src = 'img/banners/' + ident.slug + '-plain.png';
            img.alt = ident.label + ' banner';
            bannerImg = img;
        });
        if (bannerImg) addBannerCredit(bannerImg);

        Object.keys(OS_NAMED_NAV).forEach(function (href) {
            var label = osNavLabel(href, chosen, META);
            [].forEach.call(document.querySelectorAll(
                '.main-nav a[href="' + href + '"], .footer-links a[href="' + href + '"]'
            ), function (a) {
                a.textContent = label;
                if (a.hasAttribute('data-title')) a.setAttribute('data-title', label);
            });
        });

        /* Page headings that name the system. Each page marks its own with an
           id rather than this file guessing from the text, so a heading that is
           reworded does not quietly stop following the selection. */
        var headings = {
            'gen-title': '⚙️ ' + (name ? name + ' ' : '') + 'Install Generator',
            'gen-settings-heading': (name ? name + ' ' : '') + 'Generator Settings',
            'walk-title': '🧭 ' + (name ? name + ' ' : '') + 'Install Walkthrough'
        };
        Object.keys(headings).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = headings[id];
        });

        paintOsSwitch();
    }

    // Exposed so a page can relabel its own content on the same signal without
    // reaching into this file's internals.
    window.applyOsIdentity = applyOsIdentity;

    /* ── 1. The control cluster ─────────────────────────────────────────── */

    /* ── The shared history overlay ──────────────────────────────────────────
       Reachable from every page, because the history is session-wide and the
       thing you most want when you notice it is disappearing is a way to get it
       out. Read-only by design: it shows what is there, lets you copy or
       download it, and hands off to the Live Editor for anything more. Writing
       back into a page that may not have a form to write into is how the
       generator-only version stayed generator-only.

       Entries are written by both front ends with the shape
       `{ timestamp, source, format, md, sh, post, sc }`. */
    function readHistoryEntries() {
        return ss(function () {
            var raw = sessionStorage.getItem(HISTORY_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }, []);
    }

    function downloadText(name, text, mime) {
        try {
            var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            // Downloading counts as saving, so the close warning stops nagging.
            if (typeof window.markHistorySaved === 'function') window.markHistorySaved();
        } catch (_) { /* nothing sensible to do; the overlay stays open */ }
    }

    function copyToClipboard(text, btn) {
        function done(okFlag) {
            if (!btn) return;
            var was = btn.textContent;
            btn.textContent = okFlag ? '✅ Copied' : '⚠ Press Ctrl+C';
            setTimeout(function () { btn.textContent = was; }, 1600);
        }
        // navigator.clipboard needs a secure context, which file:// and plain
        // http are not — and this site has to work from a live USB.
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        } else { fallback(); }
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var okFlag = false;
            try { okFlag = document.execCommand('copy'); } catch (_) { okFlag = false; }
            document.body.removeChild(ta);
            done(okFlag);
        }
    }

    function openHistoryOverlay() {
        var existing = document.getElementById('shared-history-overlay');
        if (existing) { closeHistoryOverlay(); return; }

        var entries = readHistoryEntries();

        var ov = document.createElement('div');
        ov.id = 'shared-history-overlay';
        ov.className = 'history-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', 'Generation history');

        var panel = document.createElement('div');
        panel.className = 'history-panel';

        var head = document.createElement('div');
        head.className = 'history-head';
        head.innerHTML = '<h2>🕘 This session\'s generations</h2>' +
            '<p>' + (entries.length
                ? entries.length + ' saved. Session-only — no cookies, and gone when this ' +
                  'tab closes, so download anything you want to keep.'
                : 'Nothing yet. Anything you generate in the *nix Install Generator or finish ' +
                  'in the *nix Install Walkthrough appears here.') + '</p>';
        panel.appendChild(head);

        if (entries.length) {
            var list = document.createElement('ol');
            list.className = 'history-list';
            entries.forEach(function (e, i) {
                var li = document.createElement('li');
                li.className = 'history-item';

                var meta = document.createElement('div');
                meta.className = 'history-meta';
                var src = e.source === 'manual-walkthrough' ? '🧭 *nix Install Walkthrough'
                        : e.source === 'dynamic-generator' ? '⚙️ *nix Install Generator'
                        : '📄 Generated';
                /* Name the system too. Two entries made minutes apart for
                   different systems are otherwise identical here, and the one
                   restored decides which commands somebody runs. Older entries
                   have no `os`, so they are left unlabelled rather than
                   labelled with a guess. */
                var osName = '';
                if (e.os && typeof window.OS_META === 'object' && window.OS_META &&
                        window.OS_META[e.os]) {
                    var om = window.OS_META[e.os];
                    // Table-sourced, so it cannot carry markup — but stripped
                    // anyway, because this is assigned through innerHTML and
                    // the entry itself came out of storage.
                    osName = ' · ' + String(om.short || om.label).replace(/[<>&]/g, '');
                }
                meta.innerHTML = '<strong>' + src + osName + '</strong>' +
                    '<span>' + String(e.timestamp || '').replace(/[<>&]/g, '') + '</span>';
                li.appendChild(meta);

                var acts = document.createElement('div');
                acts.className = 'history-actions';
                [
                    ['md',  '⬇️ .md',   'guide-' + (i + 1) + '.md',  'text/markdown'],
                    ['sh',  '⬇️ .sh',   'install-' + (i + 1) + '.sh', 'text/x-shellscript'],
                    ['post', '⬇️ post.sh', 'post-install-' + (i + 1) + '.sh', 'text/x-shellscript'],
                    ['sc',  '⬇️ .json', 'config-' + (i + 1) + '.json', 'application/json']
                ].forEach(function (spec) {
                    var content = e[spec[0]];
                    if (!content || !String(content).trim()) return;   // never offer an empty file
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'btn btn-ghost history-btn-sm';
                    b.textContent = spec[1];
                    b.addEventListener('click', function () {
                        downloadText(spec[2], content, spec[3]);
                    });
                    acts.appendChild(b);
                });

                var copy = document.createElement('button');
                copy.type = 'button';
                copy.className = 'btn btn-ghost history-btn-sm';
                copy.textContent = '📋 Copy guide';
                copy.addEventListener('click', function (ev) {
                    copyToClipboard(e.md || e.sh || '', ev.target);
                });
                acts.appendChild(copy);

                // The Live Editor is where you change one before using it.
                var open = document.createElement('a');
                open.className = 'btn btn-ghost history-btn-sm';
                open.href = 'live.html';
                open.textContent = '📝 Open editor';
                acts.appendChild(open);

                li.appendChild(acts);
                list.appendChild(li);
            });
            panel.appendChild(list);
        }

        var foot = document.createElement('div');
        foot.className = 'history-foot';
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn';
        close.textContent = 'Close';
        close.addEventListener('click', closeHistoryOverlay);
        foot.appendChild(close);
        panel.appendChild(foot);

        ov.appendChild(panel);
        document.body.appendChild(ov);
        document.body.style.overflow = 'hidden';

        // Click outside, and Escape, both close it.
        ov.addEventListener('click', function (e) { if (e.target === ov) closeHistoryOverlay(); });
        document.addEventListener('keydown', escClose);
        close.focus();
    }

    function escClose(e) { if (e.key === 'Escape') closeHistoryOverlay(); }

    function closeHistoryOverlay() {
        var ov = document.getElementById('shared-history-overlay');
        if (ov) ov.remove();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', escClose);
    }

    /* ── Clearing the history, with what is about to be lost spelled out ─────
       Both "clear history" controls wipe the same session-wide store — the
       generator's and the editor's — which is right: there is one history, not
       one per page. What they did not do is say what was in it. A bare "are you
       sure?" is answered yes by reflex, and the thing being discarded only
       exists in this tab: close it and it is gone regardless.

       So the question now lists every guide by number, where it came from and
       when, and offers the option that makes the choice safe — take them with
       you first. Three ways out, and the destructive one is not the default.

       Exposed on window so both front ends call the same code. Two dialogs
       phrased differently about the same irreversible act is how one of them
       ends up understating it. */
    function clearHistoryWithWarning(onCleared) {
        var entries = readHistoryEntries();

        function wipe() {
            ss(function () { sessionStorage.removeItem(HISTORY_KEY); });
            ss(function () { sessionStorage.setItem(HISTORY_SAVED_KEY, '1'); });
            refreshHistoryBadge();
            try { document.dispatchEvent(new CustomEvent('arch:history-changed')); } catch (_) { }
            if (typeof onCleared === 'function') onCleared();
        }

        // Nothing stored: no drama, and no dialog for an empty action.
        if (!entries.length) { wipe(); return; }

        var ov = document.createElement('div');
        ov.className = 'history-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', 'Clear generation history');

        var panel = document.createElement('div');
        panel.className = 'history-panel';

        var head = document.createElement('div');
        head.className = 'history-head';
        head.innerHTML = '<h2>🗑️ Clear all ' + entries.length + ' generated guide' +
            (entries.length === 1 ? '' : 's') + '?</h2>' +
            '<p>This clears the whole session, not just this page. These are held ' +
            'in this tab only — there is no copy anywhere else, and closing the tab ' +
            'loses them too. Download them first if you want to keep any of it.</p>';
        panel.appendChild(head);

        var list = document.createElement('ol');
        list.className = 'history-list';
        entries.forEach(function (e, i) {
            var li = document.createElement('li');
            li.className = 'history-item';
            var src = e.source === 'manual-walkthrough' ? '🧭 Walkthrough'
                    : e.source === 'dynamic-generator' ? '⚙️ Generator'
                    : '📄 Generated';
            // Same labelling as the history overlay above. This list is what a
            // reader sees before wiping everything, so it has to identify each
            // guide as precisely as the list they are wiping it from.
            var osName = '';
            if (e.os && typeof window.OS_META === 'object' && window.OS_META &&
                    window.OS_META[e.os]) {
                var om2 = window.OS_META[e.os];
                osName = ' · ' + String(om2.short || om2.label).replace(/[<>&]/g, '');
            }
            var parts = [];
            if (e.md) parts.push('guide');
            if (e.sh) parts.push('script');
            if (e.post) parts.push('post-install');
            if (e.sc) parts.push('config');
            var meta = document.createElement('div');
            meta.className = 'history-meta';
            meta.innerHTML = '<strong>' + (i + 1) + '. ' + src + osName + '</strong>' +
                '<span>' + String(e.timestamp || '').replace(/[<>&]/g, '') +
                (parts.length ? ' · ' + parts.join(', ') : '') + '</span>';
            li.appendChild(meta);
            list.appendChild(li);
        });
        panel.appendChild(list);

        var foot = document.createElement('div');
        foot.className = 'history-foot';

        var dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn';
        dl.textContent = '⬇️ Download all, then clear';
        dl.addEventListener('click', function () {
            entries.forEach(function (e, i) {
                var n = i + 1;
                if (e.md)   downloadText('guide-' + n + '.md', e.md, 'text/markdown');
                if (e.sh)   downloadText('install-' + n + '.sh', e.sh, 'text/x-shellscript');
                if (e.post) downloadText('post-install-' + n + '.sh', e.post, 'text/x-shellscript');
                if (e.sc)   downloadText('config-' + n + '.json', e.sc, 'application/json');
            });
            close();
            wipe();
        });
        foot.appendChild(dl);

        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-ghost';
        go.textContent = 'Clear without downloading';
        go.addEventListener('click', function () { close(); wipe(); });
        foot.appendChild(go);

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-ghost';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', close);
        foot.appendChild(cancel);

        panel.appendChild(foot);
        ov.appendChild(panel);
        document.body.appendChild(ov);
        document.body.style.overflow = 'hidden';

        function onKey(ev) { if (ev.key === 'Escape') close(); }
        function close() {
            ov.remove();
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
        }
        // Clicking the backdrop and pressing Escape both cancel, never clear:
        // the accidental gesture must be the harmless one.
        ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
        document.addEventListener('keydown', onKey);
        cancel.focus();
    }

    window.clearHistoryWithWarning = clearHistoryWithWarning;

    // Exposed so a page can offer its own entry point to the same overlay.
    window.openSharedHistory = openHistoryOverlay;
    /* Exposed so a page that writes to the history can light the clock
       immediately. The *nix Install Walkthrough auto-saves on completion, and
       without this the badge stayed dark until the next page load. */
    window.refreshHistoryBadge = function () { refreshHistoryBadge(); };

    function buildControls() {
        var header = document.querySelector('header');
        if (!header) {
            // live.html, releases.html and repo.html were written without a
            // <header>, which is exactly why they ended up with no navigation
            // and the Live Editor link appeared to vanish on them. Create one
            // rather than bailing, so every page gets the same header.
            header = document.createElement('header');
            document.body.insertBefore(header, document.body.firstChild);
        }

        var bar = document.getElementById('header-controls');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'header-controls';
            bar.className = 'js-only';
            header.insertBefore(bar, header.firstChild);
        }
        var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

        /* Tooltip master toggle, first in the row. tooltip.js owns the
           behaviour; this only guarantees the control exists on pages that
           never declared one. It is the one control that must always be
           reachable, because it is the one that explains all the others. */
        var tt = document.getElementById('toggle-tooltips-btn');
        if (!tt) {
            tt = document.createElement('button');
            tt.id = 'toggle-tooltips-btn';
            tt.type = 'button';
            tt.className = 'ctrl-icon tooltip-always';
            tt.setAttribute('aria-label', 'Toggle tooltips');
            tt.setAttribute('aria-pressed', 'true');
            tt.setAttribute('data-title', 'ℹ️ Tooltips: ON');
            tt.setAttribute('data-desc',
                'Tooltips are ON. Hover on desktop, or tap on mobile, for an ' +
                'explanation of any control. Click to turn them off — this button ' +
                'keeps its own tooltip either way, so you can always find your way back.');
            tt.textContent = 'ℹ️';
        }
        /* Wire it here, not in script.js.

           The behaviour lived in script.js, which only the generator page
           loads, while this file created the button on the other ten. So the
           control that explains every other control was inert everywhere except
           one page — and it is the one control that must always work, because
           turning tooltips off is how you get rid of them and this button keeps
           its own tooltip so you can find your way back.

           Guarded against binding twice: on the generator page script.js still
           attaches its own handler to the same element, and two handlers would
           toggle and untoggle in the same click. */
        if (!tt.hasAttribute('data-tt-wired')) {
            tt.setAttribute('data-tt-wired', '1');
            tt.addEventListener('click', function () {
                var nowOn = window.tooltipsEnabled === false;
                if (typeof window.setTooltipsEnabled === 'function') {
                    window.setTooltipsEnabled(nowOn);
                } else {
                    window.tooltipsEnabled = nowOn;
                    ss(function () { sessionStorage.setItem('tooltips_enabled', String(nowOn)); });
                }
                syncTooltipButton();
            });
        }
        bar.appendChild(tt);
        syncTooltipButton();

        /* Source repository. A drawn octopus rather than the GitHub mark: that
           logo is a trademark, and a pixel one matches the rest of the set. */
        var gh = document.getElementById('repo-link-btn');
        if (!gh) {
            gh = document.createElement('a');
            gh.id = 'repo-link-btn';
            gh.href = REPO_URL;
            gh.target = '_blank';
            gh.rel = 'noopener';
            gh.className = 'ctrl-icon nav-tooltip';
            gh.setAttribute('aria-label', 'Source repository');
            gh.setAttribute('data-title', '🐙 Source repository');
            gh.setAttribute('data-desc',
                'Every page here, every generated script, the Rust security tools and ' +
                'the manual guides, in one public repository. Opens in a new tab.');
            gh.innerHTML = '<img src="img/icons/source-repo-32.png" alt="" ' +
                           'width="22" height="22" class="ctrl-pixel">';
        }
        bar.appendChild(gh);

        /* History, only where the page can actually show it. A button that
           opens nothing is worse than no button. */
        /* Built unconditionally now. It used to be created only when
           `window.toggleHistoryModal` existed, and that function is defined in
           script.js — the generator page and nowhere else. So the clock was
           absent from the walkthrough, the wiki, the index, the cheatsheets and
           the live editor: nine pages out of eleven had no way to reach the
           history at all. The original comment said "a button that opens
           nothing is worse than no button", which was right; the fix is to give
           it something to open everywhere rather than to hide it. */
        var hist = document.getElementById('history-btn');
        if (!hist) {
            hist = document.createElement('button');
            hist.id = 'history-btn';
            hist.type = 'button';
            hist.className = 'ctrl-icon nav-tooltip';
            hist.setAttribute('aria-label', 'Generation history');
            hist.setAttribute('data-title', '🕘 Generation History');
            hist.setAttribute('data-desc',
                'Reload anything you generated in this session. Session-only — no ' +
                'cookies, and it is gone when the tab closes, so export anything you ' +
                'want to keep.');
            hist.textContent = '🕘';
            hist.addEventListener('click', function () {
                // The generator has its own richer modal that can reload an
                // entry straight back into the form. Defer to it there, and use
                // the shared overlay everywhere else.
                if (typeof window.toggleHistoryModal === 'function') window.toggleHistoryModal();
                else openHistoryOverlay();
            });
        }
        if (hist) bar.appendChild(hist);

        /* Fixed left-to-right order, applied after building so it does not
           depend on which controls a page already declared in its own HTML:
           verify-ISO, history, tooltips, repository. The octopus sits furthest
           right, with the tooltip switch immediately to its left. */
        ['iso-verify-btn', 'history-btn', 'toggle-tooltips-btn', 'repo-link-btn']
            .forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.parentNode === bar) bar.appendChild(el);
            });
        buildNav(header);
        buildOsSwitch(header);

        refreshHistoryBadge();

        /* Do not link the page to itself. */
        [].forEach.call(bar.querySelectorAll('a[href]'), function (a) {
            var target = a.getAttribute('href').toLowerCase();
            if (target === here) a.classList.add('ctrl-current');
        });
    }

    /* The verified badge lives on the ISO page itself, not in the navigation.
       A tick in a nav bar has to be explained; a tick next to the Arch mark on
       the page that does the verifying explains itself. It is a status readout,
       lit only after a hash has matched two independent mirrors in this
       session, so it is not something you can tick yourself. */
    function refreshIsoBadge() {
        var badge = document.getElementById('iso-verified-badge');
        if (!badge) return;
        var done = isoVerified();
        badge.classList.toggle('is-verified', done);
        var label = badge.querySelector('.iso-badge-label');
        if (label) {
            label.textContent = done
                ? 'Verified this session'
                : 'Not verified yet';
        }
    }

    /* The switch says which state it is in, in three ways: the class that
       colours it, the pressed state screen readers read, and its own tooltip
       text. Colour alone would not survive being turned off. */
    function syncTooltipButton() {
        var tt = document.getElementById('toggle-tooltips-btn');
        if (!tt) return;
        var on = window.tooltipsEnabled !== false;
        tt.classList.toggle('disabled', !on);
        tt.setAttribute('aria-pressed', String(on));
        tt.setAttribute('data-title', on ? 'ℹ️ Tooltips: ON' : 'ℹ️ Tooltips: OFF');
        tt.setAttribute('data-desc', on
            ? 'Tooltips are ON. Hover on desktop, or tap on mobile, for an explanation ' +
              'of any control. Click to turn them off — this button keeps its own ' +
              'tooltip either way, so you can always find your way back.'
            : 'Tooltips are OFF everywhere else. This button keeps its own tooltip so ' +
              'you can always find your way back. Click to turn them on again.');
    }

    function refreshHistoryBadge() {
        var el = document.getElementById('history-btn');
        if (!el) return;
        var n = historyCount();
        el.classList.toggle('ctrl-unsaved', n > 0 && !historySaved());
        el.setAttribute('data-count', String(n));
    }


    /* ── 2. Do not lose the history by closing the tab ──────────────────── */

    function wireUnloadGuard() {
        window.addEventListener('beforeunload', function (e) {
            if (historyCount() === 0 || historySaved()) return;
            // Browsers show their own wording; the string only has to be
            // non-empty for the prompt to appear at all.
            e.preventDefault();
            e.returnValue = '';
            return '';
        });

        /* Keep the badge honest if another tab or the generator changes it. */
        window.addEventListener('pageshow', refreshHistoryBadge);
        document.addEventListener('arch:history-changed', refreshHistoryBadge);
    }

    /* ── 3. Tooltips, everywhere ────────────────────────────────────────── */

    function ensureTooltips() {
        // tooltip.js binds on DOMContentLoaded. Anything this script injected
        // afterwards needs a rescan, which tooltip.js exposes.
        if (typeof window.refreshTooltips === 'function') {
            window.refreshTooltips();
        } else {
            // tooltip.js may still be loading; try once more on window load.
            window.addEventListener('load', function () {
                if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
            });
        }
    }

    /* ── 4. The footer ──────────────────────────────────────────────────────
       Three separate things, not one. The waiver, the licence and the project
       credits were all inside a single red `.legal-notice` box, copied into ten
       HTML files. That had two problems.

       Visually, the waiver dominated: four paragraphs of red-accented legal text
       with the project's own name, author and navigation tacked on the end of
       it, so the credits read as part of the disclaimer.

       Practically, ten copies drift. The link row still said "Manual" rather
       than "*nix Install Walkthrough" and had never gained the Live Editor or the
       Cheatsheets — the same failure the top nav had before it was moved here.

       So: one definition, three blocks side by side, each with its own accent —
       red for the waiver, green for the licence, purple for the project. */

    var REPO_TREE = REPO_URL + '/blob/main/';

    function buildFooter() {
        var footer = document.querySelector('footer.site-footer, .site-footer');
        if (!footer) {
            footer = document.createElement('footer');
            footer.className = 'site-footer';
            document.body.appendChild(footer);
        }
        // Whatever was here is replaced: the hand-written copies are exactly
        // what drifted.
        footer.innerHTML = '';

        var grid = document.createElement('div');
        grid.className = 'footer-grid';

        /* Waiver. Kept short here on purpose and linked in full — the whole text
           is in the welcome dialog and in user-agreements/, and a wall of it on
           every page trains people to skip it. */
        grid.appendChild(block('footer-waiver', '⚖️', 'Disclaimer & liability waiver', [
            '<p><strong>AI-assisted, no warranty.</strong> This site, its guides and the ' +
            'tools it installs are provided <strong>“as is”</strong>, with no warranty of ' +
            'any kind. No liability is accepted for data loss, system damage, hardware ' +
            'failure or unmitigated security breaches.</p>',
            '<p><strong>Read every generated script before you run it.</strong> They ' +
            'repartition disks, and some options here destroy data deliberately. Test in a ' +
            'virtual machine and cross-check against the ' +
            '<a href="https://wiki.archlinux.org/" target="_blank" rel="noopener">Arch Wiki</a>, ' +
            'which is the authority wherever it and this project disagree.</p>',
            '<p class="footer-fineprint">' +
            '<a href="wiki.html?page=user-agreements/LEGAL-WAIVER.txt" target="_blank" rel="noopener">' +
            'Read the full waiver ↗</a></p>'
        ]));

        /* Licence. Its own block because it answers a different question: not
           "what happens if this breaks" but "what may I do with it". */
        grid.appendChild(block('footer-licence', '📄', 'Licence', [
            '<p>Licensed <strong>CC BY-NC-SA 4.0</strong>. Read it, use it, fork it, mirror ' +
            'it, teach from it — no permission needed.</p>',
            '<p>Three conditions: keep the credit, do not sell it, and share anything you ' +
            'build from it under the same licence. That is all the licence is for.</p>',
            '<p class="footer-fineprint">' +
            '<a href="wiki.html?page=user-agreements/LICENSE.txt" target="_blank" rel="noopener">Full text ↗</a> · ' +
            '<a href="wiki.html?page=user-agreements/LICENCE-PLAIN-ENGLISH.txt" target="_blank" rel="noopener">' +
            'In plain English ↗</a></p>'
        ]));

        /* Project, navigation and credit. Built from the same NAV array as the
           header, so this row can no longer fall behind it. */
        var links = NAV.map(function (item) {
            return '<a href="' + item.href + '">' + item.label + '</a>';
        }).join('');

        grid.appendChild(block('footer-project', '🦀', '*nix Install Guides', [
            '<p>by <a href="https://github.com/tilas01" target="_blank" rel="noopener">tilas01</a>' +
            ' · <a href="' + REPO_URL + '" target="_blank" rel="noopener">Source</a>' +
            ' · <a href="' + REPO_URL + '/releases" target="_blank" rel="noopener">Releases</a>' +
            ' · <a href="' + REPO_TREE + 'tilas01.asc" target="_blank" rel="noopener">Signing key</a></p>',
            // Reachable from every page, deliberately. The security audit says in
            // its own words what it did not cover; an invitation to report what it
            // missed only works if it is somewhere you actually are.
            '<p class="footer-report">🐞 <strong>Found a bug, or something that is wrong?</strong> ' +
            '<a href="' + REPO_URL + '/issues/new" target="_blank" rel="noopener">Open an issue</a>' +
            ' — including where this and the ' +
            '<a href="https://wiki.archlinux.org/" target="_blank" rel="noopener">Arch Wiki</a> ' +
            'disagree, because the Arch Wiki is right and this is the bug.</p>',
            '<nav class="footer-links" aria-label="All pages">' + links + '</nav>',
            '<p class="footer-credits"><strong>Standing on other people\'s work:</strong> ' +
            '<a href="https://wiki.archlinux.org/" target="_blank" rel="noopener">the Arch Wiki</a>, ' +
            'which is the source this project defers to; ' +
            '<a href="https://github.com/dusklinux/dusky" target="_blank" rel="noopener">dusklinux</a> ' +
            'for Dusky and its wallpapers; ' +
            '<a href="https://github.com/max-baz/arch-secure-boot" target="_blank" rel="noopener">' +
            'max-baz/arch-secure-boot</a> for signed unified kernel images and snapshot recovery; ' +
            'and <a href="https://github.com/tilas01/arch-guides-all" target="_blank" rel="noopener">' +
            'arch-guides-all</a>, the far simpler predecessor that is somehow still the most ' +
            'popular thing here — all eight stars of it. Built with AI assistance from ' +
            '<strong>Claude</strong>, and reviewed by tilas01.</p>'
        ]));

        footer.appendChild(grid);
    }

    function block(cls, icon, heading, paras) {
        var el = document.createElement('section');
        el.className = 'footer-block ' + cls;
        el.innerHTML = '<h2><span aria-hidden="true">' + icon + '</span> ' + heading + '</h2>' +
                       paras.join('');
        return el;
    }

    function init() {
        try { buildControls(); } catch (err) { console.error('shared-ui: controls', err); }
        try { buildFooter(); } catch (err) { console.error('shared-ui: footer', err); }
        // After the footer, so its copy of the navigation gets relabelled too.
        try { applyOsIdentity(); } catch (err) { console.error('shared-ui: os identity', err); }
        document.addEventListener('unix:os-changed', function () {
            try { applyOsIdentity(); } catch (err) { console.error('shared-ui: os identity', err); }
        });
        try { refreshIsoBadge(); } catch (err) { console.error('shared-ui: iso badge', err); }
        try { wireUnloadGuard(); } catch (err) { console.error('shared-ui: unload', err); }
        try { ensureTooltips(); } catch (err) { console.error('shared-ui: tooltips', err); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
