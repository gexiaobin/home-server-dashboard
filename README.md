# Home Server Dashboard

[![Container image](https://github.com/gexiaobin/home-server-dashboard/actions/workflows/container-image.yml/badge.svg)](https://github.com/gexiaobin/home-server-dashboard/actions/workflows/container-image.yml)
[![GHCR](https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/gexiaobin/home-server-dashboard/pkgs/container/home-server-dashboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f.svg)](LICENSE)

面向家庭服务器与 HomeLab 的自托管控制台。集中维护 NAS、虚拟机、Docker 应用和公网书签，并在同一个界面查看主机资源、服务状态、网络流量与多级拓扑。

项目采用 React + Express，前端和 API 打包在一个轻量容器中。所有页面内容均可在系统设置中维护，不绑定 ESXi、Synology 或任何特定厂商；其他用户拉取仓库后，可以直接替换成自己的主机、虚拟化平台和服务。

[快速部署](#docker-快速启动) · [拓扑模型](#通用网络拓扑) · [配置说明](docs/configuration.md) · [群晖部署](docs/synology.md) · [安全说明](#安全说明)

## 页面与能力

| 页面 | 主要能力 |
| --- | --- |
| 概览 | 常用服务、外网书签、主机资源、运行关注、实时网络与容器摘要 |
| 服务中心 | 维护内网服务与外网书签；支持内外网地址切换、分类、收藏、描述和运行环境 |
| 系统监控 | CPU、内存、负载、存储、温度、网络速率、运行时间和 Docker 容器状态 |
| 网络拓扑 | 从服务配置递归生成宿主、虚拟机和 Docker 应用关系；可叠加 iKuai 实时数据 |
| 系统设置 | 修改站点信息、服务目录、拓扑数据源与宿主关系，并导入或导出 JSON 配置 |

## 核心特性

- **通用服务目录**：内网服务和公网书签分别管理；内网条目可配置独立的 `url` 与 `externalUrl`。
- **真实应用图标**：服务端发现目标页面声明的 favicon，支持受限重定向、公网 HTTPS CDN 图标、自定义 `iconUrl` 和安全回退。
- **服务健康检查**：每个内网服务可选择 HTTP、TCP 或不探测；外网书签不会进入家庭内网健康统计。
- **宿主硬件监控**：通过只读挂载读取 CPU、内存、磁盘、网络、温度与运行时间，无需在宿主安装 Agent。
- **通用多级拓扑**：宿主和工作负载来自用户配置，不硬编码厂商；虚拟机还可继续作为 Docker 宿主。
- **响应式应用分组**：同一宿主的 Docker 应用集中显示，桌面端最多三列，移动端自动切换为单列，应用增加时不会无限撑宽画布。
- **可选动态数据源**：接入 iKuai v4 API 后补充路由器状态、实时吞吐、在线终端和宿主详情；不可用时自动保留配置拓扑。
- **数据库持久化**：页面修改通过原子 JSONB upsert 保存到 PostgreSQL，容器升级和重建不会丢失。
- **适配群晖部署**：提供 DSM Container Manager 指南、Compose 覆盖文件，以及 `linux/amd64`、`linux/arm64` 的 GHCR 镜像。

## 通用网络拓扑

拓扑关系由“系统设置 > 拓扑数据源”维护。基础设施和虚拟机都可以成为宿主，Docker 应用与虚拟机可以分配给任意直接宿主，因此既能表达普通虚拟化结构，也能表达虚拟机中继续运行容器的场景：

```text
Internet
└── Router / iKuai
    ├── ESXi / Proxmox / Hyper-V
    │   ├── fnOS
    │   │   └── Docker applications
    │   └── iStoreOS
    │       └── Docker applications
    ├── Synology / TrueNAS / Linux server
    │   └── Docker applications
    └── Other user-defined hosts
```

每个工作负载最多属于一个直接宿主，前端和服务端都会过滤重复、自关联与循环关系。未分配的虚拟机或 Docker 应用仍会进入独立分支，不会从拓扑中消失。宿主数量、厂商和嵌套深度不设固定限制。

## 系统架构

```text
Browser
  | HTTP/HTTPS
  v
Express :3000  ----  PostgreSQL / JSONB
  | serves API + built React assets
  +---- /host/proc       (read-only host metrics)
  +---- /host/sys        (read-only host metrics)
  +---- /host/storage    (read-only storage metrics)
  +---- iKuai v4 API     (optional read-only topology source)
  `---- Docker socket    (disabled by default)
```

默认部署只需要一个应用容器和一个可访问的 PostgreSQL 数据库。主机指标挂载、iKuai API 与 Docker Socket 都是独立能力；不需要时可以保持关闭或删除对应挂载。

## 内外网导航

内网服务使用 `url` 配置内网地址，并可使用 `externalUrl` 配置互联网地址。页面顶栏的“内网 / 外网”开关会统一切换概览、服务目录和网络拓扑中的打开链接；外网地址未配置时，对应入口会显示为不可用，不会回退到可能无法访问的内网地址。

外网书签使用 `url` 保存公开地址，在内网和外网模式下都打开同一地址。书签在服务中心和首页单独成组，不参与内网健康检查，也不会进入网络拓扑。编辑内网服务时，可将运行环境设为“虚拟机”或“Docker 应用”；“基础设施”和“虚拟机”都可作为宿主，因而可以表达 `ESXi -> fnOS / iStoreOS -> Docker 应用` 这类多级关系。

当前模式只保存在该浏览器的 `localStorage` 中，不会写入 PostgreSQL，也不会包含在配置导入导出中。因此，家中的电脑和外出的移动设备可以各自保留适合当前网络的模式；通过不同域名访问控制台时，各站点来源也会分别保存偏好。

该开关只选择浏览器打开的目标，并不会自动建立反向代理、端口转发或公网访问。真实图标发现始终使用条目的 `url`；内网服务未单独填写地址的 HTTP 健康检查也使用内网 `url`，不受浏览器模式影响。如果页面声明外部 CDN favicon，符合安全限制的公网 HTTPS 图标也由服务端代理获取。互联网入口应优先使用 HTTPS，并在反向代理或身份代理层配置认证与访问控制。

## Docker 快速启动

### 前置条件

- Docker Engine 与 Docker Compose v2。
- 一个已经创建好数据库和账号的 PostgreSQL 实例；仓库的 Compose **不会自动创建数据库容器**。
- NAS 或 Linux 主机可以访问 `ghcr.io` 和该 PostgreSQL 实例。

推荐通过只读秘密文件提供数据库连接串，并在稳定部署中使用版本标签替代 `latest` 以便回滚：

```bash
cp .env.example .env
mkdir -p secrets data
# 使用本地编辑器或秘密管理工具写入 secrets/database_url，并限制为 chmod 600。
docker compose -f docker-compose.yml -f docker-compose.database-file.yml pull
docker compose -f docker-compose.yml -f docker-compose.database-file.yml up -d
docker compose -f docker-compose.yml -f docker-compose.database-file.yml ps
```

`secrets/database_url` 只包含一行 PostgreSQL URI，例如：

```text
postgresql://dashboard:password@postgres:5432/home_server_dashboard
```

也可在 `.env` 中设置 `DATABASE_URL`，但环境变量会显示在容器检查信息中，安全性低于只读文件。不要同时设置 `DATABASE_URL` 与 `DATABASE_URL_FILE`。

打开 `http://NAS-IP:3000`。默认 Compose 会：

- 将页面配置写入 PostgreSQL 表 `home_server_dashboard_config`。
- 首次连接空表时，如 `data/config.json` 存在，会一次性导入旧配置。
- 只读挂载宿主 `/proc`、`/sys` 与 `/volume1` 以采集指标；多存储空间可使用群晖存储覆盖文件。
- 从宿主 `/proc` 自动读取主机名，也可在“系统设置”中配置公开友好的设备名称。
- 使用只读容器文件系统、移除 Linux capabilities，并限制容器日志大小。
- 不挂载 Docker Socket。

如需应用自身的登录保护，可在 `.env` 中同时填写 `BASIC_AUTH_USERNAME` 与 `BASIC_AUTH_PASSWORD`。Basic Auth 必须配合 HTTPS；也可以改为在 DSM 反向代理或可信身份代理层统一认证。

尚未发布 GHCR 镜像时，可以先在有 Docker 的开发机本地构建：

```bash
docker build -t home-server-dashboard:local .
DASHBOARD_IMAGE=home-server-dashboard:local docker compose up -d
```

群晖完整步骤见 [docs/synology.md](docs/synology.md)，配置格式与环境变量见 [docs/configuration.md](docs/configuration.md)。

### 可选 Compose 组件

| 文件 | 用途 | 风险或前提 |
| --- | --- | --- |
| `docker-compose.database-file.yml` | 以只读文件注入 PostgreSQL URI | 推荐生产环境使用 |
| `docker-compose.synology-storage.yml` | 同时采集 `/volume1`、`/volume2`、`/volume3` | 挂载路径需要在 NAS 上存在 |
| `docker-compose.ikuai.yml` | 以只读文件注入 iKuai API Token | 路由器需提供 v4 监控 API |
| `docker-compose.socket.yml` | 读取 Docker 容器列表 | Docker Socket 等价于高权限接口，启用前阅读下方安全说明 |

有多个群晖存储空间时，同时加入可选覆盖文件（默认采集 `/volume1`、`/volume2` 和 `/volume3`）：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.database-file.yml \
  -f docker-compose.synology-storage.yml \
  up -d
```

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

提交前建议执行完整校验：

```bash
npm test
npm run lint
npm run build
```

构建与启动生产版本：

```bash
npm run build
npm start
```

## iKuai 动态拓扑（可选）

在 iKuai Web 管理界面的 **系统 > 认证 > API Token** 创建 Token。界面名称可能因固件版本略有不同；路由器需要支持 `/api/v4.0/monitoring/*` 接口。建议创建专用 Token；如果当前固件支持权限范围，只授予所需的监控读取权限。

将 Token 单独保存为 `secrets/ikuai_token`，文件只包含一行 Token，不加引号、变量名或其他说明；结尾换行可有可无。然后在 `.env` 设置 `IKUAI_BASE_URL` 为路由器的 HTTP(S) origin，不要包含账号、密码、路径、查询参数或 URL 片段。推荐保持 `IKUAI_TOKEN` 和 `IKUAI_TOKEN_FILE` 为空，由覆盖文件设置容器内秘密文件路径：

```bash
chmod 600 secrets/ikuai_token
docker compose \
  -f docker-compose.yml \
  -f docker-compose.database-file.yml \
  -f docker-compose.ikuai.yml \
  up -d
```

部署后在“系统设置 > 拓扑数据源”选择“iKuai v4 API”，按需添加宿主并分配虚拟机或 Docker 应用。宿主可以是 ESXi、Proxmox、Hyper-V、群晖、普通 Linux 服务器，也可以是已登记为虚拟机的 fnOS、iStoreOS 等系统。虚拟机可以同时作为上一级宿主的工作负载和下一级 Docker 宿主；每个工作负载只能属于一个直接宿主，界面和服务端都会阻止自关联与循环关系。应用只调用系统、在线终端、下游设备和物理接口的只读监控端点；这些原始数据只用于路由状态、吞吐和宿主详情匹配，未登记终端不会显示在拓扑中。Token 与路由器地址不会进入页面配置导出。iKuai 未配置或暂时不可用时，拓扑页仍按服务中心配置生成相同结构。

默认严格校验 HTTPS 证书。只有可信内网路由器确实使用自签名证书时才设置 `IKUAI_ALLOW_INSECURE_TLS=true`，并确保容器网络和 NAS 防火墙只允许访问预期路由器。完整变量与群晖步骤见 [docs/configuration.md](docs/configuration.md) 和 [docs/synology.md](docs/synology.md)。

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
- iKuai Token 只能保存在服务端环境或只读秘密文件中，不得写入页面配置、截图或仓库；应用不会跟随 iKuai API 重定向。
- 服务图标由服务端访问条目的 `url`，跟随受限的页面跳转并解析页面声明的图标；未声明时会尝试常见 favicon 路径。自动发现不可用时可为条目配置 `iconUrl`。外网书签的页面跳转仅允许 HTTPS 默认端口下的同一可注册域名，并会对初始地址和每次换源重新校验公网 DNS、固定连接地址；跨域图标同样仅允许公网 HTTPS 默认端口、禁止自身跨源重定向并始终校验证书。第三方图标主机会看到 NAS 的出口 IP。可信内网设备使用自签名证书时，只为对应服务启用 `iconAllowInsecureTls`；全局 `SERVICE_ICON_ALLOW_INSECURE_TLS` 通常应保持关闭。
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
