# Portainer 生产发布

本项目的标准生产链路是：GitHub Actions 验证源码并构建镜像，发布到 GHCR，部署工具把完整 Git commit 对应的标签解析为不可变 registry digest，先在目标主机预拉取，再备份、更新 Portainer Stack、检查健康状态和配置一致性。生产 Compose 不使用可变标签。

```text
Git commit
  -> CI: test + lint + build
  -> GHCR: sha-<完整 40 位 commit>
  -> registry digest: ghcr.io/...@sha256:<64 位 digest>
  -> Portainer 预拉取
  -> 锁定 + 备份 + Stack 更新
  -> 健康检查与配置一致性检查
  -> 成功，或自动回退旧 Compose
```

## 发布约束

- `latest`、分支标签和 `sha-...` 标签便于发现镜像，但生产只写入解析后的 `@sha256:...`。
- 候选镜像必须在停止旧容器前拉取。拉取失败不会修改 Stack。
- GHCR 拉取按 0、10、30 秒退避重试，单次最长 15 分钟。
- 发布前保存 `/api/config`、应用数据目录、配置表 PostgreSQL dump、旧 Compose、环境变量和旧镜像引用。
- 更新后必须同时满足容器 Healthy、`/api/health` 使用 PostgreSQL、页面配置内容保持一致。
- 确定性失败自动恢复旧 Compose；网络结果不明确时保留部署锁，要求人工检查，避免第二次发布覆盖现场。
- 镜像 tar 不作为日常发布渠道，只用于 GHCR 长期不可用时的离线灾备。

## Portainer Stack

使用仓库根目录的 `compose.portainer.yaml` 创建 Portainer 原生 Stack。该模板保留群晖多存储空间、PostgreSQL URI 文件、iKuai Token 文件和只读宿主监控挂载。Docker Socket 具有宿主级高权限，即使以 `:ro` 挂载也不能限制 Docker API；不需要容器列表时应删除该挂载和 `DOCKER_SOCKET`。

生产创建时至少设置：

```dotenv
DASHBOARD_IMAGE=ghcr.io/gexiaobin/home-server-dashboard@sha256:<verified-digest>
APP_PORT=3000
DATA_PATH=/volume2/docker/home-server-dashboard/data
DATABASE_URL_FILE_PATH=/volume2/docker/home-server-dashboard/secrets/database_url
IKUAI_BASE_URL=https://192.168.123.1
IKUAI_TOKEN_FILE_PATH=/volume2/docker/home-server-dashboard/secrets/ikuai_token
IKUAI_ALLOW_INSECURE_TLS=true
TZ=Asia/Shanghai
```

秘密值继续保存在 NAS 的只读文件中，不写入 Stack 环境变量、Git 仓库或日志。

## 本地发布配置

发布配置默认位于 `.data/deploy/portainer.json`，该目录已被 Git 忽略。文件必须是 `0600`，示例中的值必须替换为实际私密值：

```json
{
  "baseUrl": "https://192.168.123.15:9443",
  "endpointId": 4,
  "apiKey": "PORTAINER_API_KEY",
  "caFile": "/absolute/path/to/portainer-ca.pem",
  "certificateSha256": "PORTAINER_CERTIFICATE_SHA256",
  "stackName": "home-server-dashboard",
  "lanOrigin": "http://192.168.123.8:3000",
  "imageRepository": "ghcr.io/gexiaobin/home-server-dashboard",
  "registryUsername": "",
  "registryToken": "",
  "healthTimeoutSeconds": 180,
  "databaseContainer": "postgresql",
  "databaseName": "postgres"
}
```

公开 GHCR 镜像不需要 registry 用户名和 Token。私有镜像必须使用专用、最小权限、仅 `read:packages` 的凭据，不要复用个人高权限登录 Token。

## 检查与发布

```bash
chmod 600 .data/deploy/portainer.json
npm run deploy:inspect

# 只验证 commit、GHCR digest、Stack 和当前生产容器，不产生部署写操作
npm run deploy:update -- --commit <完整40位commit> --dry-run

# 正式发布
npm run deploy:update -- --commit <完整40位commit>
```

成功结果会返回不可变镜像引用、健康状态和本地备份目录。备份目录权限为 `0700`，其中的文件为 `0600`；它可能包含生产配置和数据库数据，不得提交到 Git。

## 一次性迁移

从 Synology Container Manager 迁移时，先保存旧容器 inspect、旧 Compose、配置 JSON 与 ETag、配置表 dump 和 `/app/data`。然后停止并移除旧 Project 的容器登记，但保留 `/volume2/docker/home-server-dashboard/data`、`secrets/` 和 PostgreSQL 数据。最后使用相同挂载创建 Portainer 原生 Stack，并验证：

- Portainer Stack 不再显示 `external` 或 `Limited`；
- 容器状态为 Healthy；
- `/api/health` 返回 PostgreSQL 存储；
- 页面配置 ETag 和内容未变化；
- 服务中心、系统监控和多级拓扑仍显示原数据。

完成迁移后，所有升级只通过 Portainer 原生 Stack 和本发布器执行，不再同时由 Container Manager 管理同一容器。
