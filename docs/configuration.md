# 配置说明

应用有两层配置：Compose 部署参数由 `.env` 或秘密文件提供；页面内容保存在 PostgreSQL 表 `home_server_dashboard_config` 的 JSONB 文档中。仓库中的 `config/default.json` 是数据库尚无记录时的默认值。

## Compose 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DASHBOARD_IMAGE` | `ghcr.io/gexiaobin/home-server-dashboard:latest` | 要运行的镜像，生产环境建议固定版本标签 |
| `BIND_ADDRESS` | `0.0.0.0` | 宿主监听地址；仅经本机反向代理访问时可改为 `127.0.0.1` |
| `APP_PORT` | `3000` | NAS 对外端口，不改变容器内部端口 |
| `STORAGE_BACKEND` | `postgresql` | Docker 部署使用 PostgreSQL；本地未设置时 `auto` 可回退文件存储 |
| `DATABASE_URL` | 空 | PostgreSQL URI；与 `DATABASE_URL_FILE` 二选一 |
| `DATABASE_URL_FILE` | 空 | 容器内的 URI 秘密文件路径；与 `DATABASE_URL` 二选一 |
| `DATABASE_URL_FILE_PATH` | `./secrets/database_url` | 使用数据库秘密文件 override 时的宿主文件路径 |
| `DATABASE_POOL_MAX` | `5` | PostgreSQL 连接池上限 |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | 数据库连接超时，单位毫秒 |
| `DATABASE_QUERY_TIMEOUT_MS` | `5000` | 数据库查询和语句超时，单位毫秒 |
| `DATA_PATH` | `./data` | 旧 `config.json` 的一次性迁移目录，也供本地文件模式使用 |
| `HOST_STORAGE_PATH` | `/volume1` | 用于容量统计的宿主存储路径，只读挂载 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `SERVICE_CHECK_TIMEOUT_MS` | `5000` | HTTP/TCP 探测超时，单位毫秒，必须为正整数 |
| `SERVICE_ICON_TIMEOUT_MS` | `5000` | 发现并抓取单个服务真实图标的总超时，单位毫秒，必须为正整数 |
| `SERVICE_ICON_ALLOW_INSECURE_TLS` | `false` | 是否仅为服务图标抓取跳过 HTTPS 证书校验；只能设为 `true` 或 `false` |
| `BASIC_AUTH_USERNAME` | 空 | 可选 Basic Auth 用户名；必须与密码同时设置 |
| `BASIC_AUTH_PASSWORD` | 空 | 可选 Basic Auth 密码；必须与用户名同时设置 |

容器内部运行契约：

| 变量 | Compose 值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Express 监听所有容器接口 |
| `PORT` | `3000` | Express 监听端口 |
| `DATA_DIR` | `/app/data` | 旧 JSON 迁移目录；`STORAGE_BACKEND=file` 时作为持久化目录 |
| `HOST_PROC` | `/host/proc` | 宿主 `/proc` 的只读映射 |
| `HOST_SYS` | `/host/sys` | 宿主 `/sys` 的只读映射 |
| `HOST_STORAGE` | `/host/storage` | 宿主存储卷的只读映射 |
| `DOCKER_SOCKET` | 未设置 | 可选 Docker Socket；默认禁用，详见群晖部署文档 |

不要把 `.env`、`secrets/` 或数据库 URI 提交到公共仓库。浏览器端代码中的任何变量都不能作为秘密保存；NAS 凭据、Token 和 SNMP 密码只能放在受控的服务端环境或专用秘密管理方案中。

推荐使用 `docker-compose.database-file.yml`，把宿主秘密文件只读挂载到 `/run/secrets/database_url`。该文件只包含一行 URI，无引号、无变量名，并应限制为仅管理员可读。应用不会记录连接串；数据库不可用时 `/api/health` 返回 `503`。

启用 Basic Auth 后，除 `/api/health` 外的页面和 API 都需要登录。Basic Auth 仅编码凭据而不加密传输，因此必须同时使用 HTTPS。如果密码包含 Compose 插值字符（例如 `$`），请按 Compose `.env` 语法使用单引号或正确转义。

服务目录中的图标由 Express 根据数据库内每个服务的 `url` 访问目标页面，并解析页面声明的 favicon；浏览器不会直接访问第三方图标地址。`SERVICE_ICON_ALLOW_INSECURE_TLS` 默认必须保持 `false`。只有目标是可信家庭内网服务，并且该服务确实使用自签名或已过期证书时，才可设为 `true`；这会关闭所有服务图标抓取请求的 HTTPS 证书校验，因此不适合公网或不受信任的目标。该选项不影响页面自身的 HTTPS，也不改变 HTTP/TCP 状态检查设置。

## 应用配置结构

可以通过页面维护配置。保存时会先校验完整文档，再使用 `INSERT ... ON CONFLICT DO UPDATE` 原子写入固定的 `id = 1` 记录。不要直接修改表内 JSONB；需要批量迁移时使用页面中的 JSON 导入/导出功能。

```json
{
  "settings": {
    "title": "HomeLab Console",
    "location": "Home network",
    "refreshInterval": 5000
  },
  "services": [
    {
      "id": "synology-dsm",
      "name": "Synology DSM",
      "description": "存储、备份与系统管理",
      "url": "https://nas.home.arpa:5001",
      "category": "基础设施",
      "icon": "server",
      "favorite": true,
      "check": {
        "type": "none"
      }
    }
  ],
  "topology": {
    "nodes": [
      {
        "id": "nas",
        "label": "Synology NAS",
        "type": "nas",
        "serviceId": "synology-dsm",
        "x": 50,
        "y": 50
      }
    ],
    "links": []
  }
}
```

### `settings`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 控制台名称，不能为空 |
| `location` | string | 位置或环境说明 |
| `refreshInterval` | integer | 指标刷新间隔，单位毫秒，允许 `1000` 到 `3600000` |

### `services[]`

每个服务的 `id` 必须非空且唯一。`url` 是导航目标；`check` 控制服务端健康检查。

HTTP 检查：

```json
{
  "type": "http",
  "url": "http://jellyfin:8096/health"
}
```

TCP 检查：

```json
{
  "type": "tcp",
  "host": "192.168.1.20",
  "port": 22
}
```

关闭主动检查：

```json
{
  "type": "none"
}
```

状态检查从 Express 容器发出。目标地址必须能从容器网络访问，并应避免把检查功能开放给不可信用户，否则可能被用于探测家庭内网。

### `topology.nodes[]`

支持的节点类型：`internet`、`router`、`nas`、`server`、`vm`、`container`、`client`。

- `id`：拓扑内唯一标识。
- `label`：界面显示名称。
- `serviceId`：可选，关联 `services[]` 中的服务。
- `x`、`y`：拓扑画布中的百分比坐标，通常使用 `0` 到 `100`。

### `topology.links[]`

```json
{
  "source": "router",
  "target": "nas",
  "label": "2.5 GbE"
}
```

`source` 与 `target` 应对应节点 ID。拓扑是显式配置，不会主动扫描局域网。

## 数据迁移

从旧版文件存储升级时，保留 `data/config.json` 并连接到空数据库。应用首次初始化表时会校验并导入该文件；表已有记录时不会覆盖数据库。确认导入成功后继续保留 JSON 备份，直到完成数据库备份验证。

迁移到另一台主机时，优先使用 `pg_dump` 与 `pg_restore` 备份 PostgreSQL；只迁移页面配置也可以在设置页导出 JSON，再在目标实例导入。秘密文件必须通过安全渠道单独迁移，不能放进数据库备份、镜像或 Git 仓库。

