# XHBlogs（公网站点）

本目录是面向访客的 Next.js 博客前端（含 `/api/*`）。本地写作与同步请使用同级仓库中的 `my-blog-manager` 控制台。

## 本地开发

需要 Node.js **≥ 20.9**。

```bash
npm ci
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 生产构建

- **Vercel**：将本目录作为 Next.js 项目导入即可（见仓库根目录 README）。
- **自托管（Debian 等）**：启用 `output: 'standalone'`，在 Linux 构建机打包后 rsync 到服务器。完整步骤见 **[deploy/README.md](deploy/README.md)**。

```bash
# 在 CachyOS / Linux 构建机上
./deploy/build-release.sh
./deploy/rsync-deploy.sh user@your-debian-host
```

请勿将 Windows 下的 `node_modules` 拷贝到 Linux。

## 相关文档

- 仓库总览与控制台：[`../README.md`](../README.md)
- 自托管技术说明：[`deploy/README.md`](deploy/README.md)
- 环境变量示例：[`.env.production.example`](.env.production.example)
