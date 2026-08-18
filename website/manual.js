/* ============================================================================
   manual.js — the manual install walkthrough.
   ----------------------------------------------------------------------------
   Renders the question set in manual-data.js one step at a time, and builds a
   guide as you answer. Nothing here knows anything about Arch: it draws
   questions, collects answers, and asks the emitters for commands. Adding an
   option is a change to manual-data.js alone.

   Parity with the dynamic generator is the point. Same options, same locking
   rules, same validation, and the same three exports — markdown, bash and JSON
   — so a walkthrough and a generated script describe the same install.
   ========================================================================= */

'use strict';

(function () {

    /* ── State ──────────────────────────────────────────────────────────── */

    var state = {};
    var visited = [];            // ids answered, in order
    var STORAGE_KEY = 'arch_manual_state';

    function save() {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ state: state, visited: visited })); }
        catch (_) { /* private mode; the walkthrough still works, it just will not resume */ }
    }
    function restore() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.state !== 'object') return false;
            state = parsed.state;
            visited = Array.isArray(parsed.visited) ? parsed.visited : [];
            return visited.length > 0;
        } catch (_) { return false; }
    }

    /* ── Step selection ─────────────────────────────────────────────────── */

    function applies(step) {
        if (typeof step.when !== 'function') return true;
        try { return !!step.when(state); } catch (_) { return false; }
    }

    /** Steps that currently apply, in declaration order. */
    function activeSteps() {
        return STEPS.filter(applies);
    }

    /** Options within a step can have their own `when` too. */
    function activeOptions(step) {
        return (step.options || []).filter(function (o) {
            if (typeof o.when !== 'function') return true;
            try { return !!o.when(state); } catch (_) { return false; }
        });
    }

    /** Value something else has already decided for this question, or null.
     *
     *  Two sources, and the system wins. A locked architecture on Raspberry Pi
     *  OS is a fact about the hardware; a value Dusky fixes is a consequence of
     *  a choice the reader made and could unmake. If they ever collide, the one
     *  that cannot be unmade has to hold. */
    function lockedValue(step) {
        var osLocks = (typeof OS_LOCKS !== 'undefined')
            ? OS_LOCKS[window.osIdOf(state.os)] : null;
        if (osLocks && Object.prototype.hasOwnProperty.call(osLocks, step.id)) {
            return osLocks[step.id];
        }
        if (state.desktop !== 'dusky') return null;
        return Object.prototype.hasOwnProperty.call(DUSKY_LOCKS, step.id)
            ? DUSKY_LOCKS[step.id] : null;
    }

    /** What to name as the thing that fixed it, for the notice on the card. */
    function lockSource(step) {
        var osLocks = (typeof OS_LOCKS !== 'undefined')
            ? OS_LOCKS[window.osIdOf(state.os)] : null;
        if (osLocks && Object.prototype.hasOwnProperty.call(osLocks, step.id)) {
            return window.osMetaOf(state.os).label;
        }
        return 'Dusky';
    }

    /** A question's text field, which may be a plain string or a function of
     *  the answers so far. Anything that throws falls back to empty rather than
     *  taking the whole question down with it. */
    function resolve(field) {
        if (typeof field !== 'function') return field || '';
        try { return field(state) || ''; } catch (_) { return ''; }
    }

    /** Human label for a value, for use in prose. Falls back to the raw value. */
    function optionLabel(step, value) {
        var opts = step.options || [];
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === value) return opts[i].label;
        }
        return String(value);
    }

    /* Whether a question has been dealt with.

       One definition, because there were three and they disagreed. An optional
       question that was shown and deliberately left blank is answered, and the
       key existing in `state` is the record of that decision — judging it by
       its value instead reads "no, nothing" as "not yet". That is what made
       "Anything else?" impossible to pass: the walkthrough re-rendered the same
       question, and the only way onwards was to invent a package to install. */
    function isAnswered(s) {
        var v = state[s.id];
        if (s.type === 'multi') return Array.isArray(v);
        if (s.optional) return Object.prototype.hasOwnProperty.call(state, s.id);
        return v !== undefined && v !== null && v !== '';
    }

    function nextUnanswered() {
        var steps = activeSteps();
        for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            if (!isAnswered(s)) return s;
        }
        return null;
    }

    /* ── Rendering ──────────────────────────────────────────────────────── */

    function h(tag, attrs, children) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'class') el.className = attrs[k];
            else if (k === 'text') el.textContent = attrs[k];
            else if (k === 'html') el.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (c) { if (c) el.appendChild(c); });
        return el;
    }

    function optionCard(step, opt, locked) {
        var isMulti = step.type === 'multi';
        var current = state[step.id];
        var selected = isMulti
            ? (Array.isArray(current) && current.indexOf(opt.value) !== -1)
            : current === opt.value;

        var badges = [];
        if (opt.recommended) badges.push(h('span', { class: 'badge badge-rec', text: 'recommended' }));
        if (opt.danger) badges.push(h('span', { class: 'badge badge-danger', text: 'destructive' }));

        var card = h('button', {
            type: 'button',
            class: 'opt-card nav-tooltip' + (selected ? ' selected' : '') + (locked ? ' locked' : ''),
            'aria-pressed': String(selected),
            'data-title': opt.label,
            'data-desc': opt.desc + (opt.note ? ' — ' + opt.note : ''),
            disabled: locked ? 'disabled' : null
        }, [
            h('span', { class: 'opt-head' }, [
                h('span', { class: 'opt-label', text: opt.label })
            ].concat(badges)),
            h('span', { class: 'opt-desc', text: opt.desc }),
            opt.note ? h('span', { class: 'opt-note', text: '⚠ ' + opt.note }) : null,
            opt.danger ? h('span', { class: 'opt-danger', text: '🔴 ' + opt.danger }) : null
        ]);

        if (!locked) {
            card.addEventListener('click', function () {
                if (isMulti) {
                    var arr = Array.isArray(state[step.id]) ? state[step.id].slice() : [];
                    var at = arr.indexOf(opt.value);
                    if (at === -1) arr.push(opt.value); else arr.splice(at, 1);
                    state[step.id] = arr;
                    renderStep(step);          // multi stays put so you can keep picking
                    rebuildGuide();
                    save();
                } else {
                    answer(step, opt.value);
                }
            });
        }
        return card;
    }

    /* "How do I find out?" — a collapsible block with the command to run, how to
       read its output, and what the device names mean. The disk question used to
       say "run lsblk" and stop there, which is no help if you have not read
       lsblk output before or do not know why the partition suffix has a `p` in it
       on one machine and not another. Right-clicking it opens the wiki section,
       the same as every other control on the page. */
    function buildHowto(step) {
        var ht = step.howto;
        var box = h('details', { class: 'q-howto nav-tooltip',
            'data-title': '🔍 How to find this',
            'data-desc': 'The command to run, how to read what it prints, and what each ' +
                         'device name means. Right-click for the full wiki section.' });
        box.appendChild(h('summary', { text: '🔍 How do I find this out?' }));

        if (ht.intro) box.appendChild(h('p', { class: 'q-howto-p', text: ht.intro }));

        if (ht.command) {
            var pre = h('pre', { class: 'q-howto-cmd' });
            var code = h('code', { class: 'language-bash', text: ht.command });
            pre.appendChild(code);
            box.appendChild(pre);
            box.appendChild(h('button', {
                type: 'button', class: 'btn btn-ghost q-howto-copy',
                text: '📋 Copy',
                onclick: function (e) { copyText(ht.command, e.target); }
            }));
        }

        if (ht.reading) box.appendChild(h('p', { class: 'q-howto-p', text: ht.reading }));

        if (Array.isArray(ht.naming) && ht.naming.length) {
            var dl = h('dl', { class: 'q-howto-naming' });
            ht.naming.forEach(function (pair) {
                dl.appendChild(h('dt', { text: pair[0] }));
                dl.appendChild(h('dd', { text: pair[1] }));
            });
            box.appendChild(dl);
        }

        if (ht.warn) {
            box.appendChild(h('p', { class: 'q-howto-warn', text: '⚠ ' + ht.warn }));
        }

        if (step.wiki) {
            box.appendChild(h('a', {
                class: 'q-howto-wiki', href: 'wiki.html#' + step.wiki,
                target: '_blank', rel: 'noopener',
                text: '📖 Read this in the wiki →'
            }));
        }
        return box;
    }

    /** Copy to clipboard, with a visible confirmation and a fallback. */
    function copyText(text, btn) {
        function done(okFlag) {
            if (!btn) return;
            var was = btn.textContent;
            btn.textContent = okFlag ? '✅ Copied' : '⚠ Press Ctrl+C';
            setTimeout(function () { btn.textContent = was; }, 1600);
        }
        // navigator.clipboard needs a secure context; file:// and plain http do
        // not qualify, and this site has to work from a live USB.
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function () { done(true); },
                                                     function () { fallback(); });
        } else {
            fallback();
        }
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

    function renderStep(step) {
        var host = document.getElementById('question-host');
        host.innerHTML = '';
        if (!step) { renderDone(); return; }

        var locked = lockedValue(step);
        if (locked !== null && state[step.id] !== locked) {
            state[step.id] = locked;
        }

        var steps = activeSteps();
        var idx = steps.indexOf(step) + 1;

        var card = h('div', { class: 'q-card', id: 'q-' + step.id }, [
            h('div', { class: 'q-meta' }, [
                h('span', { class: 'q-section', text: step.section }),
                h('span', { class: 'q-count', text: 'Question ' + idx + ' of ' + steps.length })
            ]),
            h('h2', { class: 'q-title' }, [
                document.createTextNode(step.title),
                h('a', {
                    class: 'q-wiki nav-tooltip',
                    href: 'wiki.html#' + step.wiki,
                    target: '_blank',
                    rel: 'noopener',
                    'data-title': 'Read this in the wiki',
                    'data-desc': 'Opens the wiki section that explains this option in full, ' +
                                 'in a new tab. Right-clicking any control here does the same.',
                    text: '📖'
                })
            ]),
            /* `help` and `note` may be strings or functions of the answers so
               far. A function lets a question explain something that depends on
               the target system — most usefully, why an option the reader might
               expect is not on the list.

               `note` was declared on several questions and rendered nowhere, so
               the OS question's "skipping this selects Arch" never appeared on
               screen. A data field with no renderer is the small version of
               this repository's usual defect. */
            h('p', { class: 'q-help', text: resolve(step.help) }),
            step.note ? h('p', { class: 'q-note', text: resolve(step.note) }) : null
        ]);

        if (locked !== null) {
            card.appendChild(h('div', { class: 'q-locked' }, [
                h('strong', { text: '🔒 Fixed by ' + lockSource(step) + ': ' +
                                    optionLabel(step, locked) + '. ' }),
                document.createTextNode(lockSource(step) === 'Dusky'
                    ? 'Dusky ships this preconfigured, so the walkthrough will not fight it — ' +
                      'it is carried through to your guide and script as it stands. ' +
                      'Continue below, or go back and choose a different desktop to decide ' +
                      'this yourself.'
                    // A system lock is not a preference and cannot be undone by
                    // going back a question, so it does not offer to.
                    : 'This is decided by the system you selected, not by anything you can ' +
                      'change here — no other answer would produce a system that works. ' +
                      'It is carried through to your guide and script. Change the system ' +
                      'in the top-left corner if you meant a different one.')
            ]));
        }

        // Every card is inert while the step is locked — the value is not yours
        // to pick here. The locked one still renders, and renders as selected,
        // so you can see what Dusky chose rather than just being told a number
        // of options are unavailable.
        var grid = h('div', { class: 'opt-grid' });
        activeOptions(step).forEach(function (o) {
            grid.appendChild(optionCard(step, o, locked !== null));
        });

        if (step.type === 'text') {
            var input = h('input', {
                type: 'text',
                class: 'q-text',
                id: 'input-' + step.id,
                placeholder: step.placeholder || '',
                value: state[step.id] || '',
                spellcheck: 'false',
                autocomplete: 'off',
                'aria-describedby': 'err-' + step.id
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); submitText(step, input.value); }
            });
            card.appendChild(input);

            /* A value the page can work out for itself, offered as one click.
               Currently the time zone: typing "America/Argentina/Buenos_Aires"
               by hand on a phone is how people end up with the wrong clock. It
               fills the field rather than submitting, so it stays a suggestion
               you can edit. */
            if (typeof step.suggest === 'function') {
                var sug = null;
                try { sug = step.suggest(state); } catch (_) { sug = null; }
                if (sug && sug.value) {
                    card.appendChild(h('button', {
                        type: 'button', class: 'btn q-suggest nav-tooltip',
                        'data-title': sug.label,
                        'data-desc': 'Fills the box with ' + sug.value +
                                     (sug.note ? ', ' + sug.note : '') +
                                     '. You can still change it — a machine is not always ' +
                                     'installed in the same place it is set up.',
                        html: '✨ ' + sug.label +
                              (sug.note ? ' <span class="q-suggest-note">' + sug.note + '</span>' : ''),
                        onclick: function () {
                            input.value = sug.value;
                            input.focus();
                        }
                    }));
                }
            }

            /* Live package search, for steps that ask for package names. Guarded
               on PkgSearch being present so the field degrades to a plain text
               box if the script did not load, rather than throwing here and
               taking the rest of the question's rendering with it. */
            if (step.search === 'packages' && window.PkgSearch) {
                try {
                    window.PkgSearch.attach(input, { mount: card });
                } catch (_) { /* the field alone is still usable */ }
            }

            card.appendChild(h('div', { class: 'q-error', id: 'err-' + step.id, hidden: 'hidden' }));
            card.appendChild(h('button', {
                type: 'button', class: 'btn q-next', text: 'Continue →',
                onclick: function () { submitText(step, input.value); }
            }));

            // How to find the answer, for the questions where "just type it" is
            // not enough. Rendered after the input so it does not push the field
            // off a phone screen.
            if (step.howto) card.appendChild(buildHowto(step));
        } else {
            card.appendChild(grid);
            card.appendChild(h('div', { class: 'q-error', id: 'err-' + step.id, hidden: 'hidden' }));
            if (locked !== null) {
                // A locked step has nothing left to click, and a choice step
                // advances only by clicking an option — so without this the
                // walkthrough dead-ends here with Back as the only control.
                // That is exactly what picking Dusky used to do at "Display
                // server". The button carries the fixed value forward.
                card.appendChild(h('button', {
                    type: 'button', class: 'btn q-next',
                    text: 'Continue with ' + optionLabel(step, locked) + ' →',
                    onclick: function () { answer(step, locked); }
                }));
            } else if (step.type === 'multi') {
                card.appendChild(h('button', {
                    type: 'button', class: 'btn q-next', text: 'Continue →',
                    onclick: function () { submitMulti(step); }
                }));
            }
        }

        var nav = h('div', { class: 'q-nav' });
        if (visited.length) {
            nav.appendChild(h('button', {
                type: 'button', class: 'btn btn-ghost', text: '← Back',
                onclick: goBack
            }));
        }
        card.appendChild(nav);

        host.appendChild(card);
        requestAnimationFrame(function () { card.classList.add('q-in'); });

        if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
        // .q-next last: on a locked step every option card is disabled, so
        // without it nothing here is focusable and keyboard users land nowhere.
        var focusTarget = card.querySelector('.q-text, .opt-card:not([disabled]), .q-next');
        if (focusTarget) focusTarget.focus({ preventScroll: true });
        updateProgress();
    }

    function showError(step, message) {
        var box = document.getElementById('err-' + step.id);
        if (!box) return;
        box.hidden = false;
        box.innerHTML = '';
        box.appendChild(h('span', { text: '⚠ ' + message + ' ' }));
        box.appendChild(h('a', {
            href: 'wiki.html#' + step.wiki, target: '_blank', rel: 'noopener',
            text: 'What does this mean? →'
        }));
        var card = document.getElementById('q-' + step.id);
        if (card) {
            card.classList.add('q-invalid');
            setTimeout(function () { card.classList.remove('q-invalid'); }, 600);
        }
    }

    function submitText(step, raw) {
        var value = String(raw || '').trim();
        /* An optional text question may be left blank. submitMulti has always
           honoured `optional` and this did not, so every question declared
           optional and rendered as a text box was in fact compulsory —
           "Anything else?" could not be answered with nothing, and the only way
           past it was to invent a package to install.

           Validation is skipped for a blank optional answer on purpose: a
           validator exists to judge a value, and there is no value here. Running
           it would reject the empty string on behalf of a question that just
           said empty was fine. */
        if (!value) {
            if (step.optional) return answer(step, '');
            return showError(step, 'This one needs an answer.');
        }
        if (step.validate) {
            var msg = step.validate(value, state);
            if (msg) return showError(step, msg);
        }
        answer(step, value);
    }

    function submitMulti(step) {
        var value = Array.isArray(state[step.id]) ? state[step.id] : [];
        if (step.validate) {
            var msg = step.validate(value, state);
            if (msg) return showError(step, msg);
        }
        if (!value.length && !step.optional) {
            return showError(step, 'Pick at least one, or this question would not be here.');
        }
        state[step.id] = value;
        advance(step);
    }

    function answer(step, value) {
        state[step.id] = value;
        // The header switcher and this question are two views of one choice.
        // Publishing it here is what stops them disagreeing; the listener below
        // handles the other direction. setTargetOS fires synchronously and the
        // listener sees the value already set, so this does not loop.
        if (step.id === 'os' && typeof window.setTargetOS === 'function') {
            window.setTargetOS(value);
        }
        advance(step);
    }

    function advance(step) {
        if (visited.indexOf(step.id) === -1) visited.push(step.id);
        // Choosing a desktop can lock later questions; clear anything that is
        // no longer reachable so a stale answer cannot leak into the output.
        pruneUnreachable();
        rebuildGuide();
        save();
        renderStep(nextUnanswered());
    }

    function pruneUnreachable() {
        var live = {};
        activeSteps().forEach(function (s) { live[s.id] = true; });
        Object.keys(state).forEach(function (k) {
            if (!live[k]) {
                delete state[k];
                var at = visited.indexOf(k);
                if (at !== -1) visited.splice(at, 1);
            }
        });
    }

    function goBack() {
        var last = visited.pop();
        if (last === undefined) return;
        delete state[last];
        // Un-answering the OS question has to un-answer it in the header too,
        // or the corner keeps naming a system the guide is no longer built for.
        if (last === 'os' && typeof window.clearTargetOS === 'function') {
            window.clearTargetOS();
        }
        pruneUnreachable();
        rebuildGuide();
        save();
        var step = null;
        for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === last) step = STEPS[i];
        renderStep(applies(step) ? step : nextUnanswered());
    }

    function updateProgress() {
        var steps = activeSteps();
        var done = steps.filter(isAnswered).length;
        var pct = steps.length ? (done / steps.length) * 100 : 0;
        var bar = document.getElementById('manual-progress');
        if (bar) {
            bar.style.width = pct.toFixed(1) + '%';
            bar.setAttribute('aria-valuenow', pct.toFixed(0));
        }
        var label = document.getElementById('manual-progress-text');
        if (label) label.textContent = done + ' of ' + steps.length + ' answered';
    }

    /* ── Auto-save a finished walkthrough to the session history ─────────────
       Answering thirty-one questions and then losing the result to a closed tab
       is the worst outcome this page has. The generator has always written to
       the history; the walkthrough never did, so its output only existed if you
       remembered to press a download button.

       Keyed on the answers, not on "have we saved yet": going Back, changing one
       thing and finishing again is a *different* guide and deserves its own
       entry, but re-rendering the done screen (which happens on every mode
       toggle and every tooltip refresh) must not add a duplicate. */
    var HISTORY_KEY = 'arch_gen_history';
    var HISTORY_LIMIT = 10;
    var lastSavedSignature = null;

    function saveCompletedToHistory() {
        var signature;
        try { signature = JSON.stringify(state); } catch (_) { return; }
        if (signature === lastSavedSignature) return;

        var entries;
        try {
            var raw = sessionStorage.getItem(HISTORY_KEY);
            entries = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(entries)) entries = [];
        } catch (_) { entries = []; }

        // An identical config already at the top is the same guide — do not
        // stack copies of it just because the page re-rendered.
        if (entries.length && entries[0] && entries[0].signature === signature) {
            lastSavedSignature = signature;
            return;
        }

        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };

        try {
            entries.unshift({
                timestamp: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
                           pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' +
                           pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
                // The shared history overlay and the live editor both label
                // entries by this.
                source: 'manual-walkthrough',
                /* Which system this guide is for. Two entries made minutes
                   apart for different systems are otherwise identical in the
                   list, and the one restored decides which commands get run. */
                os: (state.os || (typeof window.targetOS === 'function' ? window.targetOS() : 'arch')),
                format: 'unified',
                md: window.buildManualGuide(state),
                sh: window.buildManualScript(state),
                post: '',
                sc: JSON.stringify({
                    schema: 'unix-sit/config',
                    version: 2,
                    created: now.toISOString(),
                    source: 'manual-walkthrough',
                    answers: state
                }, null, 2),
                signature: signature
            });
            sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
            lastSavedSignature = signature;
        } catch (_) {
            // Quota, or private mode. The guide is still on screen and still
            // downloadable; losing the history entry is not worth an error.
            return;
        }

        // A saved-but-not-exported history is exactly what the close warning is
        // for, so make sure it fires. refreshHistoryBadge lights the clock.
        try { sessionStorage.setItem('arch_gen_history_saved', '0'); } catch (_) { /* ignore */ }
        if (typeof window.refreshHistoryBadge === 'function') window.refreshHistoryBadge();
    }

    function renderDone() {
        // Save before painting: if anything below throws, the work is already
        // recorded.
        saveCompletedToHistory();

        var host = document.getElementById('question-host');
        host.innerHTML = '';
        host.appendChild(h('div', { class: 'q-card q-done q-in' }, [
            h('h2', { class: 'q-title', text: '✅ That is everything.' }),
            h('p', {
                class: 'q-help',
                text: 'Your guide is below, with every command in order and a ' +
                      'reason for each one. Read it before you run any of it — ' +
                      'especially the partitioning, which is aimed at ' +
                      (state.disk || 'your disk') + ' and does not ask twice.'
            }),
            h('div', { class: 'q-nav' }, [
                h('button', { type: 'button', class: 'btn btn-ghost', text: '← Change an answer', onclick: goBack }),
                h('button', { type: 'button', class: 'btn', text: '↺ Start over', onclick: resetAll })
            ])
        ]));
        updateProgress();
    }

    function resetAll() {
        if (!confirm('Clear every answer and start the walkthrough again?')) return;
        state = {};
        visited = [];
        if (typeof window.clearTargetOS === 'function') window.clearTargetOS();
        save();
        rebuildGuide();
        renderStep(activeSteps()[0]);
    }

    /* ── Guide construction ─────────────────────────────────────────────── */

    function rebuildGuide() {
        var md = window.buildManualGuide(state);
        var out = document.getElementById('guide-out');
        if (!out) return;
        // Re-highlighted on every answer, so the done-marker has to be cleared
        // each time — plain highlightElement() would colour the first render
        // and then leave every later one plain. Falls back to unhighlighted
        // text if highlight.js did not load; the guide is still correct, just
        // monochrome.
        if (window.setHighlightedCode) window.setHighlightedCode(out, md, 'markdown');
        else out.textContent = md;
        // Command mode reads the same guide, so it has to be rebuilt with it —
        // otherwise the commands stay behind the answers.
        if (cmdMode) renderCommandMode();
        var empty = document.getElementById('guide-empty');
        if (empty) empty.hidden = visited.length > 0 || cmdMode;
        var wrap = document.getElementById('guide-wrap');
        if (wrap) wrap.hidden = visited.length === 0 || cmdMode;
    }

    /* ── Command-by-command mode ────────────────────────────────────────────
       One command at a time, with what to expect from it, so the walkthrough can
       be followed with a terminal open beside it instead of scrolling a document
       and losing your place.

       The steps come from window.buildCommandSteps(), which *parses the guide*
       rather than emitting commands separately. A second emitter would be a
       second source of truth and the two would drift; this way command mode is
       by construction exactly what the guide says.

       Anything destructive is gated behind typing the disk path. Not a
       decoration: sgdisk and luksFormat do not ask, and the whole reason people
       lose data here is muscle-memory clicking through a confirmation. Typing
       the target back means you have looked at it at least once. */

    var cmdMode = false;
    var cmdIndex = 0;
    var CMD_DONE_KEY = 'arch_manual_cmd_done';

    function cmdDone() {
        try { return JSON.parse(sessionStorage.getItem(CMD_DONE_KEY)) || {}; }
        catch (_) { return {}; }
    }
    function markCmdDone(n) {
        var d = cmdDone();
        d[n] = true;
        try { sessionStorage.setItem(CMD_DONE_KEY, JSON.stringify(d)); } catch (_) { /* private mode */ }
    }

    function setMode(useCommands) {
        cmdMode = !!useCommands;
        var gWrap = document.getElementById('guide-wrap');
        var gEmpty = document.getElementById('guide-empty');
        var cHost = document.getElementById('command-mode');
        var heading = document.getElementById('guide-heading');
        var bg = document.getElementById('mode-guide');
        var bc = document.getElementById('mode-commands');
        if (!cHost) return;

        if (bg) { bg.classList.toggle('active', !cmdMode); bg.setAttribute('aria-pressed', String(!cmdMode)); }
        if (bc) { bc.classList.toggle('active', cmdMode); bc.setAttribute('aria-pressed', String(cmdMode)); }
        if (heading) heading.textContent = cmdMode ? '▶️ Run it, one command at a time'
                                                  : '📄 Your guide, so far';

        cHost.hidden = !cmdMode;
        if (gWrap) gWrap.hidden = cmdMode || visited.length === 0;
        if (gEmpty) gEmpty.hidden = cmdMode || visited.length > 0;

        if (cmdMode) renderCommandMode();
    }

    function renderCommandMode() {
        var host = document.getElementById('command-mode');
        if (!host) return;
        host.innerHTML = '';

        if (typeof window.buildCommandSteps !== 'function') {
            host.appendChild(h('p', { class: 'q-help',
                text: 'Command mode needs manual-guide.js, which did not load.' }));
            return;
        }

        var steps;
        try { steps = window.buildCommandSteps(window.buildManualGuide(state)); }
        catch (_) { steps = []; }

        if (!steps.length) {
            host.appendChild(h('p', { class: 'q-help',
                text: 'Answer a few more questions and the commands will appear here, ' +
                      'one at a time, in the order you run them.' }));
            return;
        }

        if (cmdIndex >= steps.length) cmdIndex = steps.length - 1;
        if (cmdIndex < 0) cmdIndex = 0;
        var step = steps[cmdIndex];
        var done = cmdDone();

        host.appendChild(h('div', { class: 'cmd-progress' }, [
            h('span', { text: 'Command ' + step.n + ' of ' + steps.length }),
            h('span', { class: 'cmd-progress-title', text: step.title })
        ]));

        var card = h('div', { class: 'cmd-card' + (step.destructive ? ' cmd-danger' : '') });

        if (step.destructive) {
            card.appendChild(h('div', { class: 'cmd-warn' }, [
                h('strong', { text: '🔴 This destroys data and does not ask. ' }),
                document.createTextNode('It is aimed at ' + (state.disk || 'your disk') +
                    '. Check that is the right device before you run it — the disk you ' +
                    'want is identified by size and model, not by the name you expect.')
            ]));
        }

        if (step.why) card.appendChild(h('p', { class: 'cmd-why', text: step.why }));

        var pre = h('pre', { class: 'cmd-block' });
        pre.appendChild(h('code', { class: 'language-bash', text: step.commands }));
        card.appendChild(pre);

        var actions = h('div', { class: 'cmd-actions' });
        actions.appendChild(h('button', {
            type: 'button', class: 'btn nav-tooltip',
            'data-title': 'Copy this command',
            'data-desc': 'Copies exactly what is shown, comments included, so the reason ' +
                         'travels with it into your shell history.',
            text: '📋 Copy',
            onclick: function (e) { copyText(step.commands, e.target); }
        }));
        card.appendChild(actions);

        if (step.expected) {
            card.appendChild(h('div', { class: 'cmd-expected' }, [
                h('strong', { text: 'Expect: ' }),
                document.createTextNode(step.expected)
            ]));
        }

        var err = h('div', { class: 'q-error', id: 'cmd-err', hidden: 'hidden' });
        card.appendChild(err);

        // The confirmation gate, for destructive steps only.
        var confirmInput = null;
        if (step.destructive && state.disk) {
            card.appendChild(h('label', { class: 'cmd-confirm-label',
                for: 'cmd-confirm',
                text: 'Type ' + state.disk + ' to confirm you have checked the device:' }));
            confirmInput = h('input', {
                type: 'text', class: 'q-text', id: 'cmd-confirm',
                placeholder: state.disk, spellcheck: 'false', autocomplete: 'off'
            });
            card.appendChild(confirmInput);
        }

        var nav = h('div', { class: 'cmd-nav' });
        if (cmdIndex > 0) {
            nav.appendChild(h('button', {
                type: 'button', class: 'btn btn-ghost', text: '← Previous',
                onclick: function () { cmdIndex--; renderCommandMode(); }
            }));
        }

        var last = cmdIndex === steps.length - 1;
        nav.appendChild(h('button', {
            type: 'button', class: 'btn cmd-next',
            text: done[step.n] ? (last ? '✅ Finished' : 'Next →')
                               : (last ? '✅ Ran it — finish' : '✅ Ran it — next'),
            onclick: function () {
                if (confirmInput && confirmInput.value.trim() !== state.disk) {
                    err.hidden = false;
                    err.textContent = '⚠ Type ' + state.disk + ' exactly. This one cannot be undone.';
                    confirmInput.focus();
                    return;
                }
                markCmdDone(step.n);
                if (!last) { cmdIndex++; renderCommandMode(); }
                else renderCommandMode();
            }
        }));
        card.appendChild(nav);

        if (last && done[step.n]) {
            card.appendChild(h('p', { class: 'cmd-finished',
                text: 'That is every command. Keep the markdown guide — the post-install ' +
                      'steps and the reasoning are in it.' }));
        }

        host.appendChild(card);

        // A jump list, so you can get back to where you were after a reboot.
        var list = h('ol', { class: 'cmd-list' });
        steps.forEach(function (st, i) {
            var li = h('li', { class: (i === cmdIndex ? 'here ' : '') + (done[st.n] ? 'done' : '') });
            li.appendChild(h('button', {
                type: 'button',
                class: 'cmd-list-btn' + (st.destructive ? ' danger' : ''),
                text: (done[st.n] ? '✓ ' : '') + st.n + '. ' + st.title,
                onclick: function () { cmdIndex = i; renderCommandMode(); }
            }));
            list.appendChild(li);
        });
        host.appendChild(h('details', { class: 'cmd-jump' }, [
            h('summary', { text: '🧭 All ' + steps.length + ' commands' }),
            list
        ]));

        if (typeof window.highlightAll === 'function') window.highlightAll(host);
        if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
    }

    function wireModeButtons() {
        var bg = document.getElementById('mode-guide');
        var bc = document.getElementById('mode-commands');
        if (bg) bg.addEventListener('click', function () { setMode(false); });
        if (bc) bc.addEventListener('click', function () { setMode(true); });
    }

    function download(name, text, mime) {
        var blob = new Blob([text], { type: mime + ';charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        if (typeof window.markHistorySaved === 'function') window.markHistorySaved();
    }

    function wireExports() {
        var md = document.getElementById('dl-md');
        var sh = document.getElementById('dl-sh');
        var js = document.getElementById('dl-json');
        var cp = document.getElementById('copy-guide');
        var live = document.getElementById('open-live');

        if (md) md.addEventListener('click', function () {
            download('arch-manual-guide.md', window.buildManualGuide(state), 'text/markdown');
        });
        if (sh) sh.addEventListener('click', function () {
            download('arch-manual-install.sh', window.buildManualScript(state), 'text/x-shellscript');
        });
        if (js) js.addEventListener('click', function () {
            // JSON, not the old .sc format: it is a real, documented, diffable
            // interchange format that any tool can read, and the generator
            // accepts the same file.
            download('arch-config.json', JSON.stringify({
                schema: 'unix-sit/config',
                version: 2,
                created: new Date().toISOString(),
                source: 'manual-walkthrough',
                answers: state
            }, null, 2), 'application/json');
        });
        if (cp) cp.addEventListener('click', function () {
            navigator.clipboard.writeText(window.buildManualGuide(state)).then(function () {
                cp.textContent = '✅ Copied';
                setTimeout(function () { cp.textContent = '📋 Copy guide'; }, 1500);
            }, function () {
                cp.textContent = '❌ Clipboard blocked';
                setTimeout(function () { cp.textContent = '📋 Copy guide'; }, 2000);
            });
        });
        if (live) live.addEventListener('click', function () {
            try {
                sessionStorage.setItem('live_md', window.buildManualGuide(state));
                sessionStorage.setItem('live_sh', window.buildManualScript(state));
            } catch (_) { /* nothing to do; the editor will show its empty state */ }
            window.open('live.html', '_blank', 'noopener');
        });

        var imp = document.getElementById('import-json');
        if (imp) imp.addEventListener('change', function () {
            var f = imp.files && imp.files[0];
            if (!f) return;
            var r = new FileReader();
            r.onload = function () {
                try {
                    var parsed = JSON.parse(String(r.result));
                    var answers = parsed && parsed.answers ? parsed.answers : parsed;
                    if (!answers || typeof answers !== 'object') throw new Error('no answers object');
                    // A config exported from the *nix Install Generator is shaped
                    // differently. Translate it rather than silently importing
                    // nothing, and say plainly what did not carry over.
                    if (window.ConfigTranslate) {
                        var t = window.ConfigTranslate.translateEnvelope(parsed, 'manual-walkthrough');
                        answers = t.answers;
                        if (t.translated) {
                            var note = 'Imported a *nix Install Generator config. ' +
                                t.mapped.length + ' settings carried over.';
                            if (t.unmapped.length) {
                                note += '\n\nThese had no equivalent here and were left ' +
                                        'unanswered, so the walkthrough will ask:\n  ' +
                                        t.unmapped.slice(0, 12).join(', ');
                            }
                            alert(note);
                        }
                    }
                    state = answers;
                    visited = activeSteps()
                        .filter(function (s) { return state[s.id] !== undefined; })
                        .map(function (s) { return s.id; });
                    pruneUnreachable();
                    rebuildGuide();
                    save();
                    renderStep(nextUnanswered());
                } catch (err) {
                    alert('That file is not a config this page understands.\n\n' + err.message);
                }
                imp.value = '';
            };
            r.readAsText(f);
        });
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    /* ── One choice, two places it can be made ───────────────────────────────
       The header switcher and the first question both set the target system.
       They must never show different answers, because the answer decides which
       commands the guide prints.

       On load, whichever of the two has an answer wins, in this order: a stored
       selection (made in the welcome modal, or on another page, or in the
       corner a moment ago) is authoritative, because it is the more recent
       statement; failing that, an answer resumed from an earlier walkthrough is
       published to the header so the corner stops saying "choose your system"
       about a question already answered. */
    function reconcileOs() {
        if (typeof window.chosenOS !== 'function') return;
        var chosen = window.chosenOS();
        if (chosen) {
            if (state.os !== chosen) {
                state.os = chosen;
                pruneUnreachable();
            }
            // The OS question is the first step, so it belongs at the front of
            // the trail rather than wherever it happened to be recorded.
            if (visited.indexOf('os') === -1) visited.unshift('os');
        } else if (state.os && typeof window.setTargetOS === 'function') {
            window.setTargetOS(state.os);
        }
    }

    function onOsChanged(e) {
        var next = (e && e.detail) ? e.detail.os : null;
        if (state.os === next || (!next && state.os === undefined)) return;

        if (next) {
            state.os = next;
            if (visited.indexOf('os') === -1) visited.unshift('os');
        } else {
            delete state.os;
            var at = visited.indexOf('os');
            if (at !== -1) visited.splice(at, 1);
        }
        // Switching system can make earlier answers unreachable — Dusky and the
        // snapshot question do not exist on OpenBSD — so the same pruning the
        // walkthrough does after any answer has to happen here too, or a stale
        // answer leaks into a guide for a system that has no such option.
        pruneUnreachable();
        rebuildGuide();
        save();
        renderStep(nextUnanswered());
    }

    function init() {
        wireModeButtons();
        var resumed = restore();
        reconcileOs();
        wireExports();
        rebuildGuide();
        save();
        document.addEventListener('unix:os-changed', onOsChanged);
        renderStep((resumed || state.os !== undefined)
            ? (nextUnanswered() || null) : activeSteps()[0]);

        /* Right-click anywhere on a question opens its wiki section, matching
           the generator. tooltip.js does this for elements it knows about; this
           covers the question cards, which it does not. */
        document.addEventListener('contextmenu', function (e) {
            var card = e.target.closest ? e.target.closest('.q-card') : null;
            if (!card || !card.id) return;
            var id = card.id.replace(/^q-/, '');
            var step = null;
            for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) step = STEPS[i];
            if (!step) return;
            e.preventDefault();
            window.open('wiki.html#' + step.wiki, '_blank', 'noopener');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
