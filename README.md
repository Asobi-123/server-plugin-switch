# 后端插件切换台

[English](README_EN.md)

SillyTavern 的后端插件启停与重启工具。
它由一个 server plugin 和一个酒馆内 extension 面板组成。

它不做当前进程内热插拔。
它只负责管理“下次启动是否加载”，然后把重启这一步收口。

运行时配置写到：

- `data/.server-plugin-switch/config.json`

## 什么时候需要它

- 你装了几个 server plugin，想在酒馆里直接开关，不想每次去文件系统里改目录
- 你知道“切换启停后要重启”，但不想每次自己记命令
- 你的环境有的能自动拉起，有的只能手动命令拉起，想统一成一个入口

## 功能亮点

- **后端插件列表**：枚举当前 `plugins/` 目录里的 server plugin
- **启用 / 禁用切换**：只改下次启动状态，不碰当前进程里的已加载实例
- **目录插件安全停用**：同时处理 `package.json main` 和根级 `index.js / index.cjs / index.mjs` 回退入口
- **文件插件安全停用**：把单文件插件改名为 `*.spm-disabled`
- **自动模式重启**：只退出当前酒馆进程，交给 Docker / `pm2` / `systemd` / 外部保活接手
- **自定义命令模式**：保存一条用户自己的启动命令，以 detached 方式先拉起再退出旧进程
- **命令预检**：POSIX 用 `sh -n` 检查语法，Windows 至少确认 `cmd.exe` 可启动
- **最近结果回显**：记录最近一次预检或重启安排结果
- **安装脚本**：一键安装 / 卸载 server plugin 和 extension 面板

## 最快安装

```bash
git clone https://github.com/Asobi-123/server-plugin-switch.git
cd server-plugin-switch
node install.mjs
```

- 安装脚本会自动查找附近的 SillyTavern
- 如果找到多个目标，会在终端里让你选一个
- 脚本不会自动重启 SillyTavern，安装后请自己重启

## 安装脚本会做什么

- 自动定位 SillyTavern 根目录
- 把 extension 面板安装到 `data/<user>/extensions/server-plugin-switch`
- 把 server plugin 复制到 `plugins/server-plugin-switch`
- 自动把 `config.yaml` 里的 `enableServerPlugins` 改成 `true`
- 清掉同名旧安装残留
- 不会自动删除 `data/.server-plugin-switch/config.json`

这里的 `data/<user>/extensions/server-plugin-switch` 是当前 SillyTavern 用户扩展的真实磁盘目录。
浏览器访问时仍然走 `/scripts/extensions/third-party/server-plugin-switch/*` 这条路由。
只有在安装脚本探测不到任何用户目录时，才会回退到旧式 third-party 目录。

## 手动指定路径

如果你不想让安装脚本自动猜目标，可以直接传路径：

```bash
node install.mjs /path/to/SillyTavern
```

也可以用环境变量：

```bash
SILLYTAVERN_DIR=/path/to/SillyTavern node install.mjs
```

## 卸载

```bash
node uninstall.mjs
```

或：

```bash
node uninstall.mjs /path/to/SillyTavern
```

卸载脚本会删除 extension 目录和 `plugins/server-plugin-switch`。
它不会自动删除 `data/.server-plugin-switch/config.json`。

## 使用方式

1. 重启 SillyTavern
2. 打开扩展设置里的 `Server Plugin Switch / 后端插件切换台`
3. 在 **插件** 页查看后端插件列表并切换启停
4. 在 **重启** 页选择 `自动模式` 或 `自定义命令模式`
5. 需要时先点 `测试命令`，确认通过后再点 `一键重启酒馆`

## 数据位置

### 安装位置

- Extension 面板：`data/<user>/extensions/server-plugin-switch`
- Server Plugin：`plugins/server-plugin-switch`

### 运行数据位置

- 配置根目录：`data/.server-plugin-switch/`
- 主配置：`config.json`

## 环境矩阵

| 环境 | 推荐模式 | 预期行为 | 边界 |
| --- | --- | --- | --- |
| Docker | 自动 | 退出当前进程，容器 restart policy 拉起 | 没配 restart policy 就不会自动回来 |
| mac | 自定义命令 | 用用户自己的启动命令拉起新进程 | 命令写错会起不来 |
| Windows | 自定义命令 | 通过 `cmd.exe` 调用户命令 | 命令可能开出多个实例 |
| VPS | 自动或自定义 | 有守护走自动，无守护走自定义 | 不能把“自动回来”写成默认事实 |
| termux | 自动或自定义 | 有保活走自动，无保活走自定义 | 手动 termux 不能只靠退出恢复 |

## 常见问题

**Q：为什么不能做当前进程内热开热关？**

因为 SillyTavern 的 server plugin loader 本来就不是按“热插拔管理器”设计的。
这项目刻意不碰当前进程里的已加载实例，只管理下次启动状态。

**Q：启用 / 禁用为什么一定要重启？**

因为改的是入口文件是否还能被 loader 找到。
当前进程里已经加载的插件不会被立刻卸载。

**Q：为什么不能只装 extension 面板？**

因为真正的插件枚举、启停、重启逻辑都在 server plugin 端。
前端只是面板。

**Q：卸载会不会删掉我的配置？**

不会。
卸载脚本默认只删 extension 目录和 plugin 目录。

**Q：更新怎么做？**

```bash
cd /path/to/server-plugin-switch
git pull
node install.mjs
```

**Q：自定义命令模式和自动模式怎么选？**

有外部守护就优先 `自动模式`。
本地手动启动、无守护 VPS、手动 termux 这类场景就用 `自定义命令模式`。

## 相关文档

- **更新日志** — [CHANGELOG.md](CHANGELOG.md)
- **架构说明** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **数据模型** — [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- **手动测试清单** — [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md)
- **常见问题排查** — [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## 许可证

[AGPL-3.0](LICENSE)
