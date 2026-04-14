# 常见问题排查

## 扩展面板没出现

先确认 extension 目录存在：

- `data/<user>/extensions/server-plugin-switch/`

再确认前端已经硬刷新。

## 后端 API 不响应

先看启动日志里是否出现：

- `Initializing plugin from .../plugins/server-plugin-switch/index.js`

如果没有，检查：

- `plugins/server-plugin-switch/index.js` 是否存在
- `config.yaml` 里的 `enableServerPlugins` 是否为 `true`

## 切换后为什么没立刻生效

因为项目不做当前进程内热插拔。
启用 / 停用只影响下次启动。

## 自动模式为什么没自动回来

自动模式只负责退出。
是否自动回来要看：

- Docker restart policy
- `pm2`
- `systemd`
- 其它外部保活

## 自定义命令模式为什么起不来

常见原因：

- 命令本身写错
- 依赖的工作目录不对
- 命令只适用于你平时的交互 shell

先用面板里的 `测试命令` 做预检，再真正重启。
