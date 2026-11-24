# XHBlogs（公网站点）

本目录是面向访客的 Next.js 博客前端。本地写作与同步请使用同级仓库中的 `my-blog-manager` 控制台。

## 本 fork 生产部署（优先）

`thirra.com` 走 **纯静态导出**，不是本目录 `deploy/` 的 Node standalone：

```bash
STATIC_EXPORT=1   # 由 npm run build:static / 脚本设置
npm run build:static   # 产物 out/
# 再跑 monorepo 脚本（hosts 读 ../scripts/hosts.conf）：
#   ../scripts/deploy-fallback-site-remote.sh --yes   # Linux (rsync)
#   python ../scripts/deploy-fallback-site-remote.py --yes  # Windows / 跨平台
# 将 out/ 以 rsync 增量同步到各机 /var/www/reality-fallback（原子切换）
```

运维、R2 图床、fork 差异见 **[AboutVPS/04-静态展示站.md](../../AboutVPS/04-静态展示站.md)**；部署脚本在 **[`../scripts/deploy-fallback-site-remote.sh`](../scripts/deploy-fallback-site-remote.sh)**。

改本站或控制台行为时，请同步更新该 `04`、仓库根 `README.md` fork 表与 `UpdateLog.md`。

杂谈列表为本站瀑布流动画；控制台侧故意用 grid 实色卡。归档 `/timeline` 仅矩阵网格（无中枢链路 / 视图切换）。项目数据为 `url` + `linkType`（`github` | `pan`），网盘图标见 `public/icons/pan-drive.png`。

## 本地开发

需要 Node.js **≥ 20.9**。

```bash
npm ci
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 其它生产路径（备选）

- **Vercel**：将本目录作为 Next.js 项目导入（见仓库根目录 README 上游说明）。
- **Node 自托管（Debian 等）**：`output: 'standalone'`，在 Linux 构建机打包后 rsync 到服务器。步骤见 **[deploy/README.md](deploy/README.md)**（备选；与当前 Reality 回落静态站不同）。

```bash
# 仅在刻意使用 Node standalone 时
./deploy/build-release.sh
./deploy/rsync-deploy.sh user@your-debian-host
```

请勿将 Windows 下的 `node_modules` 拷贝到 Linux。本 fork 已退役说说（`moments`）。

## 相关文档

- 仓库总览与控制台：[`../README.md`](../README.md)
- 生产静态站运维（AboutVPS）：[`../../AboutVPS/04-静态展示站.md`](../../AboutVPS/04-静态展示站.md)
- 静态上线脚本：[`../scripts/deploy-fallback-site-remote.sh`](../scripts/deploy-fallback-site-remote.sh)
- Node 自托管备选：[`deploy/README.md`](deploy/README.md)
- 环境变量示例：[`.env.production.example`](.env.production.example)
