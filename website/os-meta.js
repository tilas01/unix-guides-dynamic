/* ============================================================================
   os-meta.js — the target operating systems, described once.
   ----------------------------------------------------------------------------
   Loaded by every page, ahead of manual-data.js and shared-ui.js. This is the
   only place the four systems are written down: their labels, their tooling,
   which documentation is authoritative for each, and whether the guide for it
   is finished.

   One table, not one per front end. The header switcher, the walkthrough
   question, the generated markdown and the generated shell script all read from
   here, and the answer decides which commands get printed onto somebody's
   screen. Two tables would let the dropdown and the question disagree about
   which system the reader is installing, and nothing would notice.

   `complete: false` drives the Work In Progress badge. An OS may appear here
   before it is finished, but must be unmistakably marked as not ready to
   install from: these scripts repartition disks, and someone who ignores a
   subtle warning loses one. The badge comes off only when the guides reach
   Arch's depth, every permutation generates in both front ends, every emitted
   script passes `bash -n` (and `sh -n` for the BSDs, whose /bin/sh is not
   bash), option parity holds, and the tool-support table is honest about what
   cannot work there.

   No dependencies. Exports onto the global object, so it works both as a
   classic script in the browser and inside the test harnesses, which
   concatenate the website's scripts into one scope.
   ========================================================================= */

'use strict';

(function (root) {

    /* Arch is the default whenever no selection has been made or the stored one
       is not recognised. That is a promise the rest of the site depends on:
       skipping the question has to produce exactly the guide this project
       produced before the selector existed. */
    var DEFAULT_OS = 'arch';
    // Named in the unavailable-reason text below.
    var DEFAULT_LABEL = 'Arch';

    var OS_META = {
        arch: {
            label: 'Arch Linux', short: 'Arch', media: 'ISO', complete: true,
            pkg: 'pacman', init: 'systemd', fde: 'LUKS2',
            docs: 'https://wiki.archlinux.org/',
            docsName: 'the Arch Wiki',
            /* Asset base name. The icons and banners are generated from
               scripts/gen-icons.py under these names, at
               img/icons/<slug>-<size>.png and img/banners/<slug>.png. */
            slug: 'arch-guides',
            /* The system's own cheatsheet, under docs/cheatsheets/. Read by the
               cheatsheets page for its tabs and by the generator for the copy
               it downloads into the new machine's home directory, so the file
               is named once. A system without one gets no cheatsheet rather
               than another system's: a sheet of pacman commands saved on a
               Gentoo box is the same wrong-tooling defect in a file that
               outlives the install. */
            cheatsheet: 'arch-commands.md',
            accent: 'cyan',
            summary: 'pacman, systemd, LUKS2.',
            desc: 'Complete, and the default. pacman, systemd, LUKS2. The Arch ' +
                  'Wiki is the authority — where this project and the Arch Wiki ' +
                  'disagree, the Arch Wiki is right.'
        },
        gentoo: {
            label: 'Gentoo', short: 'Gentoo', media: 'ISO', complete: false,
            pkg: 'portage', init: 'OpenRC or systemd', fde: 'LUKS2',
            docs: 'https://wiki.gentoo.org/wiki/Handbook:AMD64',
            docsName: 'the Gentoo Handbook',
            slug: 'gentoo-guides',
            cheatsheet: 'gentoo-commands.md',
            accent: 'purple',
            summary: 'stage3, portage, USE flags.',
            desc: 'Source-based: a stage3 tarball, portage with USE flags, and ' +
                  'you compile the kernel. Shares Linux primitives with Arch, so ' +
                  'LUKS2 and every security tool work unchanged.',
            danger: '🚧 NOT READY TO INSTALL FROM. Visible for reading only — ' +
                    'the guide is incomplete and running it would not produce a ' +
                    'working system. Use Arch for an actual install.'
        },
        freebsd: {
            label: 'FreeBSD', short: 'FreeBSD', media: 'ISO', complete: false,
            pkg: 'pkg / ports', init: 'rc.d', fde: 'geli',
            docs: 'https://docs.freebsd.org/en/books/handbook/',
            docsName: 'the FreeBSD Handbook',
            slug: 'freebsd-guides',
            accent: 'red',
            summary: 'Not Linux. geli, ZFS, rc.d.',
            desc: 'Not Linux. bsdinstall, ZFS or UFS, geli for encryption, ' +
                  'pkg and ports, rc.d instead of systemd.',
            danger: '🚧 NOT READY TO INSTALL FROM. Visible for reading only. ' +
                    'Several security tools cannot work here unchanged — see ' +
                    'the wiki before relying on any of it.'
        },
        raspios: {
            label: 'Raspberry Pi OS', short: 'Raspberry Pi', media: 'image', complete: false,
            pkg: 'apt', init: 'systemd', fde: 'none by default',
            docs: 'https://www.raspberrypi.com/documentation/',
            docsName: 'the Raspberry Pi documentation',
            slug: 'raspios-guides',
            accent: 'red',
            summary: 'Debian on a Pi. apt, systemd, aarch64 only.',
            desc: 'Debian, built for Raspberry Pi hardware. apt and systemd, ' +
                  'configured through raspi-config, and written to an SD card ' +
                  'or USB rather than installed from an ISO. It boots from the ' +
                  'bootloader in the board EEPROM, not UEFI, so the firmware ' +
                  'and Secure Boot steps elsewhere on this site do not apply.',
            /* Architecture is not a choice here. Raspberry Pi OS runs on Pi
               hardware and nothing else, so offering x86_64 alongside it would
               be offering a combination that cannot exist. Enforced through
               OS_LOCKS in manual-data.js, which shows the lock rather than
               silently overriding the answer. */
            locks: { arch: 'aarch64' },
            danger: '🚧 NOT READY TO INSTALL FROM. Visible for reading only. ' +
                    'Raspberry Pi OS is written to a card with an imaging tool ' +
                    'rather than installed from a live environment, so most of ' +
                    'this site\'s partitioning and bootloader steps do not ' +
                    'apply to it yet.'
        },
        openbsd: {
            label: 'OpenBSD', short: 'OpenBSD', media: 'ISO', complete: false,
            pkg: 'pkg_add', init: 'rc.d', fde: 'softraid -C CRYPTO',
            docs: 'https://www.openbsd.org/faq/',
            docsName: 'the OpenBSD FAQ',
            slug: 'openbsd-guides',
            accent: 'green',
            summary: 'Not Linux. softraid, FFS2, signify.',
            desc: 'Not Linux, and the furthest from Arch. The install(8) ' +
                  'script, disklabel, FFS2, softraid for encryption, and ' +
                  'signify rather than GPG for release signatures.',
            danger: '🚧 NOT READY TO INSTALL FROM. Visible for reading only. ' +
                    'OpenBSD has no PAM and no Wayland, so the duress PINs and ' +
                    'the Dusky desktop cannot work there at all.'
        }
    };

    /* The neutral identity, shown before anything has been chosen. Not a member
       of OS_META: it is not a system you can install, and putting it in the
       table would mean every consumer had to remember to exclude it. */
    var NEUTRAL = {
        label: '*nix Install Guides',
        slug: 'unix-guides',
        accent: 'purple'
    };

    /* Which systems a reader may actually switch to.

       All five are listed, because seeing what is coming is useful. Only a
       finished one can be selected: the other four still emit Arch's commands
       under another system's name, and a CAUTION banner is a weaker guarantee
       than simply not handing someone the guide. When a system's emitters are
       real and its badge lifts, `complete: true` is the only change needed —
       nothing else here knows the list.

       Enforced in setTargetOS() rather than only in the two places that draw a
       chooser, so a hand-edited sessionStorage value, a stale session from an
       earlier build, or a page that forgets to check cannot land somebody on a
       guide that is not ready. */
    function selectable(value) {
        var meta = OS_META[value];
        return !!(meta && meta.complete);
    }

    /** Why a system cannot be picked yet, for the UI to show beside it. */
    function unavailableReason(value) {
        var meta = OS_META[value];
        if (!meta) return 'Not a system this project covers.';
        if (meta.complete) return '';
        return meta.label + ' is still being written. Its guide would print ' +
               DEFAULT_LABEL + ' commands under the ' + meta.label +
               ' name, so it is not offered yet — only shown, so you can see it coming.';
    }

    /** Any value in, a real OS id out. Unknown and missing both mean Arch. */
    function osIdOf(value) {
        return (value && Object.prototype.hasOwnProperty.call(OS_META, value))
            ? value : DEFAULT_OS;
    }

    function osMetaOf(value) { return OS_META[osIdOf(value)]; }
    function osLabelOf(value) { return osMetaOf(value).label; }

    /* ── The selection ───────────────────────────────────────────────────────
       sessionStorage, alongside the walkthrough's own state, because that is
       the only persistence a static site on GitHub Pages has and because the
       choice should not outlive the tab that made it.

       Two accessors, and the difference between them matters:

         chosenOS()  what the reader picked, or null if they have not been asked
                     yet. The header uses this — the banner stays neutral until
                     somebody chooses.
         targetOS()  what to generate for, which is Arch when nothing has been
                     chosen. Everything downstream uses this.

       Collapsing the two would either badge the site as Arch before the reader
       had said anything, or leave the generators with no system at all. */
    var KEY = 'unix_target_os';

    function chosenOS() {
        var raw;
        try { raw = root.sessionStorage && root.sessionStorage.getItem(KEY); }
        catch (_) { return null; }                 // private mode; treat as unasked
        // A stored value for a system that is no longer selectable — an older
        // session, or a hand-edited key — reads as "not chosen" rather than
        // being honoured.
        return (raw && selectable(raw)) ? raw : null;
    }

    function targetOS() { return chosenOS() || DEFAULT_OS; }

    /**
     * Record the selection and tell the page. Returns the id actually stored,
     * which is the Arch fallback if `id` is not one of the four.
     */
    function setTargetOS(id) {
        var want = osIdOf(id);
        // An unfinished system is not a selection, it is a preview. Refusing
        // here rather than in the chooser means every route in — the modal, the
        // dropdown, a restored session, a page doing something unexpected —
        // gets the same answer.
        var next = selectable(want) ? want : DEFAULT_OS;
        try { if (root.sessionStorage) root.sessionStorage.setItem(KEY, next); }
        catch (_) { /* private mode: the selection holds for this page only */ }
        announce(next);
        return next;
    }

    /** Forget the selection, returning the site to its neutral, unasked state. */
    function clearTargetOS() {
        try { if (root.sessionStorage) root.sessionStorage.removeItem(KEY); }
        catch (_) { /* nothing to undo */ }
        announce(null);
    }

    /* One event, on document, so any page can react without the switcher
       needing to know what is on it. `detail.os` is the stored id, or null when
       the selection has been cleared. */
    function announce(os) {
        var doc = root.document;
        if (!doc || typeof doc.dispatchEvent !== 'function') return;
        var ev;
        try {
            ev = new root.CustomEvent('unix:os-changed', { detail: { os: os } });
        } catch (_) {
            // Older engines: the constructor is unavailable but the legacy
            // factory is. Feature-detected rather than assumed, as everything
            // optional here is.
            if (!doc.createEvent) return;
            ev = doc.createEvent('CustomEvent');
            ev.initCustomEvent('unix:os-changed', true, false, { os: os });
        }
        doc.dispatchEvent(ev);
    }

    root.OS_META = OS_META;
    root.OS_NEUTRAL = NEUTRAL;
    root.OS_DEFAULT = DEFAULT_OS;
    root.osSelectable = selectable;
    root.osUnavailableReason = unavailableReason;
    root.osIdOf = osIdOf;
    root.osMetaOf = osMetaOf;
    root.osLabelOf = osLabelOf;
    root.chosenOS = chosenOS;
    root.targetOS = targetOS;
    root.setTargetOS = setTargetOS;
    root.clearTargetOS = clearTargetOS;

})(typeof window !== 'undefined' ? window : this);
