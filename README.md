# XinghuisamaBlogs（本 fork）

基于 Next.js 的毛玻璃风格个人博客：**XHBlogs** 为访客站，**my-blog-manager** 为本地控制台。本仓库是对上游 [heiehiehi/XinghuisamaBlogs](https://github.com/heiehiehi/XinghuisamaBlogs) 的二次配置，公网以**纯静态导出**上线。

## 原作者与许可

- **原作者**：XingHuiSama  
- **原项目**：[heiehiehi/XinghuisamaBlogs](https://github.com/heiehiehi/XinghuisamaBlogs)  
- **许可**：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（须署名、非商业）  

请保留 LICENSE 与对上游的致谢。涉密配置（Cloudflare R2 等）放本机（如 `~/.config/AboutVPS/r2.env`），**不要**提交到 git。

语言：[中文](README.md) · [English](README_en.md)

---

## 本 fork 现状（相对上游）

| 项 | 说明 |
|----|------|
| 公网形态 | `STATIC_EXPORT=1` → `out/` → monorepo [`scripts/deploy-fallback-site-remote.sh`](scripts/deploy-fallback-site-remote.sh) **rsync 增量**上线（原子切换；SSH hosts 仍读 AboutVPS）。**不是** Vercel 双轨 |
| 已退役 | 说说（moments）、公网页音乐 / 灵境 / 弹幕 / Gitalk / 宠物 / AI |
| 杂谈 | **展示站**：columns 瀑布流 + 玻璃卡 + framer 进出场（不包 PageTransition）。**控制台**：grid + 实色卡（避 WebKit 显示不全） |
| 项目 | `url` + `linkType: github \| pan`；网盘用原图轮廓 `public/icons/pan-drive.png` mask 图标 |
| 返回上一级 | 文章 → `/timeline`，杂谈详情 → `/chatter`；项目 / 友链无该按钮 |
| 首页简介 | `bio` 支持换行并撑满名片栏 |
| Markdown | TipTap 写 `$...$` / `$$...$$`；详情 KaTeX；列表摘要为纯文本 |
| 控制台 | **同步 Blog** = 镜像 `XHBlogs` + 远程静态部署；**git推送** = monorepo 根；图床 R2（设置 → 图库可批量上传） |
| 运维权威 | 旁路仓库 [AboutVPS/04-静态展示站.md](../AboutVPS/04-静态展示站.md) |

变更记在 [UpdateLog.md](UpdateLog.md)。改功能时请同步更新 AboutVPS `04`、本 README 与 UpdateLog。

---

## 页面能力

访客站大致包含：首页、归档（文章）、杂谈、项目、友链、照片墙、关于。无顶栏音乐、说说、评论挂件与桌宠。

---

## 环境

- **Node.js** ≥ 20.9  
- **npm**、**Git**  
- **Python** ≥ 3.10（控制台）  
- 可选：Cloudflare R2（图床）

---

## 本地控制台

```bash
cd my-blog-manager
python run_me.py   # 或本机桌面「XHBlogs 控制台」快捷方式
```

Windows 可用目录内 `Start.bat`。首次会准备 `.venv` 与依赖。

在 **设置 → 项目仓库** 中指定同级 `XHBlogs` 路径并保存（本 fork **无** GitHub/Vercel「双轨」配置项）。

### 发布流程

1. 在控制台编辑文章 / 杂谈 / 友链 / 项目等，加入操作队列  
2. 顶栏 **更新本地**  
3. **同步 Blog** → 镜像到 `XHBlogs` 并执行远程静态部署（日志弹窗）  
4. 需要备份源码时：操作栏 **git推送**（只推 monorepo 根，**不等于**上线）

CLI 等价：

```bash
cd XHBlogs && npm ci && npm run build:static
cd ../scripts && ./deploy-fallback-site-remote.sh --yes
```

图床：配置 `~/.config/AboutVPS/r2.env` 后，在 **设置 → 图库** 批量上传，或编辑器图床工作台单张上传。细节见 AboutVPS `04`。

---

## 展示站本地开发

```bash
cd XHBlogs
npm ci
npm run dev    # http://localhost:3000
```

静态产物：`npm run build:static` → `out/`。站点说明见 [XHBlogs/README.md](XHBlogs/README.md)。

---

## 备选部署（本 fork 不用作生产）

- **`XHBlogs/deploy/`**：Node `standalone` + nginx 反代，见 [XHBlogs/deploy/README.md](XHBlogs/deploy/README.md)。当前 `thirra.com` **不以**此为准。  
- **上游 Vercel 双轨**：已从本 fork 控制台移除；若跟上游文档操作，请以官方仓库为准，勿与本 README 混淆。

上游曾包含宠物、网易云挂件、Gitalk、说说等；本 fork 公网与控制台顶栏均已去掉或退役，历史截图与长篇双轨教程不再作为本仓库主路径。

---

## 写在最后

二次开发请保留原作者署名。觉得有用请给**上游**与本仓库按需点 Star。

## 许可证

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

本项目采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)。允许学习、分享与署名后的非商业二次修改；**禁止商业用途**。
