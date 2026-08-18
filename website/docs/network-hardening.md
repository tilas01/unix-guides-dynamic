# Network Security for the Security Tools

How the tools in this project talk to the network, and why. This covers the
update checks, the release downloads and the alert webhooks — every point where
one of these tools reaches off the machine and could be attacked in transit.

---

## A correction worth stating up front

The goal was described as "post-quantum + AES + RSA-GCM on top". Two parts of
that need adjusting, because implementing it literally would make things *worse*:

**"RSA-GCM" is not a construction.** GCM is a mode for symmetric block ciphers —
AES-GCM is real, RSA-GCM is not. RSA is an asymmetric algorithm used for key
exchange or signatures. They are not layered like that.

**Do not add your own crypto layer on top of TLS.** It is intuitive that two
layers must be stronger than one, but in practice a hand-rolled outer layer
almost always ends up being the weak link: nonce reuse, no authentication of the
handshake, no forward secrecy, no replay protection. Every serious protocol
failure of the last twenty years has been in bespoke glue, not in AES.

What actually delivers the intent — post-quantum resistance, strong symmetric
encryption, and no MITM — is a correctly configured **TLS 1.3 with a hybrid
post-quantum key exchange, plus signature verification of the payload itself**.
That is what is specified below.

RSA is not used anywhere. Ed25519 signatures are smaller, faster and have no
padding-oracle history. Where a signature is needed, that is what is used.

---

## The layers, and what each one defends against

| Layer | Mechanism | Defends against |
|---|---|---|
| Key exchange | **X25519MLKEM768** (hybrid) | A recorded session being decrypted later by a quantum computer ("harvest now, decrypt later") |
| Transport | **TLS 1.3 only**, AES-256-GCM or ChaCha20-Poly1305 | Passive interception, tampering in transit |
| Endpoint identity | **Certificate pinning** (SPKI hash) | A MITM holding a valid certificate from *any* trusted CA |
| Payload integrity | **Ed25519 signature + SHA-512** | A compromised CDN or mirror serving a modified binary |
| Replay | Monotonic counter in webhook payloads | An attacker re-sending a captured "all clear" |

Note the layering that matters: TLS protects the *channel*, and the Ed25519
signature protects the *content*. Compromising the channel does not let an
attacker substitute a binary, because the signature is verified independently of
how the bytes arrived. That is the property worth having, and it is why TLS plus
payload signing is the right pair rather than TLS plus more TLS.

---

## Post-quantum key exchange

Use the hybrid group `X25519MLKEM768`. Hybrid means the shared secret is derived
from **both** X25519 and ML-KEM-768 (the standardised form of Kyber), so it stays
secure if *either* one holds. That matters because ML-KEM is comparatively new; a
pure post-quantum exchange would be a bet that no classical break appears.

```
# OpenSSL 3.5+
openssl s_client -groups X25519MLKEM768 -connect api.github.com:443

# curl, when built against a PQ-capable TLS backend
curl --curves X25519MLKEM768 https://api.github.com
```

In Rust, `rustls` with the `prefer-post-quantum` feature negotiates this
automatically and falls back cleanly when the server does not support it:

```toml
[dependencies]
rustls = { version = "0.23", features = ["prefer-post-quantum"] }
```

Signatures are a different problem and are **not** yet post-quantum here. ML-DSA
exists but tooling support is thin, and a signature only needs to resist forgery
*at verification time*, not decades later — unlike a recorded key exchange. This
is a deliberate, revisitable decision, not an oversight.

---

## Certificate pinning

TLS on its own answers "is this a valid certificate for this name?" — any of the
hundreds of trusted CAs can answer yes. Pinning answers the narrower question:
"is this *our* key?"

Pin the **SPKI hash**, not the certificate. Certificates rotate on renewal; the
public key usually does not, so pinning the certificate breaks every 90 days.

```bash
# Compute the pin for an endpoint
openssl s_client -connect api.github.com:443 -servername api.github.com < /dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64
```

Store pins in `/etc/arch-security/tls-pins.conf`, mode `600`:

```ini
# host = base64(sha256(SPKI))
api.github.com      = <pin>
objects.githubusercontent.com = <pin>
# Keep a backup pin for the next key, or rotation locks you out of updates.
api.github.com.backup = <pin>
```

**Always ship a backup pin.** Pinning a single key means that when it rotates,
your tools can no longer reach the update endpoint — and a security tool that
cannot update is a liability. Fail closed on a pin mismatch, but make sure there
is a documented way to re-pin from a known-good machine.

---

## Verifying downloads

Never trust the transport alone.

```bash
curl --proto '=https' --tlsv1.3 -fsSLO "$URL"          # 1. TLS 1.3 only
sha512sum -c "$FILE.sha512"                            # 2. integrity
gpg --verify "$FILE.sig" "$FILE"                       # 3. authenticity
```

`--proto '=https'` matters: without it, a redirect to `http://` is followed
silently and the whole thing is moot.
[`scripts/install-security-suite.sh`](../scripts/install-security-suite.sh) does
all three and fails closed.

---

## Webhook alerts

The tools can send alerts (ntfy, Discord, Slack). Points to get right:

* **HTTPS only, TLS 1.3 minimum.** Reject plain HTTP at config time, not request time.
* **Do not put the token in the URL.** URLs end up in shell history, `ps` output and logs. Use an `Authorization` header from a `600` config file.
* **Include a monotonic counter and a timestamp**, so a replayed "all clear" is detectable.
* **Assume the body is public.** Alert on *what* happened, never with keys, hashes of secrets, or file contents.
* **Fail quietly outward, loudly locally.** If a webhook cannot be delivered, log it locally and keep going — a failing webhook must not prevent a local alert from being shown.

```bash
curl --proto '=https' --tlsv1.3 \
     --max-time 10 --retry 2 \
     -H "Authorization: Bearer $(cat /etc/arch-security/webhook.token)" \
     -H "Content-Type: application/json" \
     -d "{\"seq\":$SEQ,\"ts\":\"$(date -Is)\",\"event\":\"boot_integrity_failed\"}" \
     "$WEBHOOK_URL"
```

---

## What this does *not* protect against

Being honest about the boundary is part of the design:

* **A compromised local machine.** If malware is already running as root, it can read the pins, the tokens and the plaintext before TLS sees it. Network hardening is not endpoint security.
* **Firmware-level attackers.** See [Hardware & Firmware Security](https://tilas01.github.io/Unix-SIT/wiki.html#hardware-security). Everything here runs after the firmware.
* **A compromised signing key.** If the project's key leaks, signatures made with it mean nothing until it is revoked and replaced.
* **Traffic analysis.** TLS hides content, not the fact that you contacted an endpoint or how much you sent.

---

## Checklist

- [ ] TLS 1.3 only; TLS 1.2 and below refused
- [ ] `X25519MLKEM768` hybrid key exchange preferred, graceful fallback
- [ ] AES-256-GCM or ChaCha20-Poly1305 only
- [ ] SPKI pins for every endpoint, plus a backup pin
- [ ] `--proto '=https'` on every curl, so redirects cannot downgrade
- [ ] Ed25519 signature and SHA-512 verified on every downloaded binary
- [ ] Tokens in headers from `600` files, never in URLs
- [ ] Replay counter on webhook payloads
- [ ] No secrets in alert bodies
- [ ] Pin mismatch fails closed, with a documented re-pin path
