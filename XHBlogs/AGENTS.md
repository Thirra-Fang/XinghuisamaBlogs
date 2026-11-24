<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Fork docs (required)

When changing site features, console parity, picbed, or deploy behavior for this static fork:

1. Update [`AboutVPS/04-静态展示站.md`](../../AboutVPS/04-静态展示站.md) (production source of truth).
2. Update repo root [`README.md`](../README.md) fork table if user-facing.
3. Add a bullet under [`UpdateLog.md`](../UpdateLog.md) Unreleased.

Do not ship code-only changes that leave those docs stale. Production deploy uses incremental rsync of `out/` via monorepo [`scripts/deploy-fallback-site-remote.sh`](../scripts/deploy-fallback-site-remote.sh) (staging then atomic swap; hosts from `~/.config/AboutVPS/hosts.conf`); the console **同步 Blog** invokes that script. No Vercel dual-track in this fork.

Public chatter list uses columns + glass + framer enter/exit (no `PageTransition` wrapper). Manager chatter list stays grid + solid cards. Archive `/timeline` is matrix-grid only (no hub-chain / view toggle). Projects use `url` + `linkType` (`github` | `pan`).
