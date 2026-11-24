# XinghuisamaBlogs (this fork)

A glassmorphism personal blog built with Next.js: **XHBlogs** is the public site, **my-blog-manager** is the local console. This repo is a fork/configuration of [heiehiehi/XinghuisamaBlogs](https://github.com/heiehiehi/XinghuisamaBlogs). Production ships as a **static export**.

## Author & license

- **Original author**: XingHuiSama  
- **Upstream**: [heiehiehi/XinghuisamaBlogs](https://github.com/heiehiehi/XinghuisamaBlogs)  
- **License**: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (attribution, non-commercial)

Keep LICENSE and credit. Put secrets (e.g. Cloudflare R2) on the machine only (`~/.config/AboutVPS/r2.env` or `~/.config/r2.env`), never in git.

Languages: [中文](README.md) · [English](README_en.md)

---

## This fork vs upstream

| Item | Behavior |
|------|----------|
| Public site | `STATIC_EXPORT=1` → `out/` → monorepo [`scripts/deploy-fallback-site-remote.sh`](scripts/deploy-fallback-site-remote.sh) / [`deploy-fallback-site-remote.py`](scripts/deploy-fallback-site-remote.py) (atomic swap; hosts from [`scripts/hosts.conf`](scripts/hosts.conf)). **Not** Vercel dual-track |
| Removed | Moments, public music / tree lab / danmaku / Gitalk / pets / AI |
| Chatter | **Public**: CSS columns masonry + glass + framer enter/exit (no `PageTransition`). **Console**: grid + solid cards (WebKit-safe) |
| Archive | Matrix grid only; hub-chain timeline and view toggle removed; tag bar fills the glass strip |
| Projects | `url` + `linkType: github \| pan`; pan icon is original silhouette `public/icons/pan-drive.png` via CSS mask |
| Back button | Post → `/timeline`, chatter detail → `/chatter`; none on projects/friends |
| Profile bio | Newlines honored; fills the card width |
| Console | **Sync Blog** = mirror `XHBlogs` + remote static deploy; **git push** = monorepo root; R2 picbed (batch upload in Settings → Gallery) |
| Ops source of truth | [AboutVPS/04-静态展示站.md](../AboutVPS/04-静态展示站.md) |

See [UpdateLog.md](UpdateLog.md). When changing features, update AboutVPS `04`, this README, and UpdateLog together.

---

## Site surface

Home, timeline/archive (posts, matrix grid only), chatter, projects, friends, photowall, about. No public music widget, moments, comment OAuth, or desktop pets.

---

## Requirements

- **Node.js** ≥ 20.9, **npm**, **Git**  
- **Python** ≥ 3.10 (console)  
- Optional: Cloudflare R2

---

## Local console

```bash
cd my-blog-manager
python run_me.py   # or the desktop “XHBlogs 控制台” shortcut
```

On Windows, `Start.bat` is available. Point **Settings → project path** at sibling `XHBlogs` (no dual-track GitHub/Vercel UI in this fork).

### Publish

1. Edit content; queue ops → **Update local**  
2. **Sync Blog** (mirror + remote deploy, live log)  
3. Optional **git push** of the monorepo root (backup only; not go-live)

```bash
cd XHBlogs && npm ci && npm run build:static
cd ../scripts && ./deploy-fallback-site-remote.sh --yes
```

Picbed: `~/.config/AboutVPS/r2.env` or `~/.config/r2.env`, then Settings → Gallery (batch) or editor upload. Details in AboutVPS `04`.

---

## Public site dev

```bash
cd XHBlogs
npm ci
npm run dev
```

Static build: `npm run build:static` → `out/`. See [XHBlogs/README.md](XHBlogs/README.md).

---

## Alternate deploys (not production here)

- [`XHBlogs/deploy/`](XHBlogs/deploy/README.md): Node `standalone` + nginx — optional; `thirra.com` uses static Reality fallback instead.  
- Upstream Vercel dual-track: removed from this fork’s console; follow upstream docs only if you track upstream.

---

## License

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

CC BY-NC 4.0: share and adapt with attribution for non-commercial use only.
