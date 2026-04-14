# 架构说明

## 组成

项目分成两部分：

- `plugins/server-plugin-switch/index.js`
- `data/<user>/extensions/server-plugin-switch/`

前者负责真正的插件枚举、启停切换、重启与预检 API。
后者只负责在酒馆内提供面板。

## 启停模型

项目不做当前进程内热插拔。
它只管理“下次启动是否加载”。

目录插件：

- 如果 `package.json main` 指向某个入口，会优先处理那个入口
- 如果目录根级还存在 `index.js / index.cjs / index.mjs` 回退入口，也一起处理
- 停用时把这些入口改名为 `*.spm-disabled`
- 恢复时再改回原名

单文件插件：

- 直接把插件文件改名为 `*.spm-disabled`

## 重启模型

### 自动模式

- 只退出当前 SillyTavern 进程
- 依赖 Docker / `pm2` / `systemd` / 外部保活重新拉起

### 自定义命令模式

- 保存用户提供的启动命令
- 用 detached 方式先安排新进程
- 再退出旧进程

## 配置存储

运行配置写到：

- `data/.server-plugin-switch/config.json`

主要内容包括：

- `restartMode`
- `customCommand`
- `restartDelayMs`
- `pluginStates`
- `lastRestartResult`
