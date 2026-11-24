# dsh-menmo-memory

把记忆引擎 `mem.js` 包成 DSH 工具，让 Agent 能自己检索、写入、总结长期记忆。

## 配置

在 `cordis.patch.yml` 里指定记忆目录（`mem.js` 所在处）：

```yaml
- insert:
    - id: tool-memory
      name: 'dsh-menmo-memory'
      config:
        memoryDir: 'C:/path/to/your/memory'
```

也可以用环境变量 `DSH_MEMORY_DIR`，默认 `~/dsh-memory`。

## 注册的工具

| 工具 | 作用 |
|---|---|
| `memory_search` | 直接检索事件碎片，只找 L0~L1，没有才下探 |
| `memory_linked` | 从一条事件顺着关联往下牵，受权重额度限制 |
| `memory_event` | 写事件 / 事件总结 / 按层列出 |
| `memory_summary` | 摘要树、锚点、取窗口 |
| `memory_context` | 生成当前上下文（摘要 + 最近 N 条原文） |

工具只是壳，所有逻辑在 `mem.js` 里。改行为改引擎，不用动插件。
