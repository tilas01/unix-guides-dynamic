# User agreements

The two things the website asks you to agree to, kept here as **plain text** so
they can be read, quoted, diffed and archived without running any JavaScript —
and so the welcome dialog has a stable, permanent thing to link to.

| File | What it is |
|---|---|
| [`LEGAL-WAIVER.txt`](LEGAL-WAIVER.txt) | The disclaimer and liability waiver. The authoritative version of the text shown in the welcome dialog. |
| [`LICENSE.txt`](LICENSE.txt) | The repository licence, CC BY-NC-SA 4.0. Byte-identical to [`../../LICENSE`](../../LICENSE); CI fails if the two drift apart. |
| [`LICENCE-PLAIN-ENGLISH.txt`](LICENCE-PLAIN-ENGLISH.txt) | What the licence means in ordinary words, and why it is that licence. A summary, not a substitute — `LICENSE.txt` is the licence. |

## Where these are served

They live inside `website/`, which *is* the published artifact — so there is one
copy, not a build-time duplicate that can go stale, and both of these resolve:

- <https://tilas01.github.io/Unix-SIT/user-agreements/LEGAL-WAIVER.txt>
- <https://github.com/tilas01/Unix-SIT/blob/main/website/user-agreements/LEGAL-WAIVER.txt>

The welcome dialog links to the site-hosted copies, so the text a visitor agrees
to comes from the same deployment they are looking at rather than from whatever
happens to be on `main` at the time.

## Changing them

All three are versioned in git; the history is the record of what was in force
when. Edit `../../LICENSE` and re-copy rather than editing `LICENSE.txt`
directly — the pre-publish check diffs them and refuses to deploy if they
differ.
