# Home Server Dashboard

面向家庭服务器的自托管控制台，用一个页面维护虚拟机、NAS 与 Docker 应用入口，并查看主机硬件、网络、服务状态和拓扑。界面参考 Grafana 的高密度运维体验，但项目本身保持轻量：React 前端与 Express API 打包在同一个容器中。

## 功能

- 控制中心概览：汇总常用服务、主机资源、异常服务、网络速率与容器可见状态。
- 服务导航：按分类浏览、收藏和快速打开家庭服务，并可在内网与外网入口之间切换。
- 真实服务图标：由服务端根据服务的内网 URL 解析目标页面声明的 favicon，包括页面明确引用的公网 HTTPS CDN 图标，加载失败时自动回退。
- 状态检查：支持 HTTP、TCP 和不探测三种模式。
- 主机概览：CPU、内存、磁盘、网络与温度指标。
- 网络拓扑：维护路由器、NAS、虚拟机、容器与连接关系。
- PostgreSQL 持久化：页面修改通过原子 JSONB upsert 保存，容器升级后继续保留。
- 群晖友好：提供 Container Manager Compose、多架构 GHCR 镜像和部署说明。

## 架构

```text
Browser
  | HTTP/HTTPS
  v
Express :3000  ----  PostgreSQL / JSONB
  | serves API + built React assets
  +---- /host/proc       (read-only host metrics)
  +---- /host/sys        (read-only host metrics)
  +---- /host/storage    (read-only storage metrics)
  `---- Docker socket    (disabled by default)
```

## 内外网导航

每个服务使用 `url` 配置内网地址，并可使用 `externalUrl` 配置互联网地址。页面顶栏的“内网 / 外网”开关会统一切换概览、服务目录和网络拓扑中的打开链接；外网地址未配置时，对应入口会显示为不可用，不会回退到可能无法访问的内网地址。

当前模式只保存在该浏览器的 `localStorage` 中，不会写入 PostgreSQL，也不会包含在配置导入导出中。因此，家中的电脑和外出的移动设备可以各自保留适合当前网络的模式；通过不同域名访问控制台时，各站点来源也会分别保存偏好。

该开关只选择浏览器打开的目标，并不会自动建立反向代理、端口转发或公网访问。真实图标发现和未单独填写地址的 HTTP 健康检查仍由服务端通过内网 `url` 发起，不受浏览器模式影响。如果页面声明外部 CDN favicon，符合安全限制的公网 HTTPS 图标也由服务端代理获取。互联网入口应优先使用 HTTPS，并在反向代理或身份代理层配置认证与访问控制。

## 本地开发

建议使用当前 Node.js LTS。仓库声明的最低版本是 Node.js 18.18，但该版本已经停止维护，新环境建议使用 Node.js 24。

```bash
npm install
npm run dev
```

开发服务器：

- 前端：`http://localhost:5173`
- API：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/health`

构建与启动生产版本：

```bash
npm run build
npm start
```

## Docker 快速启动

正式部署使用 PostgreSQL，推荐通过只读秘密文件提供连接串，并使用版本标签替代 `latest` 以便回滚：

```bash
cp .env.example .env
mkdir -p secrets data
# 使用本地编辑器或秘密管理工具写入 secrets/database_url，并限制为 chmod 600。
docker compose -f docker-compose.yml -f docker-compose.database-file.yml pull
docker compose -f docker-compose.yml -f docker-compose.database-file.yml up -d
docker compose -f docker-compose.yml -f docker-compose.database-file.yml ps
```

秘密文件内容是一行 PostgreSQL URI，例如 `postgresql://dashboard:password@postgres:5432/home_server_dashboard`。也可在 `.env` 中设置 `DATABASE_URL`，但环境变量会显示在容器检查信息中，安全性低于只读文件。不要同时设置 `DATABASE_URL` 与 `DATABASE_URL_FILE`。

打开 `http://NAS-IP:3000`。默认 Compose 会：

- 将页面配置写入 PostgreSQL 表 `home_server_dashboard_config`。
- 首次连接空表时，如 `data/config.json` 存在，会一次性导入旧配置。
- 只读挂载宿主 `/proc`、`/sys` 与 `/volume1` 以采集指标。
- 使用只读容器文件系统、移除 Linux capabilities，并限制容器日志大小。
- 不挂载 Docker Socket。

如需应用自身的登录保护，可在 `.env` 中同时填写 `BASIC_AUTH_USERNAME` 与 `BASIC_AUTH_PASSWORD`。Basic Auth 必须配合 HTTPS；也可以改为在 DSM 反向代理或可信身份代理层统一认证。

尚未发布 GHCR 镜像时，可以先在有 Docker 的开发机本地构建：

```bash
docker build -t home-server-dashboard:local .
DASHBOARD_IMAGE=home-server-dashboard:local docker compose up -d
```

群晖完整步骤见 [docs/synology.md](docs/synology.md)，配置格式与环境变量见 [docs/configuration.md](docs/configuration.md)。

## Docker 容器信息（可选且高风险）

基础 Compose **不会**挂载 `/var/run/docker.sock`。只有明确接受风险后，才使用额外 override：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.socket.yml \
  up -d
```

群晖上的 Socket 通常只有 root 可访问，因此这个 override 还会把应用运行用户改为 `0:0`。即使挂载写成 `:ro`，Docker Socket 仍可能允许调用 Docker API 创建高权限容器、挂载宿主目录或控制其他容器，效果接近取得 NAS 的 root 权限。不要把启用该能力的控制台暴露到公网；更稳妥的方案是使用只开放必要只读端点的 Socket Proxy，并让主应用继续以非 root 用户运行。

## 镜像发布

推送到 `main` 后，GitHub Actions 会构建：

- `linux/amd64`
- `linux/arm64`

镜像地址为 `ghcr.io/gexiaobin/home-server-dashboard`。首次发布后，需要在 GitHub Package 设置中确认包为 Public，群晖才能匿名拉取。发布 `v1.2.3` 形式的 Git 标签会同时生成 `1.2.3` 与 `1.2` 标签。

## 安全说明

- `.env`、`secrets/`、`data/` 和真实家庭网络信息不得提交到公共仓库。
- PostgreSQL 应使用专用数据库账号，只授予应用表所需权限；不要长期使用 `postgres` 超级用户。
- 当前应用本身不应被视为互联网边界认证服务。对外访问时，请在 DSM 反向代理前增加身份验证、访问控制或仅通过可信 VPN 访问。
- 内置 Basic Auth 适合家庭内网的基础保护，不替代 HTTPS、多因素认证或成熟的身份代理；`/api/health` 为容器探针保持公开。
- HTTP/TCP 状态检查由服务端发起，配置编辑权限等同于允许访问家庭内网探测能力。
- 服务图标由服务端访问配置的内网 `url` 及页面明确声明的图标地址，因此只应配置可信的服务页面。跨域图标仅允许公网 HTTPS 默认端口、禁止跨源重定向并始终校验证书；第三方图标主机会看到 NAS 的出口 IP。`SERVICE_ICON_ALLOW_INSECURE_TLS` 仅应在可信内网服务使用自签名或已过期证书时启用。
- `externalUrl` 会通过配置 API 和 JSON 导出显示，不能在 URL 中保存密码、Token 或其他秘密。
- 宿主指标挂载虽然只读，仍会向容器披露系统信息；不需要的挂载应删除。

## 官方资料

- [Synology Container Manager：Project](https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project?version=7)
- [Synology DSM：SNMP](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_snmp?version=7)
- [Synology DSM：Login Portal 与反向代理](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_login_portal?version=7)
- [Docker：多平台镜像](https://docs.docker.com/build/building/multi-platform/)
- [Docker：保护 daemon socket](https://docs.docker.com/engine/security/protect-access/)
- [GitHub：发布 Docker 镜像](https://docs.github.com/actions/tutorials/publish-packages/publish-docker-images)

## License

[MIT](LICENSE)

