/* Encrypted-DNS upstreams, shared by both front ends.
 *
 * Previously a `const DNS_PROVIDERS` private to `manual-guide.js`, which is why
 * the *nix Install Generator had no encrypted DNS at all: the table, and the
 * emission that used it, only existed on one side. Duplicating it here would
 * have left two tables to keep in step — the usual outcome being one updated
 * and the other quietly left behind. One table, two readers.
 *
 * Addresses and DoT hostnames come from each provider's own documentation. The
 * second address in each list is that provider's *secondary* resolver, never a
 * different operator — mixing them would hand a share of queries to whoever the
 * fallback belongs to, which defeats the point of choosing.
 *
 * ── The part that matters ──────────────────────────────────────────────────
 *
 * `DNSOverTLS=yes` on its own encrypts the query and does **not** authenticate
 * the server. Anyone able to answer on port 853 is then trusted — and on a
 * hostile network, that is the network. Encryption without authentication buys
 * very little here, and it is a common way DoT setups end up quietly useless.
 *
 * What fixes it is `systemd-resolved`'s `address#hostname` form:
 *
 *     DNS=9.9.9.9#dns.quad9.net
 *
 * The part after `#` is the name the server's certificate must match. Without
 * it resolved will accept any certificate that chains to a trusted root, which
 * an attacker holding any valid certificate can produce. `buildResolvedConf`
 * below always emits the pinned form; there is no code path that emits a bare
 * address, deliberately.
 */
(function (root) {
    'use strict';

    var DNS_PROVIDERS = {
        quad9:      { label: 'Quad9',        v4: ['9.9.9.9', '149.112.112.112'],
                      v6: ['2620:fe::fe', '2620:fe::9'], tls: 'dns.quad9.net' },
        mullvad:    { label: 'Mullvad DNS',  v4: ['194.242.2.2'],
                      v6: ['2a07:e340::2'], tls: 'dns.mullvad.net' },
        cloudflare: { label: 'Cloudflare',   v4: ['1.1.1.1', '1.0.0.1'],
                      v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'],
                      tls: 'cloudflare-dns.com' },
        dns0:       { label: 'dns0.eu',      v4: ['193.110.81.0', '185.253.5.0'],
                      v6: ['2a0f:fc80::', '2a0f:fc81::'], tls: 'dns0.eu' },
        adguard:    { label: 'AdGuard DNS',  v4: ['94.140.14.14', '94.140.15.15'],
                      v6: ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'],
                      tls: 'dns.adguard-dns.com' }
    };

    /**
     * The `DNS=` line, with every address pinned to the provider's certificate
     * name.
     *
     * @param {object} prov  an entry from DNS_PROVIDERS
     * @param {string} mode  'both' (default) or 'ipv4' — IPv4 only
     */
    function dnsLine(prov, mode) {
        // IPv4-only is offered because handing a v6 server to a network with no
        // working v6 does not fail cleanly: resolution goes intermittent while
        // resolved tries an address that will never answer, which reads as "DNS
        // is broken" rather than "there is no v6 here".
        var addrs = mode === 'ipv4' ? prov.v4.slice() : prov.v4.concat(prov.v6);
        return 'DNS=' + addrs.map(function (a) {
            return a + '#' + prov.tls;
        }).join(' ');
    }

    /** The full drop-in, identical for both front ends. */
    function buildResolvedConf(prov, mode) {
        return [
            '[Resolve]',
            dnsLine(prov, mode),
            // Empty on purpose. systemd ships built-in fallbacks that belong to
            // *other* providers, so leaving this unset quietly sends a share of
            // queries to whoever those are — which is the opposite of picking a
            // resolver. Empty means "fail rather than ask a stranger".
            'FallbackDNS=',
            'DNSOverTLS=yes',
            'DNSSEC=yes'
        ];
    }

    /**
     * The same upstreams for a system with no systemd-resolved.
     *
     * An OpenRC machine has no `resolved` to configure, so a drop-in written
     * there is a file nothing reads — encrypted DNS that is configured, looks
     * configured, and never runs. Stubby is the equivalent daemon: it listens on
     * localhost and forwards over TLS, and `tls_auth_name` is its spelling of
     * the certificate pin that `address#hostname` provides on the other side.
     * Without that field stubby will accept any certificate chaining to a
     * trusted root, which is the same quiet failure.
     *
     * @param {object} prov  an entry from DNS_PROVIDERS
     * @param {string} mode  'both' (default) or 'ipv4' — IPv4 only
     */
    function buildStubbyConf(prov, mode) {
        var addrs = mode === 'ipv4' ? prov.v4.slice() : prov.v4.concat(prov.v6);
        var out = [
            'resolution_type: GETDNS_RESOLUTION_STUB',
            'dns_transport_list:',
            '  - GETDNS_TRANSPORT_TLS',
            // Refuse to fall back to plaintext. The default list continues to
            // UDP when TLS fails, which turns an unreachable resolver into a
            // silent downgrade rather than an error.
            'tls_authentication: GETDNS_AUTHENTICATION_REQUIRED',
            'tls_query_padding_blocksize: 128',
            'idle_timeout: 10000',
            'listen_addresses:',
            '  - 127.0.0.1@53',
            '  - 0::1@53',
            'upstream_recursive_servers:'
        ];
        addrs.forEach(function (a) {
            out.push('  - address_data: ' + a);
            out.push('    tls_auth_name: "' + prov.tls + '"');
        });
        return out;
    }

    root.DnsProviders = {
        table: DNS_PROVIDERS,
        dnsLine: dnsLine,
        buildResolvedConf: buildResolvedConf,
        buildStubbyConf: buildStubbyConf
    };
})(typeof window !== 'undefined' ? window : globalThis);
