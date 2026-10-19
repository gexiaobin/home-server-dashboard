# 配置说明

应用有两层配置：Compose 部署参数由 `.env` 提供；页面内容保存在 `/app/data/config.json`。仓库中的 `config/default.json` 是首次启动或没有持久化配置时的默认值。

## Compose 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DASHBOARD_IMAGE` | `ghcr.io/gexiaobin/home-server-dashboard:latest` | 要运行的镜像，生产环境建议固定版本标签 |
| `BIND_ADDRESS` | `0.0.0.0` | 宿主监听地址；仅经本机反向代理访问时可改为 `127.0.0.1` |
| `APP_PORT` | `3000` | NAS 对外端口，不改变容器内部端口 |
| `DATA_PATH` | `./data` | 映射到 `/app/data` 的持久化目录；示例文件使用群晖绝对路径 |
| `HOST_STORAGE_PATH` | `/volume1` | 用于容量统计的宿主存储路径，只读挂载 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `SERVICE_CHECK_TIMEOUT_MS` | `5000` | HTTP/TCP 探测超时，单位毫秒，必须为正整数 |
| `BASIC_AUTH_USERNAME` | 空 | 可选 Basic Auth 用户名；必须与密码同时设置 |
| `BASIC_AUTH_PASSWORD` | 空 | 可选 Basic Auth 密码；必须与用户名同时设置 |

容器内部运行契约：

| 变量 | Compose 值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Express 监听所有容器接口 |
| `PORT` | `3000` | Express 监听端口 |
| `DATA_DIR` | `/app/data` | 可写配置目录 |
| `HOST_PROC` | `/host/proc` | 宿主 `/proc` 的只读映射 |
| `HOST_SYS` | `/host/sys` | 宿主 `/sys` 的只读映射 |
| `HOST_STORAGE` | `/host/storage` | 宿主存储卷的只读映射 |
| `DOCKER_SOCKET` | 未设置 | 可选 Docker Socket；默认禁用，详见群晖部署文档 |

不要把 `.env` 提交到公共仓库。浏览器端代码中的任何变量都不能作为秘密保存；NAS 凭据、Token 和 SNMP 密码只能放在受控的服务端环境或专用秘密管理方案中。

启用 Basic Auth 后，除 `/api/health` 外的页面和 API 都需要登录。Basic Auth 仅编码凭据而不加密传输，因此必须同时使用 HTTPS。如果密码包含 Compose 插值字符（例如 `$`），请按 Compose `.env` 语法使用单引号或正确转义。

## 应用配置结构

可以通过页面维护配置。保存后，完整配置写入 `<DATA_DIR>/config.json`。也可以在容器停止时直接编辑该 JSON；修改前先备份并确保 JSON 语法有效。

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

迁移到另一台主机时，只需复制持久化目录：

```text
data/
`-- config.json
```

目标主机启动前确认目录属于容器运行用户或对其可写。不要复制 `node_modules`、`dist` 或容器可写层。

