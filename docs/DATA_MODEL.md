# 数据模型

## 配置文件

路径：

- `data/.server-plugin-switch/config.json`

示例：

```json
{
  "restartMode": "auto",
  "customCommand": "",
  "restartDelayMs": 800,
  "pluginStates": {},
  "lastRestartResult": null
}
```

## `pluginStates`

只记录已经被停用过的插件。

目录插件示例：

```json
{
  "archive-reserve": {
    "kind": "directory",
    "originalEntryRelativePath": "index.js",
    "disabledEntryRelativePath": "index.js.spm-disabled",
    "disabledEntries": [
      {
        "originalRelativePath": "index.js",
        "disabledRelativePath": "index.js.spm-disabled"
      }
    ],
    "updatedAt": "2026-04-15T00:00:00.000Z"
  }
}
```

单文件插件示例：

```json
{
  "my-plugin.js": {
    "kind": "file",
    "originalFileName": "my-plugin.js",
    "disabledFileName": "my-plugin.js.spm-disabled",
    "updatedAt": "2026-04-15T00:00:00.000Z"
  }
}
```

## `lastRestartResult`

用于记录最近一次预检或重启安排结果。

```json
{
  "ok": true,
  "at": "2026-04-15T00:00:00.000Z",
  "kind": "restart",
  "mode": "custom",
  "message": "已安排自定义命令重启。",
  "details": "wrapper: sh -lc"
}
```
