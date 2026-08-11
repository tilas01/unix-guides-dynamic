// legal.js — Onboarding: Welcome + Comprehensive Legal Disclaimer
// Uses localStorage only. No cookies. No tracking.
'use strict';
document.addEventListener('DOMContentLoaded', () => {
  // Legacy only. These were set by the old "I Agree & Don't Show Again" button,
  // which no longer exists — agreement is now two explicit ticks per session,
  // because a flag saved months ago is not somebody reading a waiver. They are
  // still honoured so that anyone who pressed that button before does not get
  // the dialog again unasked; nothing writes them any more.
  const LEGAL_KEY   = 'legal_accepted';
  const WELCOME_KEY = 'welcome_seen';
  // Session-scoped acceptance. Agreeing used to set nothing at all, so agreeing
  // and then navigating anywhere — including via the chooser's own escape link
  // — showed the dialog again on the next page, with no way out short of
  // ticking "don't show again". Acceptance now holds for the browser session.
  const SESSION_KEY = 'legal_accepted_session';

  function sessionAccepted() {
    try { return sessionStorage.getItem(SESSION_KEY) === 'true'; }
    catch (_) { return false; }
  }
  function markSessionAccepted() {
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch (_) { /* private mode */ }
  }

  const legalDone   = localStorage.getItem(LEGAL_KEY) === 'true';
  const welcomeDone = localStorage.getItem(WELCOME_KEY) === 'true';

  /* There is no neutral, general-*nix mode. Every page is a page about one
     system, so a session that has agreed but never chosen one is asked before
     it gets a page — otherwise a deep link, or a returning tab, would land
     somebody in a state the site is not meant to have. */
  function osUnchosen() {
    return typeof window.chosenOS === 'function' && !window.chosenOS();
  }

  if ((legalDone && welcomeDone) || sessionAccepted()) {
    if (osUnchosen()) showOsChooser(function () { /* nothing after it */ });
    return;
  }

  // ─── Overlay & modal factory ────────────────────────────────────────────────
  function makeOverlay() {
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', background: 'rgba(13,17,23,0.92)',
      zIndex: '10000', display: 'flex', justifyContent: 'center',
      alignItems: 'flex-start', paddingTop: '4vh', paddingBottom: '4vh', overflowY: 'auto',
      backdropFilter: 'blur(6px)', boxSizing: 'border-box'
    });
    return ov;
  }

  function makeModal() {
    const m = document.createElement('div');
    Object.assign(m.style, {
      background: 'var(--bg-color,#1a1b26)',
      border: '1px solid var(--accent-red,#f7768e)',
      padding: '2.5rem',
      maxWidth: '660px', width: '92%',
      borderRadius: '14px',
      textAlign: 'left',
      boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      maxHeight: '90vh', overflowY: 'auto',
      fontFamily: "'Inter','Fira Code',Consolas,sans-serif",
      color: 'var(--fg-color,#a9b1d6)',
      fontSize: '0.9rem', lineHeight: '1.6',
    });
    return m;
  }

  // ─── Main waiver modal ───────────────────────────────────────────────────────
  function showWaiver() {
    const overlay = makeOverlay();
    const modal   = makeModal();

    modal.innerHTML = `
      <!-- Welcome Header -->
      <div style="text-align:center; margin-bottom:1.75rem;">
        <div style="font-size:2.4rem; margin-bottom:0.6rem;">🦀🛡️</div>
        <h2 style="color:var(--accent-cyan,#7dcfff); margin:0; font-size:1.55rem; letter-spacing:0.5px; font-weight:800;">
          Welcome to *nix Install Guides
        </h2>
        <p style="color:#8b949e; font-size:0.82rem; margin:0.5rem 0 0;">
          by <a href="https://github.com/tilas01" target="_blank" style="color:var(--accent-purple,#bb9af7); text-decoration:none;">tilas01</a>
          &nbsp;·&nbsp; Secure. Libre. Modular. Open Source.
        </p>
      </div>

      <!-- What the name means.
           Asked for by name, and it earns its place: the site is called *nix
           Install Guides and offers Linux distributions alongside two BSDs,
           which only makes sense once you know what the asterisk is doing. Kept
           to a details element so it explains on demand rather than standing
           between a first-time reader and the disclaimer they have to read. -->
      <details style="background:var(--bg-lighter,#24283b); border-radius:10px; padding:0.85rem 1.2rem; margin-bottom:1rem; font-size:0.85rem; line-height:1.65;">
        <summary style="cursor:pointer; color:var(--accent-cyan,#7dcfff); font-weight:700;">
          Why "*nix", and what is Unix?
        </summary>
        <p style="margin:0.7rem 0 0.7rem;">
          The <strong>*</strong> is a wildcard, the same one a shell uses. <strong>*nix</strong>
          means <em>any</em> system of that family — Linux, the BSDs, Solaris, macOS —
          rather than one particular product. In everyday use people say
          <em>*nix</em>, <em>Unix</em> and <em>Unix-like</em> more or less interchangeably.
        </p>
        <p style="margin:0 0 0.7rem;">
          <strong>UNIX</strong> itself began at AT&amp;T's Bell Labs in 1969. It was
          proprietary — closed source, licensed, nothing like the philosophy this
          project is built on. What spread was not the code so much as the
          <em>shape</em>: a hierarchical filesystem, small programs piped together,
          almost everything represented as a file, a shell as the ordinary way to
          drive the machine. That shape is what nearly every system here inherits.
        </p>
        <p style="margin:0 0 0.7rem;">
          Today <strong>UNIX</strong> is a certification rather than a product. The
          trademark belongs to <a href="https://www.opengroup.org/" target="_blank" rel="noopener"
          style="color:var(--accent-purple,#bb9af7);">The Open Group</a>, and a system may
          be called UNIX only if it has been certified against the Single UNIX
          Specification. The commercial Unixes that were certified — IBM's
          <strong>AIX</strong>, Oracle's <strong>Solaris</strong>, <strong>HP-UX</strong> —
          each shipped with that vendor's own hardware, and all of them have been
          largely displaced by Linux. <strong>macOS is certified UNIX</strong>, which
          makes it by some distance the most widely used one.
        </p>
        <p style="margin:0;">
          <strong>Linux and the BSDs are not certified</strong>, and that is a
          licensing decision rather than a technical verdict — certification costs
          money and constrains what you may change. Linux is a kernel written from
          scratch to behave like Unix; the BSDs descend from Berkeley's branch of the
          original code. Hence <em>*nix</em>: the honest word for the whole family,
          which is what this site covers.
        </p>
      </details>

      <!-- Blurb -->
      <div style="background:var(--bg-lighter,#24283b); border-radius:10px; padding:1rem 1.2rem; margin-bottom:1.5rem; font-size:0.85rem; line-height:1.65;">
        <p style="margin:0 0 0.7rem;">
          <strong style="color:var(--accent-green,#9ece6a);">Start by verifying your ISO.</strong>
          That comes before everything else, and the
          <a href="iso-verify.html" style="color:var(--accent-green,#9ece6a);">Verify ISO</a>
          page does it in your browser — the file never leaves your machine, and the
          checksum is taken from mirrors other than the one that served the image, so
          a host that lies about the image cannot also hand you a matching checksum.
        </p>
        <p style="margin:0 0 0.7rem;">
          Then pick whichever suits you. All three cover the same options and produce
          the same install:
        </p>
        <ul style="margin:0 0 0.7rem 1.1rem; padding:0;">
          <li><a href="manual.html" style="color:var(--accent-purple,#bb9af7);"><strong>Manual walkthrough</strong></a>
              — one question at a time, each explaining what it does and what it costs,
              with the guide building itself as you answer. <em>Recommended on a phone.</em></li>
          <li><a href="index.html" style="color:var(--accent-blue,#7aa2f7);"><strong>Generator</strong></a>
              — one form, every option at once, straight to a script and a guide.
              <em>Fastest on a desktop when you already know what you want.</em></li>
          <li><a href="wiki.html" style="color:var(--accent-cyan,#7dcfff);"><strong>Wiki</strong></a>
              — the same install written out longhand, with the decision points as
              branches you choose between. Also in the repository as markdown.</li>
        </ul>
        <p style="margin:0;">
          <a href="site-index.html" style="color:var(--accent-cyan,#7dcfff);"><strong>Index</strong></a>
          searches all of it at once. The
          <a href="security-tools.html" style="color:var(--accent-red,#f7768e);"><strong>security tools</strong></a>
          are optional and several can lock you out — read what each does first.
          Hover, or tap, any labelled element for an explanation; the
          <strong>ℹ️</strong> button top right turns those off and back on.
        </p>
      </div>

      <!-- Legal Disclaimer -->
      <div style="border-top:1px solid var(--border-color,#2d2d3f); padding-top:1.25rem; margin-bottom:1.5rem;">
        <h3 style="color:var(--accent-red,#f7768e); margin-top:0; font-size:1rem;">⚠️ Legal Disclaimer &amp; Liability Waiver</h3>
        <p style="color:var(--fg-color,#a9b1d6); line-height:1.75; font-size:0.83rem; margin:0;">
          By continuing, you acknowledge and accept that all content, tools, scripts, binaries,
          documentation, and source code provided on this website and within the GitHub repository
          <a href="https://github.com/tilas01/unix-guides-dynamic" target="_blank"
             style="color:var(--accent-blue,#7aa2f7);">tilas01/unix-guides-dynamic</a> —
          including but not limited to the *nix Install Guides generators, the Arch Rusty Security Suite (ARSS),
          Anti-Evil-Maid, Anti-Ducky, Kernel Watcher, LibreOTP, and Scarecrow —
          are provided strictly <strong>"AS IS"</strong>, without warranty of any kind, express or implied.
          The author (<strong>tilas01</strong>) expressly disclaims all liability for any direct, indirect,
          incidental, consequential, or punitive damages of any nature, including but not limited to:
          data loss or corruption; system damage, bricking, or unbootable states;
          security breaches or exploits that are not mitigated;
          loss of files due to DoD-grade disk wipe features (such as Panic Password, Anti-Evil-Maid triggers,
          or secure erase routines); conflicts arising from proprietary software, firmware blobs, or third-party
          packages; and any harm arising from following generated installation scripts or guides.
          This software is intended for advanced Linux users who understand the risks involved.
          You assume <strong>full and sole responsibility</strong> for all actions taken using these tools on your systems.
          This project was developed with AI assistance and has been reviewed by tilas01 — you
          <strong>must</strong> review all generated scripts before executing them.
          No cookies, session tracking, or personally identifiable information is collected by this site.
          Generation history is stored exclusively in your local browser session memory and is permanently
          deleted when the tab is closed. Your use of this website and any associated resources
          constitutes your binding agreement to these terms in full.
        </p>
      </div>

      <!-- Two required confirmations, then one way forward -->
      <div style="border-top:1px solid var(--border-color,#2d2d3f); padding-top:1.25rem;">
        <p style="color:var(--accent-orange,#ff9e64); font-size:0.8rem; margin:0 0 0.9rem; font-weight:600;">
          Both boxes below are required. <span style="color:#8b949e; font-weight:400;">Continue stays
          greyed out until you tick both — they are two separate things and you are
          confirming each one on its own.</span>
        </p>

        <label for="legal-ck-waiver" class="legal-check nav-tooltip"
               data-title="⚠️ Understanding the waiver"
               data-desc="Confirms you have read the disclaimer above and accept that everything here is provided as is, with no warranty and no liability. The full text is linked and opens in a new tab.">
          <input type="checkbox" id="legal-ck-waiver">
          <span>
            I have read and understand the <strong>legal disclaimer and liability waiver</strong>
            above, and I accept that I use this project at my own risk.
            <a href="wiki.html?page=user-agreements/LEGAL-WAIVER.txt" target="_blank" rel="noopener"
               style="color:var(--accent-red,#f7768e);">Read the full waiver&nbsp;↗</a>
          </span>
        </label>

        <label for="legal-ck-licence" class="legal-check nav-tooltip"
               data-title="📄 Complying with the licence"
               data-desc="The repository is licensed CC BY-NC-SA 4.0: keep the credit on it, do not sell it, and share anything you build from it under the same licence. Everything else — reading, forking, mirroring, editing — is free.">
          <input type="checkbox" id="legal-ck-licence">
          <span>
            I have read the <strong>repository licence</strong> and I will comply with it.
            <a href="wiki.html?page=user-agreements/LICENSE.txt" target="_blank" rel="noopener"
               style="color:var(--accent-blue,#7aa2f7);">CC BY-NC-SA 4.0&nbsp;↗</a>
            &nbsp;·&nbsp;
            <a href="wiki.html?page=user-agreements/LICENCE-PLAIN-ENGLISH.txt" target="_blank" rel="noopener"
               style="color:var(--accent-blue,#7aa2f7);">in plain English&nbsp;↗</a>
          </span>
        </label>

        <button id="legal-continue-btn" class="btn nav-tooltip" type="button" disabled
                data-title="Continue"
                data-desc="Enabled once both boxes are ticked. It takes you to a list of everywhere on the site, with a short description of each."
                style="
          background:var(--bg-lighter,#24283b); color:#565f89;
          border:1px solid var(--border-color,#2d2d3f); width:100%;
          padding:0.9rem; margin-top:1.1rem;
          font-size:1rem; font-weight:700; border-radius:8px;
          cursor:not-allowed; letter-spacing:0.5px;
          transition:background 0.18s, color 0.18s, border-color 0.18s;">
          Continue
        </button>

        <p id="legal-continue-hint" style="color:#8b949e; font-size:0.72rem; text-align:center; margin:0.7rem 0 0;">
          Tick both boxes to continue.
        </p>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // After agreeing: which system, then where to start. The order matters —
    // the route chooser names the system in its own labels, so asking after it
    // would mean showing "Verify Arch ISO" to somebody about to say Gentoo.
    const dismiss = () => {
      markSessionAccepted();
      overlay.remove();
      showOsChooser();
    };

    // One button, gated on two ticks. There is deliberately no "don't show
    // again": that turned agreement into a preference, and a stored preference
    // is not somebody reading a waiver. Ticking is the whole point, so it is
    // asked once per session and no more.
    const ckWaiver  = modal.querySelector('#legal-ck-waiver');
    const ckLicence = modal.querySelector('#legal-ck-licence');
    const btn       = modal.querySelector('#legal-continue-btn');
    const hint      = modal.querySelector('#legal-continue-hint');

    const GREEN = 'var(--accent-green,#9ece6a)';

    function syncGate() {
      const ready = ckWaiver.checked && ckLicence.checked;
      btn.disabled = !ready;
      // Colour and cursor both move, so the state is legible without relying on
      // colour alone — the disabled cursor says the same thing to anyone who
      // cannot distinguish the grey from the green.
      // The `border` shorthand, not `borderColor`. Assigning the longhand alone
      // expands the shorthand already in the style attribute and leaves
      // border-*-style and border-*-width as empty strings, so the width fell
      // back to the UA hairline (0.67px) and the button's box shifted by a
      // fraction of a pixel every time it was toggled.
      Object.assign(btn.style, ready
        ? { background: GREEN, color: '#16161e',
            border: '1px solid ' + GREEN, cursor: 'pointer' }
        : { background: 'var(--bg-lighter,#24283b)', color: '#565f89',
            border: '1px solid var(--border-color,#2f3450)', cursor: 'not-allowed' });

      if (ready) {
        hint.textContent = 'Both confirmed — you can continue.';
        hint.style.color = GREEN;
      } else {
        const missing = !ckWaiver.checked && !ckLicence.checked ? 'both boxes'
                      : !ckWaiver.checked ? 'the disclaimer box'
                      : 'the licence box';
        hint.textContent = 'Tick ' + missing + ' to continue.';
        hint.style.color = '#8b949e';
      }
    }

    [ckWaiver, ckLicence].forEach(ck => ck.addEventListener('change', syncGate));
    syncGate();

    btn.addEventListener('click', () => { if (!btn.disabled) dismiss(); });
    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) btn.style.filter = 'brightness(1.12)';
    });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });

    if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
  }

  /* "Gentoo Install Generator" once Gentoo is chosen, "Install Generator"
     before anything is. Returns a trailing space so the caller reads as one
     phrase either way. */
  /* What the chosen system actually publishes — an ISO for most, a disk image
     for Raspberry Pi OS, which has no ISO to verify. */
  function osMedia() {
    const chosen = typeof window.chosenOS === 'function' ? window.chosenOS() : null;
    if (!chosen || !window.OS_META) return 'image';
    return window.OS_META[chosen].media || 'image';
  }

  function osName() {
    const chosen = typeof window.chosenOS === 'function' ? window.chosenOS() : null;
    if (!chosen || !window.OS_META) return '';
    const m = window.OS_META[chosen];
    return (m.short || m.label) + ' ';
  }

  // ─── Which system are you installing? ───────────────────────────────────────
  // Asked once, straight after the waiver, because it changes what every other
  // page means. Four cards using the same marks the header switcher uses, so
  // the picture in the modal and the picture in the corner are the same
  // picture — and the same table in os-meta.js describes both.
  //
  // Arch is pre-selected and Continue works without touching anything: the
  // three other guides are unfinished, and the default has to be the one that
  // works. Skipping is not a separate state — it means Arch, which is what the
  // rest of the site already assumes.
  function showOsChooser(andThen) {
    const next = typeof andThen === 'function' ? andThen : showGeneratorJump;
    const META = window.OS_META;
    // If os-meta.js did not load there is nothing honest to ask, so go straight
    // on rather than showing a chooser that cannot record an answer.
    if (!META || typeof window.setTargetOS !== 'function') { next(); return; }

    const overlay = makeOverlay();
    const modal = makeModal();
    modal.style.maxWidth = '720px';
    modal.style.borderColor = 'var(--accent-purple,#bb9af7)';

    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      Object.assign(modal.style, {
        width: '100%', maxWidth: '100%', minHeight: '100vh',
        borderRadius: '0', border: 'none', padding: '1.5rem 1.1rem',
      });
      Object.assign(overlay.style, { paddingTop: '0', paddingBottom: '0', alignItems: 'stretch' });
    }

    const ACCENT = {
      cyan: 'var(--accent-cyan,#7dcfff)', purple: 'var(--accent-purple,#bb9af7)',
      red: 'var(--accent-red,#f7768e)', green: 'var(--accent-green,#9ece6a)'
    };

    // Pre-selected, not merely defaulted somewhere in the code: the card that
    // is chosen is visibly chosen before anything is clicked. It can only ever
    // be a system that is finished — os-meta.js refuses the others outright.
    let picked = window.chosenOS() || window.OS_DEFAULT;
    const canPick = id => typeof window.osSelectable !== 'function' || window.osSelectable(id);

    let html = `
      <h2 style="color:var(--accent-purple,#bb9af7); text-align:center; margin:0 0 0.4rem;">
        Which system are you installing?
      </h2>
      <p style="color:#8b949e; text-align:center; font-size:0.85rem; margin:0 0 0.9rem;">
        This changes the guides, the scripts and the labels across the whole site.
        You can change it at any time from the switcher in the top-left corner.
      </p>
      <p style="color:var(--accent-orange,#ff9e64); text-align:center; font-size:0.82rem;
                line-height:1.6; margin:0 0 1.3rem; border:1px solid var(--accent-orange,#ff9e64);
                border-radius:8px; padding:0.6rem 0.8rem;">
        <strong>Pick the one you are actually installing.</strong> These are not
        skins on the same guide — each system has its own package manager,
        installer, bootloader and encryption tooling. A guide built for the wrong
        one will run commands that do not exist on your machine and leave you
        with a half-partitioned disk and no system.
      </p>`;

    /* Grouped, because the split matters and the names do not announce it.
       Somebody who knows Arch may not know that FreeBSD and OpenBSD share
       almost none of its tooling — different kernel, different userland,
       different everything below the shell prompt. */
    const FAMILIES = [
      { key: 'linux', heading: 'Linux',
        note: 'One kernel, shared tooling. LUKS for encryption, systemd or ' +
              'OpenRC for init, and the same filesystems throughout.',
        members: ['arch', 'gentoo', 'raspios'] },
      { key: 'bsd', heading: 'BSD',
        note: 'Not Linux, and not a variant of it. A different kernel and a ' +
              'complete base system developed together, with its own installer, ' +
              'its own package tools, geli or softraid instead of LUKS, and pf ' +
              'for the firewall. Very little transfers across.',
        members: ['freebsd', 'openbsd'] }
    ];

    FAMILIES.forEach(fam => {
      // Only systems the table actually knows about, so a member listed here
      // that no longer exists in OS_META drops out rather than rendering blank.
      const present = fam.members.filter(id => META[id]);
      if (!present.length) return;
      html += `
        <div style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.07em;
                    color:var(--accent-cyan,#7dcfff); margin:0.9rem 0 0.2rem;">${fam.heading}</div>
        <div style="font-size:0.78rem; color:#8b949e; margin-bottom:0.55rem; line-height:1.55;">${fam.note}</div>
        <div class="os-choose-group" style="display:flex; flex-direction:column; gap:0.6rem;">`;

      present.forEach(id => {
      const m = META[id];
      const colour = ACCENT[m.accent] || ACCENT.purple;
      html += `
        <button type="button" class="os-choose-card${canPick(id) ? '' : ' os-choose-locked'}" data-os="${id}"
                aria-pressed="false"${canPick(id) ? '' : ' aria-disabled="true"'}
                style="display:flex; gap:0.8rem; align-items:flex-start; text-align:left;
                       background:var(--bg-darker,#16161e); border:1px solid ${colour};
                       border-radius:10px; padding:0.8rem 0.95rem;
                       cursor:${canPick(id) ? 'pointer' : 'not-allowed'};
                       opacity:${canPick(id) ? '1' : '0.72'};
                       font-family:inherit; color:var(--fg-color,#a9b1d6); width:100%;">
          <img src="img/icons/${m.slug}-64.png" alt="" width="40" height="40"
               style="image-rendering:pixelated; flex:0 0 auto;">
          <span style="display:block; min-width:0;">
            <span style="display:block; font-weight:700; color:${colour}; font-size:0.98rem;">
              ${m.label}${m.complete
                ? ' <span style="font-size:0.7rem; color:var(--accent-green,#9ece6a); font-weight:400;">— ready</span>'
                : ' <span style="font-size:0.7rem; color:var(--accent-orange,#ff9e64); font-weight:400;">— 🚧 not available yet</span>'}
            </span>
            <span style="display:block; color:var(--fg-color,#a9b1d6); font-size:0.83rem; margin-top:0.25rem; line-height:1.55;">
              ${m.desc}
            </span>
            ${m.danger ? `<span style="display:block; color:var(--accent-orange,#ff9e64);
                                        font-size:0.78rem; margin-top:0.4rem; line-height:1.5;">
              ${m.danger}
            </span>` : ''}
          </span>
        </button>`;
      });
      html += `</div>`;
    });

    html += `
      <button id="os-choose-continue" class="btn" type="button" style="
        background:var(--accent-purple,#bb9af7); color:#16161e;
        border:1px solid var(--accent-purple,#bb9af7); width:100%;
        padding:0.9rem; margin-top:1.1rem; font-size:1rem; font-weight:700;
        border-radius:8px; cursor:pointer; letter-spacing:0.5px;">
        Continue
      </button>
      <p id="os-choose-hint" style="color:#8b949e; font-size:0.72rem; text-align:center; margin:0.7rem 0 0;">
        Arch Linux is selected. It is the only finished guide, and it is what
        the site falls back to if you skip this.
      </p>`;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const cards = modal.querySelectorAll('.os-choose-card');
    const hint = modal.querySelector('#os-choose-hint');

    function paint() {
      cards.forEach(c => {
        const on = c.getAttribute('data-os') === picked;
        c.setAttribute('aria-pressed', String(on));
        c.style.background = on ? 'var(--bg-lighter,#24283b)' : 'var(--bg-darker,#16161e)';
        c.style.borderWidth = on ? '2px' : '1px';
      });
      const m = META[picked];
      hint.textContent = m.complete
        ? m.label + ' is selected. It is the only finished guide.'
        : m.label + ' is selected. Its guide is not finished — you can read it, ' +
          'but use Arch Linux to actually install.';
      hint.style.color = m.complete ? '#8b949e' : 'var(--accent-orange,#ff9e64)';
    }

    cards.forEach(c => c.addEventListener('click', () => {
      const id = c.getAttribute('data-os');
      if (!canPick(id)) {
        // Not a selection. Say why, leave the choice where it was, and do not
        // pretend the click did something.
        hint.textContent = typeof window.osUnavailableReason === 'function'
          ? window.osUnavailableReason(id)
          : META[id].label + ' is not available yet.';
        hint.style.color = 'var(--accent-orange,#ff9e64)';
        return;
      }
      picked = id;
      paint();
    }));
    paint();

    modal.querySelector('#os-choose-continue').addEventListener('click', () => {
      window.setTargetOS(picked);
      overlay.remove();
      document.body.style.overflow = '';
      next();
    });

    if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
  }

  // ─── Generator jump overlay ─────────────────────────────────────────────────
  // Shown only when the user ticked the shortcut box. Two plain choices, each
  // saying who it is for, so a first-time visitor picks the right one rather
  // than guessing. Right-clicking either card opens its wiki explainer, matching
  // the rest of the site.
  // ─── Where to next ──────────────────────────────────────────────────────────
  // Shown once, after agreeing. Every destination on the site, grouped, each
  // with its own description and tooltip, so a first-time visitor can tell them
  // apart rather than guessing from a name. The two generators are grouped
  // together under "Build an install" because that is the choice people
  // actually have to make; the rest are separate because they are separate
  // things, not variations of one.
  function showGeneratorJump() {
    const overlay = makeOverlay();
    const modal = makeModal();
    modal.style.maxWidth = '760px';
    modal.style.borderColor = 'var(--accent-cyan,#7dcfff)';

    // Fullscreen on a phone: at 92% width inside a scrolling overlay these
    // cards became a cramped strip with the page showing round the edges.
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      Object.assign(modal.style, {
        width: '100%', maxWidth: '100%', minHeight: '100vh',
        borderRadius: '0', border: 'none', padding: '1.5rem 1.1rem',
      });
      Object.assign(overlay.style, { paddingTop: '0', paddingBottom: '0', alignItems: 'stretch' });
    }

    const GROUPS = [
      {
        heading: '🛠️ Build an install',
        note: 'Both produce the same thing — a bash script and a matching markdown guide. They differ only in how much you decide up front.',
        items: [
          { href: 'index.html', icon: '⚙️', name: osName() + 'Install Generator',
            tag: 'recommended on a PC', colour: 'var(--accent-blue,#7aa2f7)',
            desc: 'One form, every option at once. Best if you already know what you want.',
            tip: 'Set every option in a single form and generate a custom install script and guide. Fastest on a desktop.' },
          { href: 'manual.html', icon: '🧭', name: osName() + 'Install Walkthrough',
            tag: 'recommended on mobile', colour: 'var(--accent-purple,#bb9af7)',
            desc: 'One question at a time, everything explained, the guide building as you answer.',
            tip: 'Best on a phone, or if you are not sure yet — it walks you through each choice and says what it costs.' }
        ]
      },
      {
        heading: '🔍 Before you install',
        note: 'Do this first. It comes before everything else.',
        items: [
          { href: 'iso-verify.html', icon: '💿', name: 'Verify ' + osName() + osMedia(),
            tag: 'x86_64 and ARM', colour: 'var(--accent-green,#9ece6a)',
            desc: 'Hash your download in the browser and check it against mirrors other than the one that served it.',
            tip: 'The file never leaves your machine. A host that lies about the image cannot also hand you a matching checksum.' }
        ]
      },
      {
        heading: '📚 Read and explore',
        note: 'The same material, written out — useful whether or not you use a generator.',
        items: [
          { href: 'site-index.html', icon: '🔎', name: 'Index',
            tag: 'search everything', colour: 'var(--accent-cyan,#7dcfff)',
            desc: 'One search box across the wiki, every generator and walkthrough question, the tools and the docs.',
            tip: 'The contents page for the whole project. Start here if you do not know what you are looking for.' },
          { href: 'wiki.html', icon: '📖', name: 'Wiki',
            tag: 'install by hand', colour: 'var(--accent-cyan,#7dcfff)',
            desc: 'Every option explained in full, plus firmware lockdown, dual boot, ARM and AUR safety.',
            tip: 'The install written out longhand, with the decision points as branches you choose between.' },
          { href: 'security-tools.html', icon: '🦀', name: 'Security Tools',
            tag: 'optional', colour: 'var(--accent-red,#f7768e)',
            desc: 'The Rust suite and the vetted third-party hardening tools. Several can lock you out — read first.',
            tip: 'Libre OTP, Anti-Ducky, Anti-Evil Maid, Kernel Watcher and Scarecrow. Reproducible, GPG-signed builds.' },
          { href: 'live.html', icon: '📝', name: 'Live Editor',
            tag: 'edit and download', colour: 'var(--accent-orange,#ff9e64)',
            desc: 'Edit a generated script and guide side by side, browse this session\'s history, and download.',
            tip: 'Already have a generated script or a saved .json config? Load it here.' }
        ]
      }
    ];

    let html = `
      <h2 style="color:var(--accent-cyan,#7dcfff); text-align:center; margin:0 0 0.4rem;">
        Where would you like to start?
      </h2>
      <p style="color:#8b949e; text-align:center; font-size:0.85rem; margin:0 0 1.4rem;">
        Everything here is optional and nothing is hidden — you can reach any of
        these at any time from the header.
      </p>`;

    GROUPS.forEach(g => {
      html += `
        <div style="margin-bottom:1.3rem;">
          <div style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.07em;
                      color:var(--accent-cyan,#7dcfff); margin-bottom:0.2rem;">${g.heading}</div>
          <div style="font-size:0.78rem; color:#8b949e; margin-bottom:0.6rem;">${g.note}</div>
          <div style="display:flex; flex-direction:column; gap:0.55rem;">`;
      g.items.forEach(it => {
        html += `
            <a href="${it.href}" class="jump-card nav-tooltip"
               data-title="${it.icon} ${it.name}" data-desc="${it.tip}"
               style="display:block; text-decoration:none; background:var(--bg-darker,#16161e);
                      border:1px solid ${it.colour}; border-radius:10px; padding:0.8rem 0.95rem;">
              <span style="display:block; font-weight:700; color:${it.colour}; font-size:0.98rem;">
                ${it.icon} ${it.name}
                <span style="font-size:0.7rem; color:var(--accent-green,#9ece6a); font-weight:400;">— ${it.tag}</span>
              </span>
              <span style="display:block; color:var(--fg-color,#a9b1d6); font-size:0.83rem; margin-top:0.25rem; line-height:1.55;">
                ${it.desc}
              </span>
            </a>`;
      });
      html += `</div></div>`;
    });

    html += `
      <button id="jump-skip" style="
        display:block; margin:0.6rem auto 0; background:none; border:none;
        color:#8b949e; font-family:var(--font-mono); font-size:0.82rem;
        text-decoration:underline; cursor:pointer; min-height:44px;">
        Close and browse on my own
      </button>`;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Closing must never re-open the waiver. Acceptance is already recorded for
    // the session by dismiss(), so this simply lets the page through.
    modal.querySelector('#jump-skip').addEventListener('click', () => {
      document.body.style.overflow = '';
      overlay.remove();
    });
    modal.querySelectorAll('a[href]').forEach(a =>
      a.addEventListener('click', () => { document.body.style.overflow = ''; }));

    if (typeof window.refreshTooltips === 'function') window.refreshTooltips();
  }

  // Show if not dismissed
  showWaiver();
});
