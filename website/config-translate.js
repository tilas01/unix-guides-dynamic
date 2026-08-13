/* ============================================================================
   config-translate.js — make one saved config work in either front end.
   ----------------------------------------------------------------------------
   The *nix Install Generator and the *nix Install Walkthrough are, deliberately, two
   separate tools with their own pages and their own option sets. They already
   share a JSON envelope:

       { schema, version, source, created, answers: { … } }

   but until now the `answers` inside were shaped differently and had no keys in
   common, so a config exported from one configured nothing in the other:

       generator    { selects:{firmware:…}, inputs:{…}, checkboxes:{…} }   (DOM-shaped)
       walkthrough  { firmware:…, disk:…, encryption:… }                  (flat)

   This module translates between the two. It is a *mapping*, not a merge —
   neither tool changes, and each keeps options the other does not have.

   Design rules, in order of importance:

     1. **Never invent an answer.** A field the source config did not specify is
        left unset rather than defaulted, so translating cannot silently change
        what someone chose. Unmapped keys are reported, not dropped quietly.

     2. **Never translate a destructive setting into a different one.** Where
        the two tools' vocabularies do not line up exactly (LUKS variants, the
        duress actions), the mapping is explicit and conservative: if there is
        no exact equivalent, the field is left unset so the target tool asks
        again, rather than guessing at something that repartitions a disk.

     3. **Round-trip stability.** translate(translate(x)) must equal
        translate(x) for every mapped field. Covered by tests.
   ========================================================================= */

'use strict';

(function (root) {

    /* ── Field map ───────────────────────────────────────────────────────────
       walkthrough key  ->  { gen: <generator control id>, group: selects|inputs
                              |checkboxes, values?: {walkthrough: generator} } */
    var MAP = [
        { wl: 'firmware',       gen: 'firmware',        group: 'selects' },
        { wl: 'filesystem',     gen: 'filesystem',      group: 'selects' },
        { wl: 'disk',           gen: 'target-disk',     group: 'inputs'  },
        /* Dual boot. The ids match on both sides, so no value table is needed —
           and carrying these across matters more than most: a config that loses
           `dualboot` on the way into the generator turns a "keep Windows"
           install into a whole-disk wipe. */
        { wl: 'timezone',       gen: 'timezone',        group: 'inputs'  },
        { wl: 'locale',         gen: 'locale',          group: 'selects' },
        { wl: 'keymap',         gen: 'keymap',          group: 'selects' },
        { wl: 'dualboot',           gen: 'dualboot',           group: 'selects' },
        { wl: 'dualboot_esp_mode',  gen: 'dualboot_esp_mode',  group: 'selects' },
        { wl: 'dualboot_esp',       gen: 'dualboot_esp',       group: 'inputs'  },
        { wl: 'bootloader',     gen: 'bootloader',      group: 'selects' },
        { wl: 'desktop',        gen: 'desktop',         group: 'selects' },
        { wl: 'display_server', gen: 'display_server',  group: 'selects' },
        { wl: 'firewall',       gen: 'firewall',        group: 'selects' },
        { wl: 'swap',           gen: 'swap_size',       group: 'selects' },
        { wl: 'microcode',      gen: 'cpu_brand',       group: 'selects',
          values: { 'intel-ucode': 'intel', 'amd-ucode': 'amd', 'none': 'none' } },
        { wl: 'libre',          gen: 'software_type',   group: 'selects',
          values: { 'yes': 'libre', 'no': 'proprietary' } },
        // Encryption: the generator's `partitioning` select carries the LUKS
        // choice. Only exact equivalents are mapped — anything else is left for
        // the target tool to ask about rather than guessed at, because this
        // decides whether a disk gets encrypted.
        { wl: 'encryption',     gen: 'partitioning',    group: 'selects',
          values: { 'luks2': 'luks2', 'luks1': 'luks1', 'none': 'unencrypted' } },
        { wl: 'apps',           gen: 'post_apps',       group: 'checkboxes' },
        // Wallpapers. The ids and the option values are deliberately identical
        // on both sides, so there is nothing to translate — which is the point:
        // a value map is a place for the two to disagree.
        { wl: 'wallpapers',       gen: 'wallpapers',       group: 'selects' },
        { wl: 'wallpaper_count',  gen: 'wallpaper_count',  group: 'selects' },
        { wl: 'wallpaper_split',  gen: 'wallpaper_split',  group: 'selects' },

        /* Gentoo's own five. Identical ids and identical option values on both
           sides, on purpose — a value table here would be somewhere for the two
           to disagree about what "half the cores" means, and these decide how
           the machine is built rather than how it looks. They carry across even
           when the target is not Gentoo, so a config exported from a Gentoo
           session survives being opened, read and saved elsewhere. */
        { wl: 'gentoo_stage3',    gen: 'gentoo_stage3',    group: 'selects' },
        { wl: 'gentoo_kernel',    gen: 'gentoo_kernel',    group: 'selects' },
        { wl: 'gentoo_binpkgs',   gen: 'gentoo_binpkgs',   group: 'selects' },
        { wl: 'gentoo_makeopts',  gen: 'gentoo_makeopts',  group: 'selects' },
        { wl: 'gentoo_use',       gen: 'gentoo_use',       group: 'selects' },

        /* Duress PINs. The two front ends model this differently and only three
           states have an exact equivalent, so only those three are carried.
           `wlIsList` says the walkthrough side is an array of one.

           The walkthrough sets up to three *separate passwords*, one per
           behaviour. The generator picks one action for one password. So
           "duress and decoy, as two different PINs" has no generator
           equivalent, and the generator's "shutdown" has no walkthrough one —
           both are reported as unmapped rather than approximated. Guessing here
           would silently change what a password does under coercion. */
        // Auto-lock and the Anti-Ducky response. Same ids and same option
        // values on both sides, so there is nothing to translate and no value
        // map for the two to disagree in.
        { wl: 'luks_autolock',  gen: 'modal_aem_autolock', group: 'selects' },
        { wl: 'ducky_response', gen: 'ducky_response',     group: 'selects' },
        { wl: 'luks_lock_on_screen', gen: 'modal_aem_lock_on_screen', group: 'selects' },
        // Encrypted DNS. Same ids and same option values on both sides now
        // that dns-providers.js is shared, so there is nothing to translate.
        { wl: 'dns_provider',   gen: 'dns_provider',   group: 'selects' },
        { wl: 'dns_ipv4_only',  gen: 'dns_ipv4_only',  group: 'selects' },
        // Free text on both sides — a space-separated package list. Carried
        // verbatim: neither front end is in a position to decide that one of
        // these names is wrong, and both emit the same on-machine check.
        { wl: 'extra_packages', gen: 'extra_packages',     group: 'inputs' },

        /* Scarecrow's three PINs. Now a straight pair with no value table:
           both front ends use the same id, the same three values, and the same
           "tick any combination" model.

           This used to map `duress_pins` onto the generator's
           `luks_duress_action` select, which was wrong in a way worth
           recording. Those are two DIFFERENT mechanisms at two different
           layers — `luks_duress_action` is an initramfs hook firing at the boot
           passphrase prompt, while these PINs are checked at the login prompt
           after the disk is already unlocked. Mapping one onto the other
           silently moved a duress response from one layer to the other, and
           could only ever carry one of the three states because a select holds
           one value. The generator now has the same three independent
           checkboxes the walkthrough has. */
        { wl: 'duress_pins', gen: 'duress_pins', group: 'checkboxes' }
    ];

    function invert(values) {
        if (!values) return null;
        var out = {};
        Object.keys(values).forEach(function (k) { out[values[k]] = k; });
        return out;
    }

    /** Is this a generator-shaped answers object? */
    function isGeneratorShape(a) {
        return !!(a && typeof a === 'object' &&
                  (a.selects || a.inputs || a.checkboxes));
    }

    /**
     * Generator answers -> walkthrough answers.
     * Returns { answers, mapped, unmapped } so a caller can tell the user what
     * did and did not carry over instead of implying a clean import.
     */
    function generatorToWalkthrough(gen) {
        var out = {}, mapped = [], unmapped = [];
        var selects = (gen && gen.selects) || {};
        var inputs = (gen && gen.inputs) || {};
        var checks = (gen && gen.checkboxes) || {};

        MAP.forEach(function (m) {
            var src = m.group === 'selects' ? selects
                    : m.group === 'inputs'  ? inputs : checks;
            if (!Object.prototype.hasOwnProperty.call(src, m.gen)) return;
            var v = src[m.gen];
            if (v === '' || v === undefined || v === null) return;
            if (m.values) {
                var back = invert(m.values);
                if (!Object.prototype.hasOwnProperty.call(back, v)) {
                    // No exact equivalent: leave unset so the walkthrough asks.
                    unmapped.push(m.gen + '=' + v);
                    return;
                }
                v = back[v];
            }
            out[m.wl] = m.wlIsList ? [v] : v;
            mapped.push(m.wl);
        });

        // Anything the generator held that has no walkthrough equivalent.
        Object.keys(selects).forEach(function (k) {
            if (!MAP.some(function (m) { return m.gen === k; })) unmapped.push(k);
        });

        return { answers: out, mapped: mapped, unmapped: unmapped };
    }

    /** Walkthrough answers -> generator answers (DOM-shaped). */
    function walkthroughToGenerator(wl) {
        var out = {
            version: 2,
            generator: 'unix-guides-dynamic',
            schema: 'unix-guides-dynamic/config',
            selects: {}, inputs: {}, checkboxes: {}
        };
        var mapped = [], unmapped = [];

        MAP.forEach(function (m) {
            if (!Object.prototype.hasOwnProperty.call(wl, m.wl)) return;
            var v = wl[m.wl];
            if (v === '' || v === undefined || v === null) return;
            if (m.wlIsList) {
                // A list the generator can only express as one value. Empty is
                // simply "not set"; more than one has no equivalent at all, and
                // picking one of them would silently change what a password
                // does under coercion.
                if (!Array.isArray(v) || v.length === 0) return;
                if (v.length > 1) {
                    unmapped.push(m.wl + '=[' + v.join(',') + '] (generator holds one action)');
                    return;
                }
                v = v[0];
            }
            if (m.values) {
                if (!Object.prototype.hasOwnProperty.call(m.values, v)) {
                    unmapped.push(m.wl + '=' + v);
                    return;
                }
                v = m.values[v];
            }
            out[m.group][m.gen] = v;
            mapped.push(m.gen);
        });

        Object.keys(wl).forEach(function (k) {
            if (!MAP.some(function (m) { return m.wl === k; })) unmapped.push(k);
        });

        return { answers: out, mapped: mapped, unmapped: unmapped };
    }

    /**
     * Translate a full envelope for a target tool. Returns the envelope
     * unchanged when it is already the right shape, so calling this
     * unconditionally on import is safe.
     *
     * @param {object} envelope  {schema,version,source,created,answers}
     * @param {'dynamic-generator'|'manual-walkthrough'} target
     */
    function translateEnvelope(envelope, target) {
        var answers = (envelope && envelope.answers) ? envelope.answers : envelope;
        var isGen = isGeneratorShape(answers);
        var wantGen = target === 'dynamic-generator';

        if (isGen === wantGen) {
            return { answers: answers, mapped: [], unmapped: [], translated: false };
        }
        var r = isGen ? generatorToWalkthrough(answers)
                      : walkthroughToGenerator(answers);
        r.translated = true;
        return r;
    }

    var API = {
        MAP: MAP,
        isGeneratorShape: isGeneratorShape,
        generatorToWalkthrough: generatorToWalkthrough,
        walkthroughToGenerator: walkthroughToGenerator,
        translateEnvelope: translateEnvelope
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    root.ConfigTranslate = API;

})(typeof window !== 'undefined' ? window : globalThis);
