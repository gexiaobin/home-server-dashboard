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
    `-- database_url
```

将仓库中的 `docker-compose.yml`、`docker-compose.database-file.yml` 和 `.env.example` 放入 `home-server-dashboard` 目录，并把 `.env.example` 复制为 `.env`。`secrets/database_url` 只写一行 PostgreSQL URI，不加引号。至少检查这些值：

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
TZ=Asia/Shanghai
SERVICE_CHECK_TIMEOUT_MS=5000
SERVICE_ICON_TIMEOUT_MS=5000
SERVICE_ICON_ALLOW_INSECURE_TLS=false
BASIC_AUTH_USERNAME=
BASIC_AUTH_PASSWORD=
```

生产环境建议将镜像改成明确版本，例如 `:1.0.0`，避免 `latest` 自动变化。不要把实际 URI 写入 Compose、`.env`、README 或截图；数据库应使用专用账号，不要长期使用 `postgres` 超级用户。

服务目录会从每个服务的内网 `url` 抓取页面声明的真实 favicon。切换到外网模式不会让容器改为访问互联网地址。`SERVICE_ICON_ALLOW_INSECURE_TLS` 应保持默认的 `false`；只有可信家庭内网服务使用自签名或已过期 HTTPS 证书、导致图标无法加载时，才改为 `true` 后重建容器。该设置会对所有服务图标抓取关闭证书校验，不应与公网或不受信任的服务地址一起使用。

## 3. 目录权限

镜像以内置 `node` 用户（UID/GID 1000）运行。秘密文件只需容器可读，建议权限为 `0400` 或 `0440`；`data` 目录只在旧 JSON 迁移或文件模式下需要写权限。如果日志出现 `EACCES` 或 `permission denied`，只修正应用自己的目录，不要修改共享目录根权限：

```bash
sudo chown -R 1000:1000 /volume1/docker/home-server-dashboard/data
sudo chown -R 1000:1000 /volume1/docker/home-server-dashboard/secrets
sudo chmod 700 /volume1/docker/home-server-dashboard/secrets
sudo chmod 400 /volume1/docker/home-server-dashboard/secrets/database_url
```

不要对 `/volume1` 或共享文件夹根目录递归执行 `chown`。

## 4. 在 Container Manager 创建 Project

1. 打开 **Container Manager > Project**。
2. 点击 **Create**，项目名填写 `home-server-dashboard`。
3. Path 选择 `/volume1/docker/home-server-dashboard`。
4. 若界面只接受一个 Compose 文件，把 `docker-compose.database-file.yml` 中的 `environment` 与 `volumes` 条目合并到主文件；SSH 部署则可同时传入两个 `-f` 文件。
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

每个服务可以同时配置内网 `url` 和可选的互联网 `externalUrl`。顶栏的“内网 / 外网”开关只改变浏览器打开的链接，不会替代 DSM 反向代理、DNS、证书、端口转发或身份认证。外网地址为空时，对应入口会保持禁用，不会回退到内网地址。互联网地址建议使用 HTTPS，且不要在 URL 中嵌入密码或 Token。

切换模式按浏览器和站点来源保存在 `localStorage`，不会写入 PostgreSQL。通过内网 IP 和公网域名访问控制台属于两个不同来源，因此可以各自保留模式。服务图标和未显式设置 `check.url` 的 HTTP 健康检查始终从容器访问内网 `url`，所以还需确保容器能够解析内网 DNS 并访问目标端口。

## 6. 宿主指标挂载

默认 Compose 使用三个只读挂载：

| NAS 路径 | 容器路径 | 用途 |
| --- | --- | --- |
| `/proc` | `/host/proc` | CPU、内存、负载、网络计数器 |
| `/sys` | `/host/sys` | 网卡和可用的温度传感器 |
| `/volume1` | `/host/storage` | 存储容量 |

部分群晖机型、DSM 版本或硬件驱动不会在 `/sys` 暴露温度，这时温度为空属于正常降级。若存储卷不是 `/volume1`，修改 `HOST_STORAGE_PATH`。

若不希望容器看到某类宿主信息，可以删除对应挂载；相关指标会显示为空或不可用。

## 7. Docker Socket：默认禁用

展示 Docker 容器列表需要访问 Docker API，但这项权限风险很高。基础 `docker-compose.yml` 没有挂载 Socket。

确需使用时，把 `docker-compose.socket.yml` 同时加入 Project 配置，或通过 SSH 执行：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.socket.yml \
  up -d
```

群晖上的 Socket 通常由 root 持有，因此可选 override 会显式使用 `user: "0:0"`；这会撤销基础镜像的非 root 保护。`/var/run/docker.sock:/var/run/docker.sock:ro` 中的 `:ro` 只限制文件系统挂载方式，并不会把 Docker API 变为只读。能够调用该 Socket 的进程通常可以控制整台 Docker 主机。推荐在控制台与 Docker Socket 之间部署最小权限 Socket Proxy，只允许应用实际需要的 `GET /containers/json` 等查询端点，并让控制台继续以 UID 1000 运行。Docker 官方安全说明：[Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)。

## 8. 升级与回滚

使用 SSH 时：

```bash
cd /volume1/docker/home-server-dashboard
docker compose pull
docker compose -f docker-compose.yml -f docker-compose.database-file.yml up -d
docker compose -f docker-compose.yml -f docker-compose.database-file.yml ps
```

在 Container Manager 中，也可以进入 Project 后重新拉取镜像并重建。升级前记录当前镜像标签；发生问题时，将 `DASHBOARD_IMAGE` 改回旧版本标签后再次部署。

从单一服务地址版本升级时无需修改 Compose、环境变量或 PostgreSQL 表结构。旧配置中的 `url` 会继续作为内网地址使用，应用会兼容缺少 `externalUrl` 的 JSONB 文档。升级后的默认模式是内网；部署完成后可在服务编辑页逐项填写互联网地址。

## 9. 备份与恢复

页面配置的权威数据源是 PostgreSQL。使用 PostgreSQL 自带备份工具或现有数据库备份任务定期执行 `pg_dump`，同时安全备份 `.env` 和 `secrets/database_url`。`data/config.json` 仅是旧版本迁移来源，不再是 PostgreSQL 模式的权威数据。不要依赖容器可写层保存数据。

恢复时：

1. 停止 Project。
2. 恢复 PostgreSQL 数据库，再恢复 `.env` 和秘密文件。
3. 检查秘密文件权限与数据库网络访问控制。
4. 重新启动 Project，并确认 `/api/health` 返回 `storage: postgresql`。

群晖官方也建议备份映射到 NAS 的持久化目录：[How do I back up Docker containers?](https://kb.synology.com/en-global/DSM/tutorial/How_do_I_back_up_Docker_containers)。

## 10. 常见问题

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

### 外网模式下服务无法打开

- 先在服务编辑页确认已填写完整的 `externalUrl`；未配置时入口会按设计保持禁用。
- 此切换不会自动创建公网入口。确认 DSM 反向代理、DNS、HTTPS 证书、身份认证和防火墙规则已经独立配置并验证。
- 当前模式按站点来源保存在浏览器中；通过另一个域名或 IP 打开控制台时需要重新选择。

### 服务图标没有显示

- 图标由容器根据服务配置中的内网 `url` 获取，先确认容器能解析并访问目标地址。
- 默认抓取超时为 5000 毫秒，可通过 `SERVICE_ICON_TIMEOUT_MS` 调整。
- 可信内网服务使用自签名或已过期证书时，可将 `SERVICE_ICON_ALLOW_INSECURE_TLS` 设为 `true` 后重建；不要为公网或不受信任的服务关闭证书校验。

