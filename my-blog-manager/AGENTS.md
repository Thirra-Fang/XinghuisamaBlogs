<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Fork docs (required)

When changing console UI, settings, picbed, sync, or preview parity with the static site:

1. Update [`AboutVPS/04-静态展示站.md`](../../AboutVPS/04-静态展示站.md).
2. Update repo root [`README.md`](../README.md) fork notes if user-facing.
3. Add a bullet under [`UpdateLog.md`](../UpdateLog.md) Unreleased.

Keep manager and `XHBlogs` behavior documented together. No `MusicProvider` / no detail `SidebarLyric` in this fork; R2 batch upload lives under Settings → 图库. No GitHub/Vercel dual-track UI; **同步 Blog** = mirror + [`scripts/deploy-fallback-site-remote.sh`](../scripts/deploy-fallback-site-remote.sh) (incremental rsync); ops **git推送** = monorepo root only. Manager chatter list: grid + solid (no columns/list framer) for WebKit; public site keeps waterfall animation. Projects: `url` + `linkType` (`github` | `pan`), not `githubUrl`.
