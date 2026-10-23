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
| `HOST_STORAGE_PATH` | `/volume1` | 用于容量统计的主存储路径，只读挂载 |
| `HOST_STORAGE_PATH_2` | `/volume2` | 群晖多存储覆盖文件使用的第二个存储路径 |
| `HOST_STORAGE_PATH_3` | `/volume3` | 群晖多存储覆盖文件使用的第三个存储路径 |
| `DOCKER_API_TIMEOUT_MS` | `3000` | 可选 Docker 容器列表查询的总超时，单位毫秒 |
| `IKUAI_BASE_URL` | 空 | iKuai 路由器的 HTTP(S) origin，例如协议、主机与可选端口；不能包含凭据、路径、查询参数或片段 |
| `IKUAI_TOKEN` | 空 | 可选的 iKuai v4 API Token；与 `IKUAI_TOKEN_FILE` 二选一，生产部署不推荐直接使用环境变量 |
| `IKUAI_TOKEN_FILE` | 空 | 容器内的 iKuai Token 文件路径；与 `IKUAI_TOKEN` 二选一 |
| `IKUAI_TOKEN_FILE_PATH` | `./secrets/ikuai_token` | 使用 iKuai 秘密文件覆盖文件时的宿主文件路径 |
| `IKUAI_TIMEOUT_MS` | `5000` | 每个 iKuai API 请求的超时，单位毫秒，允许 `100` 到 `60000` |
| `IKUAI_ALLOW_INSECURE_TLS` | `false` | 是否跳过 iKuai HTTPS 证书校验；仅限可信内网自签名路由器，只能设为 `true` 或 `false` |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `SERVICE_CHECK_TIMEOUT_MS` | `5000` | HTTP/TCP 探测超时，单位毫秒，必须为正整数 |
| `SERVICE_ICON_TIMEOUT_MS` | `5000` | 发现并抓取单个服务真实图标的总超时，单位毫秒，必须为正整数 |
| `SERVICE_ICON_ALLOW_INSECURE_TLS` | `false` | 是否仅为服务页面及其同源图标跳过 HTTPS 证书校验；跨域图标不受此选项影响，只能设为 `true` 或 `false` |
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
| `HOST_STORAGE` | `/host/storage` | 逗号分隔的容器内存储挂载点；群晖覆盖文件会加入另外两个卷 |
| `DOCKER_SOCKET` | 未设置 | 可选 Docker Socket；默认禁用，详见群晖部署文档 |

不要把 `.env`、`secrets/` 或数据库 URI 提交到公共仓库。浏览器端代码中的任何变量都不能作为秘密保存；NAS 凭据、Token 和 SNMP 密码只能放在受控的服务端环境或专用秘密管理方案中。

推荐使用 `docker-compose.database-file.yml`，把宿主秘密文件只读挂载到 `/run/secrets/database_url`。该文件只包含一行 URI，无引号、无变量名，并应限制为仅管理员可读。应用不会记录连接串；数据库不可用时 `/api/health` 返回 `503`。

iKuai 动态拓扑同样推荐使用 `docker-compose.ikuai.yml`。在 iKuai Web 管理界面的 **系统 > 认证 > API Token** 创建专用 Token，将其单独保存到宿主 `IKUAI_TOKEN_FILE_PATH` 指定的文件。文件只包含一行 Token，不加引号、变量名或其他说明；结尾换行可有可无。覆盖文件会只读挂载到 `/run/secrets/ikuai_token`，并自动将 `IKUAI_TOKEN_FILE` 指向该路径。直接使用 `IKUAI_TOKEN` 时，Token 会出现在容器检查信息中，不适合长期部署。两种方式不能同时设置。

`IKUAI_BASE_URL` 和 Token 只由服务端读取，不会保存到 PostgreSQL、返回给浏览器或进入 JSON 导出。应用固定访问 `/api/v4.0/monitoring/system`、`clients-online`、`downstream` 和 `interfaces-physical` 只读端点，不接受 API 重定向。默认会严格校验 HTTPS 证书；仅在确认目标是可信内网路由器且无法配置有效证书时，才启用 `IKUAI_ALLOW_INSECURE_TLS`。

启用 Basic Auth 后，除 `/api/health` 外的页面和 API 都需要登录。Basic Auth 仅编码凭据而不加密传输，因此必须同时使用 HTTPS。如果密码包含 Compose 插值字符（例如 `$`），请按 Compose `.env` 语法使用单引号或正确转义。

服务目录中的图标由 Express 根据每个条目的 `url` 访问目标页面，并解析页面声明的 favicon，包括页面明确引用的公网 HTTPS CDN 图标。抓取器支持标准 HTTP 重定向，以及云控制台常见的成功响应 `Location` 跳转；页面未声明图标时会依次尝试常见的 `/favicon.ico`、`/favicon.svg`、`/favicon.png` 和 `/apple-touch-icon.png`。内网服务的 `url` 是内网地址，外网书签的 `url` 是公开书签地址。图标由服务端代理，浏览器不会直接访问该第三方地址；切换网络模式不会改变用于发现图标的 `url`。

抓取会限制总超时、响应大小和候选数，并根据实际字节判断图片类型。外网书签页面仅允许在 HTTPS 默认端口下跳转到同一可注册域名；初始主机和每次换源后的主机都必须全部解析为公网地址，实际连接会固定到该次校验的地址。页面声明的跨域图标也只允许 HTTPS 默认端口并执行相同的公网 DNS 校验和连接固定；每个图标候选的重定向必须保持在该候选自身的 origin。由于服务页面能够指定第三方图标主机，只应配置可信页面，并注意第三方会看到 NAS 的出口 IP。

严格 TLS 校验是默认行为。可信家庭内网设备使用自签名、过期或与 IP 地址不匹配的证书时，可在该服务的编辑窗口打开“允许自签名 HTTPS 图标”，对应 `iconAllowInsecureTls: true`。该选项只影响这一个服务页面及其同源图标；跨域 HTTPS 图标仍会严格校验证书。自动发现被目标站点拦截时，可填写 `iconUrl` 直接指定图片；跨源地址仅允许默认端口 HTTPS，并仍执行公网 DNS、响应类型和重定向校验。`SERVICE_ICON_ALLOW_INSECURE_TLS=true` 是兼容旧部署的全局覆盖项，会对所有服务生效，通常不应使用。两种设置都不影响浏览器访问控制台所用的 HTTPS，也不改变 HTTP/TCP 状态检查设置。

## 应用配置结构

可以通过页面维护配置。保存时会先校验完整文档，再使用 `INSERT ... ON CONFLICT DO UPDATE` 原子写入固定的 `id = 1` 记录。不要直接修改表内 JSONB；需要批量迁移时使用页面中的 JSON 导入/导出功能。

```json
{
  "settings": {
    "title": "HomeLab Console",
    "location": "Home network",
    "hostDisplayName": "Synology DS920+",
    "refreshInterval": 5000
  },
  "services": [
    {
      "id": "synology-dsm",
      "name": "Synology DSM",
      "description": "存储、备份与系统管理",
      "url": "https://nas.home.arpa:5001",
      "externalUrl": "https://nas.example.com",
      "scope": "internal",
      "runtime": "infrastructure",
      "category": "基础设施",
      "icon": "server",
      "iconUrl": "",
      "iconAllowInsecureTls": false,
      "favorite": true,
      "check": {
        "type": "none"
      }
    }
  ],
  "topology": {
    "source": "ikuai",
    "refreshInterval": 15000,
    "hosts": [
      {
        "serviceId": "synology-dsm",
        "nodeType": "nas",
        "serviceIds": ["jellyfin", "immich"]
      }
    ],
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

每个条目的 `id` 必须非空且唯一。`scope` 决定它属于内网服务还是外网书签；`runtime` 决定内网条目是否进入某个拓扑分支。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `scope` | 否 | `internal`（默认）或 `external`；后者作为独立外网书签显示 |
| `runtime` | 否 | `infrastructure`（默认）、`vm` 或 `docker`；只有内网的 `vm`/`docker` 条目进入对应拓扑分支 |
| `url` | 是 | 内网服务的内网地址，或外网书签的公开地址；也供服务端获取真实图标 |
| `externalUrl` | 否 | 仅内网服务使用的互联网替代地址；为空时，外网模式下入口不可用且不会回退到内网地址 |
| `iconUrl` | 否 | 自定义图标的完整 HTTP(S) 地址；留空时自动发现。跨源地址仅允许默认端口 HTTPS |
| `iconAllowInsecureTls` | 否 | 默认 `false`；仅为此服务页面及同源图标跳过 HTTPS 证书校验，限可信内网的自签名设备使用 |

两个地址只允许使用完整的 `http://` 或 `https://` URL。互联网地址建议使用 HTTPS，并且不要在 URL 中放置密码、Token 或其他秘密，因为页面配置可以通过 API 读取和导出。

页面顶栏的“内网 / 外网”开关统一控制内网服务在概览、服务目录和网络拓扑中的导航目标。外网书签始终打开自身的 `url`，不受该开关影响。当前模式是浏览器本地偏好，保存在当前站点来源的 `localStorage` 中，不会写入 PostgreSQL，也不包含在 JSON 配置导入导出中。它只切换打开链接，不会建立反向代理、端口转发或公网访问能力。

`check` 控制服务端健康检查，与浏览器的当前模式相互独立。外网书签会被规范化为 `check: { "type": "none" }`，并且不会进入概览健康统计。

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

状态检查从 Express 容器发出。HTTP 检查未填写 `check.url` 时始终使用服务的内网 `url`，不会随浏览器切换到 `externalUrl`；显式填写 `check.url` 时则使用该固定地址。目标地址必须能从容器网络访问，并应避免把检查功能开放给不可信用户，否则可能被用于探测家庭内网。

### `topology`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | `manual` \| `ikuai` | `manual` 仅按服务目录生成结构；`ikuai` 额外从服务端配置的 iKuai v4 API 获取路由状态与宿主详情 |
| `refreshInterval` | integer | iKuai 拓扑刷新间隔，单位毫秒，允许 `5000` 到 `300000` |
| `hosts` | array | 宿主及工作负载关联列表；可配置任意数量的虚拟化平台或 Docker 宿主 |
| `nodes` | array | 兼容旧版导入的手工节点数据；服务目录拓扑不依赖该数组 |
| `links` | array | 兼容旧版导入的手工链路数据；服务目录拓扑不依赖该数组 |

`hosts[]` 中每项包含宿主的 `serviceId`、节点样式 `nodeType`（`server` 或 `nas`）和工作负载 ID 数组 `serviceIds`。宿主必须是 `scope: internal`、`runtime: infrastructure` 的服务；工作负载必须是内网的 `runtime: vm/docker` 服务。一个宿主和一个工作负载最多各出现一次，保存时会过滤无效或重复关联。未分配的虚拟机与 Docker 应用不会隐藏，而是分别进入“未分配虚拟机”和“未分配 Docker 应用”分支。

拓扑按 `Internet -> iKuai -> 配置的宿主 -> 工作负载` 生成，不限制宿主厂商、平台类型或数量。外网书签、未分配基础设施和其他 iKuai 终端不会显示。

在“系统设置 > 拓扑数据源”选择 iKuai 并保存后，拓扑页会按刷新间隔请求服务端。服务端使用 iKuai 的系统信息、下游设备、在线终端和物理接口补充路由吞吐及所选宿主的详情，不会把 Token 交给浏览器。iKuai 没有配置、Token 失效、接口不可达或响应异常时，页面会标记数据源不可用，并继续根据已登记服务生成相同的宿主结构，不会回退到旧版 `topology.nodes` 手工画布。

动态模式需要运行容器能够访问路由器地址。路由器固件必须提供 v4 监控 API；菜单名称和返回字段可能随版本变化。不要在 `IKUAI_BASE_URL` 中嵌入账号或 Token，也不要把 Token 填入页面配置。

### `topology.nodes[]`

支持的节点类型：`internet`、`router`、`nas`、`server`、`vm`、`container`、`client`、`switch`、`ap`、`camera`、`printer`。

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

`source` 与 `target` 应对应节点 ID。这些字段仅用于兼容旧版配置。服务目录模式不会主动扫描局域网；iKuai 模式只读取路由器已经维护的信息，并在返回给页面前投影为已登记服务拓扑，不会从应用容器发起任意网段扫描。

## 数据迁移

从旧版本升级时，不需要修改 PostgreSQL 表结构，也不需要执行 SQL 迁移。配置仍保存在同一个 JSONB 文档中；旧的 `vmHostServiceId` 与 `dockerHostServiceId` 会自动转换为 `hosts[]`，原先所有虚拟机和 Docker 应用分别归入对应宿主，后续保存不再写入旧字段。应用读取旧服务时也会补充 `scope: internal`、`runtime: infrastructure` 和空的 `externalUrl`。保守的 `infrastructure` 默认值可避免升级后把所有旧服务误当成 VM 或 Docker。部署完成后，可在服务编辑页调整运行环境，并在系统设置中添加、删除宿主或重新分配工作负载。

从旧版文件存储升级时，保留 `data/config.json` 并连接到空数据库。应用首次初始化表时会校验并导入该文件；表已有记录时不会覆盖数据库。确认导入成功后继续保留 JSON 备份，直到完成数据库备份验证。

迁移到另一台主机时，优先使用 `pg_dump` 与 `pg_restore` 备份 PostgreSQL；只迁移页面配置也可以在设置页导出 JSON，再在目标实例导入。秘密文件必须通过安全渠道单独迁移，不能放进数据库备份、镜像或 Git 仓库。

