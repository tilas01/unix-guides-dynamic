# Roadmap

What is built, what is being built, and what has not been started. Kept honest
on purpose: a roadmap that lists everything as "in progress" tells a reader
nothing, and this project's own worst defects have all been features that
looked finished.

**Last updated: 2026-09-09.**

---

## The measure

A system is finished when its guide prints **none of another system's
tooling**. That number is produced by the test suite on every run, and it is
the only thing on this page that cannot be talked up:

| System | Foreign tooling in its output | Selectable |
|---|---|---|
| Arch Linux | none | **yes** |
| Gentoo | none | not yet — no documentation of its own |
| Raspberry Pi OS | none | not yet — no documentation of its own |
| FreeBSD | `pacstrap`, `pacman`, `paru`, `mkinitcpio` | no |
| OpenBSD | `pacstrap`, `pacman`, `paru`, `mkinitcpio` | no |

A system that cannot be selected is still listed on the site and still
readable. It cannot be *chosen*, because a guide that prints another system's
commands under this system's name is worse than no guide at all — the reader
acts on it either way.

---

## Now

**Arch Linux, finished properly, as the template for everything else.**

- [ ] The walkthrough made an exact counterpart of the generator — same
      options, one question at a time, with links to this wiki and the Arch
      Wiki at each one
- [ ] One Dusky selection rather than several
- [ ] No locked control able to block generation
- [ ] `pfetch` against `fastfetch`, explained where the choice is made
- [ ] A notice when two file managers are selected, rather than quietly
      installing both

**Identity and the way in.**

- [x] Repository renamed, and every link in the site and the guides moved with
      it
- [x] Search narrows to the selected system, with a visible way to see what was
      held back
- [ ] Terms, then straight to a homepage that only chooses a system and
      searches everything
- [ ] Animated pixel-art penguin; a per-system animation under the banner

## Next

**Distribution and init, which cuts across every Linux system.**

- [ ] **Void Linux**: `xbps`, runit, musl or glibc
- [ ] **A Void-shaped Arch**: runit in place of systemd, and the rest of the
      choices that keep it lean — with anything that genuinely cannot work that
      way named rather than offered
- [ ] `xbps` against `pacman`, explained for somebody arriving from Arch
- [ ] Arch derivatives, including Omarchy, with honest descriptions
- [ ] Window managers, bars, launchers and terminals, and pointing each at your
      own dotfiles the way that program's own documentation says to

**Then, in order:** Gentoo to selectable, OpenBSD, FreeBSD, Raspberry Pi OS.

## Later

- [ ] A separate route for **hardening a system you already have**, rather than
      installing one — where Raspberry Pi OS, NixOS and Omarchy fit better than
      in an install flow
- [ ] Per-system wiki and documentation at Arch's depth
- [ ] Reproducible builds for the Rust tools, verified during the build rather
      than asserted afterwards
- [ ] A no-JavaScript version of the whole site

---

## Not started, and honestly so

- FreeBSD and OpenBSD install models. Both still produce Arch's commands under
  a caution banner that says exactly that.
- Documentation trees for Gentoo and Raspberry Pi OS. Both generate correct
  output already; neither has a guide of its own to read, which is the single
  thing keeping both off the selectable list.
- Firefox and Safari have never been tested. The site should stop claiming
  broad browser support until they have been.

---

## How to check any of this yourself

```bash
cd tests && npm install && npm test
```

Twenty-six gates. They block the deploy on failure, and the leakage table at
the top of this page is printed by two of them.
