# XHBlogs 自托管部署（Debian + CachyOS 构建）

> **备选路径**：本文是 Next.js **Node standalone** 自托管说明（此处的 rsync 只服务本备选路径）。  
> 当前 **thirra.com / Reality 回落** 生产部署走纯静态导出，见旁路 **[AboutVPS/04-静态展示站.md](../../../AboutVPS/04-静态展示站.md)**：`build:static` 后由 monorepo **[`scripts/deploy-fallback-site-remote.sh`](../../scripts/deploy-fallback-site-remote.sh)** **rsync 增量**同步 `out/`（staging 后原子切换）。  
> 本 fork 已**退役说说（moments）**；若仍用本脚本部署 standalone，产物中不再包含 `moments/`。

面向小内存 Debian 服务器：在 **CachyOS（或其它 x86_64 Linux）** 上构建 Next.js **standalone** 产物，用 **rsync** 同步到服务器，由 **systemd + nginx** 对外提供 **HTTPS（443）**。服务器上 **不要** 执行 `npm run build`。

本地写作控制台 `my-blog-manager` 仍在 Windows（或其它写作机）使用，**不部署到公网服务器**。

## 1. 架构

```text
Windows 控制台  --同步 Blog-->  XHBlogs 源码  --git-->  CachyOS 构建
                                                      |
                                                 standalone 产物
                                                      |
                                                   rsync/scp
                                                      v
访客 --HTTPS:443--> nginx --反代--> Node 127.0.0.1:3000 （Debian）
```

| 机器 | 角色 |
|------|------|
| Windows | 控制台写稿 →「同步 Blog」→ Git 推送 |
| CachyOS | `npm ci` / `build-release.sh`，再 `rsync-deploy.sh` |
| Debian | 只运行 Node + nginx；可与 et 等共存，勿在此编译 |

### 端口

| 端口 | 进程 | 说明 |
|------|------|------|
| **443 / 80** | nginx | 公网访客；浏览器地址为 `https://域名`，无 `:3000` |
| **3000** | Node（`server.js`） | 仅绑定 `127.0.0.1`，供本机 nginx 反代；防火墙勿放行 |

本方案假设博客机 **nginx 占用 80/443**，不与其它占用 443 的服务共端口。

## 2. 前置条件

- Node.js **≥ 20.9**（构建机与运行机主版本建议一致，推荐官方 Node 20 LTS）
- 构建机：`npm`、`rsync`、`git`、`bash`
- Debian：`nginx`、`rsync`、`curl`、Node 20（仅运行）、开放 **22/80/443**
- 域名 DNS `A` 记录指向 Debian（试验机可先用 IP + HTTP）

**禁止**：把 Windows 下安装的 `node_modules` 拷到 Linux。

## 3. 脚本与产物

目录：`XHBlogs/deploy/`

| 文件 | 用途 |
|------|------|
| `build-release.sh` | 构建并组装 `~/xhblogs-release`（可用 `RELEASE_DIR` 覆盖） |
| `rsync-deploy.sh` | 同步到远端并 `systemctl restart xhblogs` |
| `xhblogs.service` | systemd 单元模板 |
| `nginx-xhblogs.conf` | nginx 站点模板（先 HTTP，再 Certbot） |

环境变量示例：仓库内 [`../.env.production.example`](../.env.production.example)，部署到服务器 `/var/www/xhblogs/env/production`。

### 构建（CachyOS）

```bash
cd /path/to/XinghuisamaBlogs/XHBlogs
git pull
chmod +x deploy/build-release.sh deploy/rsync-deploy.sh
./deploy/build-release.sh
```

产物默认在 `~/xhblogs-release/`，至少包含：

- `server.js` 与 standalone 运行时
- `.next/static/`
- `public/`
- `posts/`、`chatters/`、`data/`
- `app/about/about.md`

可选：`SKIP_INSTALL=1` 跳过 `npm ci`（依赖已装好时）。

若在 Debian 上报 `GLIBC_x.xx not found`：在 CachyOS 上用 Debian bookworm 容器挂载源码再跑同一脚本，使构建 glibc 与运行系统对齐。

### 同步（CachyOS → Debian）

```bash
./deploy/rsync-deploy.sh user@你的服务器
# 或
./deploy/rsync-deploy.sh user@host --release ~/xhblogs-release --remote /var/www/xhblogs/app
```

首次需已在服务器装好用户、目录与 systemd（见下节）。`--no-restart` 可只同步不重启。

## 4. Debian 一次性准备

```bash
sudo apt update
sudo apt install -y nginx rsync curl
# 安装 Node 20 LTS，确保 `which node` 为 /usr/bin/node（或改 service 里 ExecStart）

sudo useradd -r -m -d /var/www/xhblogs -s /usr/sbin/nologin xhblogs || true
sudo mkdir -p /var/www/xhblogs/app /var/www/xhblogs/env
sudo chown -R xhblogs:xhblogs /var/www/xhblogs
```

```bash
sudo cp deploy/xhblogs.service /etc/systemd/system/xhblogs.service
# 编辑 ExecStart 若 node 不在 /usr/bin/node
sudo cp .env.production.example /var/www/xhblogs/env/production   # 从构建机或本机拷贝后填写密钥
sudo chmod 600 /var/www/xhblogs/env/production
sudo chown xhblogs:xhblogs /var/www/xhblogs/env/production

sudo cp deploy/nginx-xhblogs.conf /etc/nginx/sites-available/xhblogs
sudo sed -i 's/example.com/你的域名/g' /etc/nginx/sites-available/xhblogs
sudo ln -sf /etc/nginx/sites-available/xhblogs /etc/nginx/sites-enabled/xhblogs
sudo rm -f /etc/nginx/sites-enabled/default   # 按需
sudo nginx -t && sudo systemctl enable --now nginx
```

先完成一次 rsync，再：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now xhblogs
sudo systemctl status xhblogs
```

## 5. 环境变量

写入 `/var/www/xhblogs/env/production`（由 `xhblogs.service` 的 `EnvironmentFile` 加载）：

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | 宠物 AI 聊天（`/api/chat`） |
| `OPENAI_API_KEY` | 可选，与上者二选一逻辑见路由 |
| `QWEATHER_KEY` | 可选，天气 API |

`HOSTNAME=127.0.0.1` 与 `PORT=3000` 已在 unit 中设置。

## 6. HTTPS（推荐）

DNS 指向服务器后，先用 `http://域名` 确认站点正常，再：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名 -d www.你的域名
```

Gitalk OAuth 的 Homepage / Authorization callback 改为 `https://你的域名`（不要带 `:3000`）。

试验机可暂用 HTTP；正式对外建议启用 HTTPS。

## 7. 日常发布顺序

1. Windows：暂存 → 更新本地 → **同步 Blog**
2. Git 推送到构建机可拉取的远程
3. CachyOS：`git pull` → `./deploy/build-release.sh` → `./deploy/rsync-deploy.sh user@host`
4. 浏览器强刷验收

**改文必须重建再同步**；只重启旧包看不到新 Markdown。

## 8. 排错

| 现象 | 排查 |
|------|------|
| 502 Bad Gateway | `systemctl status xhblogs`；确认监听 `127.0.0.1:3000`；看 `journalctl -u xhblogs -e` |
| 权限错误 | `/var/www/xhblogs/app` 属主 `xhblogs`；env 文件可读 |
| `GLIBC_*.* not found` | 在 Debian bookworm 容器内构建后再 rsync |
| 页面无新文章 | 是否重新 `build-release` 且 rsync 了 `posts/` 等 |
| chat / weather 失败 | 检查 `env/production` 密钥后 `systemctl restart xhblogs` |
| 证书失败 | DNS 是否已指向本机；80 是否对公网开放 |

## 9. 小内存与 et 共存

- 构建只在 CachyOS，避免 1G/2G 机 OOM
- Node 仅本机回环；unit 模板含 `MemoryMax=512M`（可按机型调整）
- 换机：同一 release + unit + nginx，改 DNS 即可

## 10. 验收清单

- [ ] 首页、文章、杂谈、关于页（无说说）
- [ ] `/api/music`；配置密钥后 `/api/weather`、`/api/chat`
- [ ] HTTPS 与评论 OAuth（若启用）
- [ ] `reboot` 后 `xhblogs` 与 `nginx` 自启
- [ ] `ss -tlnp`：3000 仅 127.0.0.1；443/80 为 nginx
