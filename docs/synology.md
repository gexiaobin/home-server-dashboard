# 群晖 NAS 部署

本文以 DSM 7 与 Container Manager 为基线。不同 NAS 型号可用的 Container Manager 和 Docker Engine 版本并不完全相同，请先在套件中心确认机型支持。仓库工作流同时发布 `linux/amd64` 和 `linux/arm64` 镜像，Docker 会按 NAS CPU 架构选择正确版本。

## 1. 前置条件

- DSM 已安装 Container Manager。
- NAS 可以访问 `ghcr.io`，或已经通过其他方式把镜像同步到可访问的镜像仓库。
- 有一个应用可访问的 PostgreSQL 实例和专用低权限账号。
- 有一个应用目录，例如 `/volume1/docker/home-server-dashboard`。
- 端口 `3000` 未被占用；若已占用，在 `.env` 中更改 `APP_PORT`。

中国大陆网络环境中直接拉取 GHCR 可能不稳定。可以使用可信的私有镜像代理或现有镜像同步流程，但不要使用来源不明的公共代理传输私有镜像或凭据。

## 2. 准备目录

在 File Station 中创建：

```text
/volume1/docker/home-server-dashboard/
|-- data/
`-- secrets/
    |-- database_url
    `-- ikuai_token        # 可选，仅启用 iKuai 动态拓扑时创建
```

将仓库中的 `docker-compose.yml`、`docker-compose.database-file.yml` 和 `.env.example` 放入 `home-server-dashboard` 目录；需要动态拓扑时同时放入 `docker-compose.ikuai.yml`。把 `.env.example` 复制为 `.env`。`secrets/database_url` 只写一行 PostgreSQL URI，不加引号。至少检查这些值：

```dotenv
DASHBOARD_IMAGE=ghcr.io/gexiaobin/home-server-dashboard:latest
BIND_ADDRESS=0.0.0.0
APP_PORT=3000
STORAGE_BACKEND=postgresql
DATABASE_URL=
DATABASE_URL_FILE=
DATABASE_URL_FILE_PATH=/volume1/docker/home-server-dashboard/secrets/database_url
DATA_PATH=/volume1/docker/home-server-dashboard/data
HOST_STORAGE_PATH=/volume1
HOST_STORAGE_PATH_2=/volume2
HOST_STORAGE_PATH_3=/volume3
DOCKER_API_TIMEOUT_MS=3000
IKUAI_BASE_URL=
IKUAI_TOKEN=
IKUAI_TOKEN_FILE=
IKUAI_TOKEN_FILE_PATH=/volume1/docker/home-server-dashboard/secrets/ikuai_token
IKUAI_TIMEOUT_MS=5000
IKUAI_ALLOW_INSECURE_TLS=false
TZ=Asia/Shanghai
SERVICE_CHECK_TIMEOUT_MS=5000
SERVICE_ICON_TIMEOUT_MS=5000
SERVICE_ICON_ALLOW_INSECURE_TLS=false
BASIC_AUTH_USERNAME=
BASIC_AUTH_PASSWORD=
```

生产环境建议将镜像改成明确版本，例如 `:1.0.0`，避免 `latest` 自动变化。不要把实际数据库 URI 或 iKuai Token 写入 Compose、`.env`、README 或截图；数据库应使用专用账号，不要长期使用 `postgres` 超级用户。

服务目录会从每个条目的 `url` 跟随受限的页面跳转、发现页面声明的真实 favicon，并在未声明时尝试常见 favicon 路径；自动发现被目标站点拦截时可填写自定义图标地址。内网服务的 `url` 是内网地址，外网书签的 `url` 是公开地址；图标始终由容器代理获取，切换网络模式不会改用 `externalUrl`。外网书签页面只允许在 HTTPS 默认端口下跳转到同一可注册域名，初始地址和每次换源都会重新校验公网 DNS 并固定连接地址；跨域图标也只允许 HTTPS 默认端口和公网地址。第三方图标主机会看到 NAS 的出口 IP，因此只应配置可信页面。全局 `SERVICE_ICON_ALLOW_INSECURE_TLS` 应保持默认的 `false`；可信内网设备使用自签名或过期 HTTPS 证书时，在服务编辑窗口只为该服务打开“允许自签名 HTTPS 图标”。跨域 HTTPS 图标始终校验证书。

## 3. 目录权限

镜像以内置 `node` 用户（UID/GID 1000）运行。秘密文件只需容器可读，建议权限为 `0400` 或 `0440`；`data` 目录只在旧 JSON 迁移或文件模式下需要写权限。如果日志出现 `EACCES` 或 `permission denied`，只修正应用自己的目录，不要修改共享目录根权限：

```bash
sudo chown -R 1000:1000 /volume1/docker/home-server-dashboard/data
sudo chown -R 1000:1000 /volume1/docker/home-server-dashboard/secrets
sudo chmod 700 /volume1/docker/home-server-dashboard/secrets
sudo chmod 400 /volume1/docker/home-server-dashboard/secrets/database_url
```

启用 iKuai 动态拓扑后，再为 `secrets/ikuai_token` 使用相同所有者和 `0400` 权限。不要对 `/volume1` 或共享文件夹根目录递归执行 `chown`。

## 4. 在 Container Manager 创建 Project

1. 打开 **Container Manager > Project**。
2. 点击 **Create**，项目名填写 `home-server-dashboard`。
3. Path 选择 `/volume1/docker/home-server-dashboard`。
4. 若界面只接受一个 Compose 文件，把所需覆盖文件中的 `environment` 与 `volumes` 条目合并到主文件：数据库使用 `docker-compose.database-file.yml`，iKuai 使用 `docker-compose.ikuai.yml`，多存储空间使用 `docker-compose.synology-storage.yml`。SSH 部署可同时传入多个 `-f` 文件。
5. Source 选择最终的 Compose 配置，检查端口、秘密文件挂载和环境变量，完成创建并启动项目。
6. 在 Container 页面确认 `home-server-dashboard` 状态为 Healthy。
7. 浏览器打开 `http://NAS-IP:3000`，再访问 `http://NAS-IP:3000/api/health`；返回 `status: ok` 与 `storage: postgresql` 才表示数据库读写链路就绪。

应用会自动执行幂等的 `CREATE TABLE IF NOT EXISTS`。运行账号至少需要目标数据库与 schema 的连接、使用和建表权限，以及应用表的 `SELECT`、`INSERT`、`UPDATE` 权限。生产环境可先用迁移账号建表，再收紧运行账号权限。若 PostgreSQL 在另一个 Container Manager Project 中，确认它监听 NAS 局域网地址或让两个项目加入同一个受控 Docker 网络。

官方 Project 功能支持以 Compose 文件创建、启动、停止、重建和清理项目：[Synology Container Manager Project](https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project?version=7)。

## 5. 反向代理与 HTTPS

可以在 **Control Panel > Login Portal > Advanced > Reverse Proxy** 创建规则：

```text
Source:      https://dashboard.example.com:443
Destination: http://127.0.0.1:3000
```

配置完成并验证可访问后，可将 `.env` 中的 `BIND_ADDRESS` 改成 `127.0.0.1`，减少直接暴露的监听接口。若目标地址使用 NAS 局域网 IP，则按实际代理路径保留 `0.0.0.0`。

本应用不提供互联网边界级身份认证。建议仅在家庭局域网或可信 VPN 中使用，或在反向代理层增加身份认证与来源 IP 访问控制。DSM 反向代理和访问控制说明见 [Login Portal](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_login_portal?version=7)。

应用也支持可选 Basic Auth：在 `.env` 中同时设置 `BASIC_AUTH_USERNAME` 与 `BASIC_AUTH_PASSWORD` 后重建容器。凭据只有在 HTTPS 下传输才安全，不能用它替代公网场景的成熟身份代理。`/api/health` 不要求登录，以供容器健康检查使用。

内网服务可以同时配置内网 `url` 和可选的互联网 `externalUrl`。顶栏的“内网 / 外网”开关只改变内网服务打开的链接，不会替代 DSM 反向代理、DNS、证书、端口转发或身份认证。外网地址为空时，对应入口会保持禁用，不会回退到内网地址。外网书签使用一个公开 `url`，始终打开该地址，并在服务中心与首页单独显示。互联网地址建议使用 HTTPS，且不要在 URL 中嵌入密码或 Token。

切换模式按浏览器和站点来源保存在 `localStorage`，不会写入 PostgreSQL。通过内网 IP 和公网域名访问控制台属于两个不同来源，因此可以各自保留模式。服务图标始终从容器访问条目自身的 `url`：内网服务使用内网地址，外网书签使用公开地址；未显式设置 `check.url` 的 HTTP 健康检查只针对内网服务，并固定使用其内网 `url`。因此还需确保容器能够解析并访问相应目标。

## 6. 宿主指标挂载

默认 Compose 使用三个只读挂载：

| NAS 路径 | 容器路径 | 用途 |
| --- | --- | --- |
| `/proc` | `/host/proc` | CPU、内存、负载、网络计数器 |
| `/sys` | `/host/sys` | 网卡和可用的温度传感器 |
| `/volume1` | `/host/storage` | 存储容量 |

部分群晖机型、DSM 版本或硬件驱动不会在 `/sys` 暴露温度。这时监控页会用系统运行时间和容器状态替代温度卡片。若主存储卷不是 `/volume1`，修改 `HOST_STORAGE_PATH`。

三个存储空间的群晖可以额外使用 `docker-compose.synology-storage.yml`。它会继续使用主文件中的 `/volume1`，并把 `/volume2`、`/volume3` 只读映射到独立容器路径：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.database-file.yml \
  -f docker-compose.synology-storage.yml \
  up -d
```

存储空间数量不同，应复制此覆盖文件并按实际情况增删挂载，不要映射不存在的路径。应用会逐卷展示用量，并在顶部给出所有可见卷的合计。主机显示名称在页面“系统设置”中维护并保存到 PostgreSQL；留空时会自动读取宿主 `/proc` 暴露的 hostname。

若不希望容器看到某类宿主信息，可以删除对应挂载；相关指标会显示为空或不可用。

## 7. iKuai 动态拓扑（可选）

1. 登录 iKuai Web 管理界面，在 **系统 > 认证 > API Token** 创建专用 Token。不同固件的菜单名称可能略有差异；目标版本必须支持 `/api/v4.0/monitoring/*` 接口。如果当前固件支持权限范围，只授予系统监控、在线终端、下游设备和物理接口所需的读取权限。
2. 将 Token 写入 `/volume1/docker/home-server-dashboard/secrets/ikuai_token`。文件只保留一行 Token，不加引号、变量名或说明文字；结尾换行可有可无。然后将所有者设为容器用户、权限设为 `0400`。
3. 在 `.env` 设置 `IKUAI_BASE_URL` 为路由器的 HTTP(S) origin，可包含端口，但不能包含账号、密码、路径、查询参数或片段。保持 `IKUAI_TOKEN` 和 `IKUAI_TOKEN_FILE` 为空；覆盖文件会自动设置容器内文件路径。
4. 保持 `IKUAI_ALLOW_INSECURE_TLS=false`。只有路由器位于可信内网、使用 HTTPS 且确实无法配置有效证书时才改为 `true`。该选项会关闭应用到路由器的证书校验，不能用于公网目标。
5. 确认 NAS 防火墙、VLAN 和路由规则允许 dashboard 容器访问该路由器地址，然后通过 SSH 部署：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.database-file.yml \
  -f docker-compose.ikuai.yml \
  up -d
```

多存储空间或 Docker Socket 覆盖文件可以继续追加为其他 `-f` 参数。启动后先在服务中心把工作负载标记为“虚拟机”或“Docker 应用”，把 ESXi、Proxmox、群晖或普通 Linux 宿主标记为“基础设施”。再进入“系统设置 > 拓扑数据源”，选择“iKuai v4 API”、设置刷新间隔，按需添加任意数量的宿主并勾选其工作负载。Token 和路由器地址只存在于服务端部署环境，不进入 PostgreSQL 配置或 JSON 导出。

应用只向四类固定监控端点发送带 Bearer Token 的 `GET` 请求，不跟随重定向，并限制超时和响应大小。iKuai 返回的终端不会直接显示；服务端只保留 Internet、路由器、所选宿主及明确分类的内网 VM/Docker 服务。路由器未配置、Token 无效或 API 暂时不可用时，拓扑页仍使用服务中心数据生成配置过的宿主分支；未分配工作负载会显示在通用分支中，概览、服务目录和系统监控仍可正常使用。

## 8. Docker Socket：默认禁用

展示 Docker 容器列表需要访问 Docker API，但这项权限风险很高。基础 `docker-compose.yml` 没有挂载 Socket，所以“可见容器”默认显示为未启用，而不是容器总数。启用后，应用只调用 `GET /containers/json?all=1`，单次查询受 `DOCKER_API_TIMEOUT_MS` 限制；查询超时或失败时概览接口仍会正常返回，并把容器列表降级为空数组。

确需使用时，把 `docker-compose.socket.yml` 同时加入 Project 配置，或通过 SSH 执行：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.socket.yml \
  up -d
```

群晖上的 Socket 通常由 root 持有，因此可选 override 会显式使用 `user: "0:0"`；这会撤销基础镜像的非 root 保护。`/var/run/docker.sock:/var/run/docker.sock:ro` 中的 `:ro` 只限制文件系统挂载方式，并不会把 Docker API 变为只读。能够调用该 Socket 的进程通常可以控制整台 Docker 主机。推荐在控制台与 Docker Socket 之间部署最小权限 Socket Proxy，只允许应用实际需要的 `GET /containers/json` 等查询端点，并让控制台继续以 UID 1000 运行。Docker 官方安全说明：[Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)。

## 9. 升级与回滚

使用 SSH 时：

```bash
cd /volume1/docker/home-server-dashboard
docker compose pull
docker compose -f docker-compose.yml -f docker-compose.database-file.yml up -d
docker compose -f docker-compose.yml -f docker-compose.database-file.yml ps
```

在 Container Manager 中，也可以进入 Project 后重新拉取镜像并重建。升级时应沿用当前启用的所有覆盖文件；启用了 iKuai 动态拓扑时，需要继续加入 `-f docker-compose.ikuai.yml`。升级前记录当前镜像标签；发生问题时，将 `DASHBOARD_IMAGE` 改回旧版本标签后再次部署。

从旧版本升级时无需修改 Compose、环境变量或 PostgreSQL 表结构。旧配置中的 `url` 会继续作为内网地址使用，应用会补充空的 `externalUrl`，并把旧条目保守归为“内网基础设施”。升级后在服务编辑页逐项填写互联网地址与运行环境；外网云服务应改为“外网书签”。

## 10. 备份与恢复

页面配置的权威数据源是 PostgreSQL。使用 PostgreSQL 自带备份工具或现有数据库备份任务定期执行 `pg_dump`，同时安全备份 `.env`、`secrets/database_url` 和可选的 `secrets/ikuai_token`。`data/config.json` 仅是旧版本迁移来源，不再是 PostgreSQL 模式的权威数据。不要依赖容器可写层保存数据。

恢复时：

1. 停止 Project。
2. 恢复 PostgreSQL 数据库，再恢复 `.env` 和秘密文件。
3. 检查秘密文件权限与数据库网络访问控制。
4. 重新启动 Project，并确认 `/api/health` 返回 `storage: postgresql`。

群晖官方也建议备份映射到 NAS 的持久化目录：[How do I back up Docker containers?](https://kb.synology.com/en-global/DSM/tutorial/How_do_I_back_up_Docker_containers)。

## 11. 常见问题

### 镜像拉取失败

- 确认 GHCR Package 已设为 Public；公开镜像无需登录即可拉取。
- 确认 NAS DNS、网关、系统时间和代理设置正确。
- 用明确版本标签排除 `latest` 缓存问题。

### 容器不断重启

- 在 Container Manager 查看日志。
- 确认数据库 URI、`pg_hba.conf`、`listen_addresses`、DSM 防火墙和秘密文件权限。
- 确认健康接口 `/api/health` 可访问且返回 `storage: postgresql`。

### 没有温度或 Docker 数据

- 温度依赖 NAS 内核是否向 `/sys` 暴露传感器。
- Docker 数据默认关闭，只有显式启用 Socket 或安全代理后才会出现。

### 页面能打开但服务检查失败

- 状态检查由容器发起，不是由浏览器发起。
- 未单独填写 HTTP 检测地址时，检查固定使用服务的内网 `url`，不会随顶栏模式切换。
- 确认容器 DNS 能解析目标主机名，并能访问目标 VLAN 和端口。
- 自签名 HTTPS、ACL、防火墙或目标服务拒绝请求都可能导致检查失败。

### iKuai 拓扑显示回退状态

- 确认页面“系统设置”已选择“iKuai v4 API”并保存。
- 确认已经添加宿主、分配工作负载，并给需要显示的内网条目设置正确运行环境。
- 确认部署时加入 `docker-compose.ikuai.yml`，且 `.env` 中 `IKUAI_BASE_URL` 只包含路由器 origin。
- 确认 `secrets/ikuai_token` 是容器用户可读的普通文件，内容只有一行有效 Token；不要同时设置 `IKUAI_TOKEN` 与 `IKUAI_TOKEN_FILE`。
- 确认路由器固件支持 v4 监控 API，Token 具有相应读取权限，容器网络可以访问路由器。
- HTTPS 证书错误应优先通过有效证书修复。只有可信内网自签名路由器才使用 `IKUAI_ALLOW_INSECURE_TLS=true`。

### 外网模式下服务无法打开

- 先在服务编辑页确认已填写完整的 `externalUrl`；未配置时入口会按设计保持禁用。
- 此切换不会自动创建公网入口。确认 DSM 反向代理、DNS、HTTPS 证书、身份认证和防火墙规则已经独立配置并验证。
- 当前模式按站点来源保存在浏览器中；通过另一个域名或 IP 打开控制台时需要重新选择。

### 服务图标没有显示

- 图标由容器根据条目自身的 `url` 发现并代理获取；内网服务使用内网地址，外网书签使用公开地址。先确认容器能解析并访问该地址以及页面明确声明的公网 HTTPS 图标主机。
- 默认抓取超时为 5000 毫秒，可通过 `SERVICE_ICON_TIMEOUT_MS` 调整。
- 可信内网服务使用自签名、过期或与 IP 地址不匹配的证书时，在服务编辑窗口打开“允许自签名 HTTPS 图标”。该设置只作用于当前服务，不会关闭跨域 HTTPS 图标的证书校验。
- `SERVICE_ICON_ALLOW_INSECURE_TLS=true` 会全局覆盖所有服务，仅保留用于兼容旧部署，不建议作为常规修复。

