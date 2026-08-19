#!/usr/bin/env python3
"""
Build the site-wide search index.

The index is generated here rather than assembled in the browser. A page that
fetches eight HTML files and parses them on every visit is slow, fails offline,
and re-does identical work for every visitor; a JSON file built once is none of
those things. Run from the repository root:

    python scripts/gen-search-index.py

Sources
  website/*.html        headings that carry an id, plus the page itself
  website/manual-data.js  every walkthrough question, its help text and its
                          answer options
  docs/**/*.md          headings, linked to the published copy

Output
  website/search-index.json   [{t: title, u: url, s: section, d: description}]

Deterministic: entries are emitted in a stable order, so re-running it produces
no diff unless the content actually changed.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys

PAGE_TITLES = {
    "index.html": "Generator",
    "manual.html": "Manual walkthrough",
    "wiki.html": "Wiki",
    "iso-verify.html": "Verify an ISO",
    "security-tools.html": "Security tools",
    "live.html": "Live editor",
    "releases.html": "Releases",
    "repo.html": "Repository",
    "site-index.html": "Index",
    "home.html": "Home",
}

# Pages whose headings are navigation furniture rather than content.
SKIP_PAGES = {"site-index.html", "upload.html"}

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def text_of(fragment: str) -> str:
    """Strip tags and collapse whitespace, then unescape entities."""
    return WS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", fragment))).strip()


def snippet(body: str, start: int, limit: int = 180) -> str:
    """A short plain-text description taken from just after a heading."""
    chunk = body[start:start + 2500]
    # Drop script and style blocks before flattening, or their source leaks in.
    chunk = re.sub(r"<(script|style)\b.*?</\1>", " ", chunk, flags=re.S | re.I)
    # First paragraph-ish run of text after the heading.
    m = re.search(r"<p[^>]*>(.*?)</p>", chunk, re.S | re.I)
    text = text_of(m.group(1)) if m else text_of(chunk)
    return (text[:limit].rstrip() + "…") if len(text) > limit else text


def index_html(web: str) -> list[dict]:
    out = []
    for name in sorted(os.listdir(web)):
        if not name.endswith(".html") or name in SKIP_PAGES:
            continue
        page = PAGE_TITLES.get(name, name[:-5].replace("-", " ").title())
        body = open(os.path.join(web, name), encoding="utf-8").read()

        # The page itself.
        desc = ""
        m = re.search(r'<meta name="description" content="([^"]*)"', body)
        if m:
            desc = html.unescape(m.group(1))
        out.append({"t": page, "u": name, "s": "Page", "d": desc})

        # Headings that carry an id, so they can be linked to directly.
        for m in re.finditer(
                r'<(h[1-4])\b([^>]*)>(.*?)</\1>', body, re.S | re.I):
            attrs, inner = m.group(2), m.group(3)
            idm = re.search(r'id="([^"]+)"', attrs)
            if not idm:
                # A heading inside a section that has the id is still linkable.
                sec = body.rfind('<div class="section" id="', 0, m.start())
                sec2 = body.rfind('<section', 0, m.start())
                pos = max(sec, sec2)
                if pos == -1:
                    continue
                idm = re.search(r'id="([^"]+)"', body[pos:pos + 220])
                if not idm:
                    continue
            title = text_of(inner)
            if not title or len(title) < 3:
                continue
            out.append({
                "t": title,
                "u": f"{name}#{idm.group(1)}",
                "s": page,
                "d": snippet(body, m.end()),
            })
    return out


def index_manual(web: str) -> list[dict]:
    """Every walkthrough question, so searching for "swap" finds the question
    that asks about it and not only the wiki section that explains it."""
    path = os.path.join(web, "manual-data.js")
    if not os.path.isfile(path):
        return []
    src = open(path, encoding="utf-8").read()
    out = []
    for m in re.finditer(
            r"\{\s*\n\s*id:\s*'([a-z0-9_]+)',"        # id
            r".*?title:\s*'((?:[^'\\]|\\.)*)'"          # title
            r".*?wiki:\s*'([a-z0-9-]+)'", src, re.S):
        qid, title, wiki = m.group(1), m.group(2), m.group(3)
        title = title.replace("\\'", "'")
        # Pull the help text that follows, for the description.
        help_m = re.search(r"help:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+)",
                           src[m.start():m.start() + 3000], re.S)
        desc = ""
        if help_m:
            parts = re.findall(r"'((?:[^'\\]|\\.)*)'", help_m.group(1))
            desc = " ".join(p.replace("\\'", "'") for p in parts).strip()
        out.append({
            "t": title,
            "u": f"manual.html#q-{qid}",
            "s": "Manual walkthrough",
            "d": desc[:200],
        })
    return out


def doc_slug(text: str) -> str:
    """The anchor markdown.js will actually give this heading.

    It has to agree with `slug()` in website/markdown.js character for
    character, including the 60-character truncation and the fact that `\\w`
    keeps underscores. An anchor generated by a different rule points at an id
    that is never minted, and the fragment silently does nothing.

    re.ASCII matters: a JavaScript `\\w` without the `u` flag is [A-Za-z0-9_],
    while Python's default `\\w` also matches accented letters. Without it, a
    heading containing one would slug differently in the two languages.
    """
    s = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.ASCII).strip()
    return re.sub(r"\s+", "-", s, flags=re.ASCII)[:60]


def doc_title(rel: str) -> str:
    """A readable name for a document, from its path.

    Mirrors what wiki.html's ?page= handler puts in its breadcrumb, so the
    search result and the page it opens agree about what the document is
    called.
    """
    stem = os.path.basename(rel)[:-3]
    stem = re.sub(r"^\d+-", "", stem).replace("-", " ").replace("_", " ")
    return stem[:1].upper() + stem[1:]


def first_h1(body: str) -> str:
    for line in body.split("\n"):
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def index_docs(web: str) -> list[dict]:
    """Index the documents the site actually serves.

    website/docs/ is the published tree and what wiki.html's ?page= handler
    resolves against. docs/ at the repository root is mirrored into it at deploy
    time with `cp -rn`, so where the two differ the website copy is the one
    readers get — indexing the root copy described headings the published
    document does not have, and missed the ones it does.
    """
    out = []
    docs = os.path.join(web, "docs")
    if not os.path.isdir(docs):
        return out

    md = []
    for dirpath, _dirnames, filenames in os.walk(docs):
        for fn in sorted(filenames):
            if fn.endswith(".md"):
                md.append(os.path.join(dirpath, fn))
    md.sort()

    bodies = {f: open(f, encoding="utf-8", errors="replace").read() for f in md}

    # Most documents here open with the same site banner as their H1, and the
    # generated examples share a second one. Taking the first heading therefore
    # produced whole runs of results carrying one indistinguishable title.
    # An H1 used by more than one document does not identify a document, so
    # those fall back to the path. Counting rather than naming the banners keeps
    # this true when another shared header appears.
    h1_count: dict[str, int] = {}
    for f in md:
        h = first_h1(bodies[f])
        if h:
            h1_count[h] = h1_count.get(h, 0) + 1

    for full in md:
        # The ?page= handler resolves against website/docs/, so the parameter is
        # the path relative to it.
        page = os.path.relpath(full, docs).replace(os.sep, "/")
        rel = "docs/" + page
        # Rendered inside the wiki rather than served as a file. A result
        # linking straight at the .md hands the reader raw markdown with no
        # navigation and no way back, which is the defect the ?page= handler was
        # written to fix.
        url = "wiki.html?page=" + page
        body = bodies[full]
        lines = body.split("\n")
        title = first_h1(body)
        if not title or h1_count.get(title, 0) > 1:
            title = doc_title(rel)
        out.append({"t": title, "u": url, "s": "Docs",
                    "d": next((l.strip() for l in lines
                               if l.strip() and not l.startswith(("#", "<", "!", "|"))), "")[:180]})
        for i, line in enumerate(lines):
            if re.match(r"^#{2,3} ", line):
                heading = line.lstrip("# ").strip()
                # `headingPrefix: 'doc-'` is passed by the wiki handler.
                anchor = "doc-" + doc_slug(heading)
                desc = next((l.strip() for l in lines[i + 1:i + 8]
                             if l.strip() and not l.startswith(("#", "|", "```"))), "")
                out.append({"t": heading, "u": f"{url}#{anchor}",
                            "s": f"Docs · {title}", "d": desc[:180]})
    return out


# Which system an entry belongs to, when that can be told from where it lives.
#
# Deliberately conservative. An entry is tagged only when its path or its title
# names a system outright; everything else stays untagged and is shown whatever
# is selected. The failure to avoid is hiding a page from the reader who needed
# it, and most of this site is shared between systems — partitioning, dual
# boot, the security tools, the wiki's hardware sections. Guessing that the
# numbered install tree is "Arch only" would hide the only partitioning
# reference the project has from four systems out of five.
#
# Keys are the ids in website/os-meta.js. tests/search-scope.mjs checks they
# still are.
OS_MARKERS = (
    ("gentoo", ("/gentoo/", "gentoo-commands", "gentoo/")),
    # Not "raspberry": examples/09-arm-raspberry-pi.md is Arch Linux ARM on Pi
    # hardware, which is a different system from Raspberry Pi OS and would be
    # hidden from the Arch reader it was written for.
    ("raspios", ("/raspios/", "raspios-commands", "raspios/")),
    ("freebsd", ("/freebsd/", "freebsd-commands", "freebsd/")),
    ("openbsd", ("/openbsd/", "openbsd-commands", "openbsd/")),
    ("arch", ("arch-commands", "/arch/")),
)


def tag_os(entry: dict) -> str | None:
    """The system an entry is specific to, or None when it is shared."""
    hay = (entry.get("u", "") + " " + entry.get("t", "")).lower()
    for os_id, markers in OS_MARKERS:
        if any(m in hay for m in markers):
            return os_id
    return None


def main() -> int:
    # Section names contain emoji, and a Windows console defaults to cp1252,
    # which cannot encode them — the summary at the end would crash the script
    # after it had already written its output. Reconfigure rather than strip.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    web = os.path.join(root, "website")

    entries = index_html(web) + index_manual(web) + index_docs(web)

    # De-duplicate by URL, keeping the first (page-level) entry.
    seen, unique = set(), []
    for e in entries:
        if e["u"] in seen:
            continue
        seen.add(e["u"])
        unique.append(e)

    # `o` only where it could be determined, so the common case costs no bytes
    # and an untagged entry is unambiguously "shared" rather than "unknown".
    for e in unique:
        os_id = tag_os(e)
        if os_id:
            e["o"] = os_id

    unique.sort(key=lambda e: (e["s"], e["t"]))

    out = os.path.join(web, "search-index.json")
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(unique, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    size = os.path.getsize(out)
    print(f"wrote {len(unique)} entries to website/search-index.json ({size:,} bytes)")
    by_section: dict[str, int] = {}
    for e in unique:
        by_section[e["s"]] = by_section.get(e["s"], 0) + 1
    for k in sorted(by_section):
        print(f"  {by_section[k]:4d}  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
