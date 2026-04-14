# 手动测试清单

## 安装前提

- SillyTavern 可以正常启动
- `config.yaml` 已允许 server plugins
- 已执行 `node install.mjs`

## 基础检查

1. 重启 SillyTavern
2. 确认启动日志里出现：
   `Initializing plugin from .../plugins/server-plugin-switch/index.js`
3. 打开扩展设置，确认 `Server Plugin Switch` 面板出现

## 插件列表

1. 打开 `插件` 页
2. 确认当前后端插件列表可见
3. 搜索框输入关键字，确认过滤生效

## 启停切换

1. 选择一个非自身插件
2. 点 `停用并等待重启`
3. 确认提示正常
4. 重启 SillyTavern
5. 确认该插件不再加载
6. 再次启用并重启，确认恢复

## 自定义命令模式

1. 切到 `重启` 页
2. 选择 `自定义命令`
3. 输入启动命令
4. 点 `测试命令`
5. 确认最近结果更新

## 自动模式

1. 选择 `自动模式`
2. 点 `一键重启酒馆`
3. 确认旧进程退出
4. 如果外部守护存在，确认服务恢复
