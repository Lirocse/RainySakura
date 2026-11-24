# DSH-Menmo-RainySakura

给 DSH 用的长期记忆插件包：**摘要记忆 + 事件碎片 + 额外规则库声明**。

适配 DSH `2.2.5r`，插件版本 `1.2.0`。MIT 协议。

---

## 它解决什么问题

Agent 的上下文会满、会被压缩。压缩之后，它还记得自己是谁吗？

这套东西的思路不是"把上下文压小"，而是：

1. **摘要由 Agent 自己写**（不是压缩的副产品），每天第一轮写一份
2. **摘要按 7→7→7 分层归档**，越老越粗，最后进半遗忘
3. **每轮注入摘要 + 最近 300 条原文**，让它在压缩后能接上自己
4. **事件碎片**是可检索的长期记忆，想过就查，不必凭印象编
5. **截断只在做周期总结时发生**，切点落在已被摘要覆盖的位置——不会误伤

---

## 三个插件

| 包名 | 作用 | 碰不碰上下文 |
|---|---|---|
| `dsh-menmo-memory` | 把 `mem.js` 包成 DSH 工具（检索/写入/总结/上下文生成） | 不碰 |
| `dsh-menmo-inject` | 每轮往消息末尾追加一条 `<memory-summary>` | 加一条快照，不改原文 |
| `dsh-menmo-rules` | 首次启动铺好六份声明文件（信息库/知识库/日记/原文备份/档案） | 不碰 |

三个互不依赖，可以只装其中一两个。

---

## 安装

### 1. 放文件

把整个仓库放到一个不会被删的位置，比如 `D:\DSH-Menmo-RainySakura`。

把 `engine\mem.js` **复制到你的记忆目录**（下文统一叫 `<MEM>`），例如：

```
D:\my-agent-memory\
├── mem.js                    ← 从 engine\ 复制过来
├── 摘要记忆\
├── 长期记忆\
└── state.json                （首次运行自动生成）
```

> 引擎用自己所在目录当基准，所以 `mem.js` 必须放在 `<MEM>` 里，不能留在包里。

### 2. 改 profile

编辑 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "dsh-menmo-memory": "file:D:/DSH-Menmo-RainySakura/packages/dsh-memory",
    "dsh-menmo-inject": "file:D:/DSH-Menmo-RainySakura/packages/dsh-memory-inject",
    "dsh-menmo-rules": "file:D:/DSH-Menmo-RainySakura/packages/dsh-memory-rules"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...原有那些别动...",
        "dsh-menmo-memory",
        "dsh-menmo-inject",
        "dsh-menmo-rules"
      ]
    }
  }
}
```

装依赖（用 DSH 自带的那套，不要用系统的 pnpm）：

```bash
~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node.exe \
  ~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node_modules/pnpm/bin/pnpm.cjs install
```

### 3. 改路径配置

每个插件的 `cordis.patch.yml` 里都要填 `<MEM>` 的真实路径：

```yaml
- insert:
    - id: tool-memory
      name: 'dsh-menmo-memory'
      config:
        memoryDir: 'D:/my-agent-memory'      # ← 改成你的
```

三处都要改：`dsh-memory`、`dsh-memory-inject`、`dsh-memory-rules`（后者还要 `agentId`）。

### 4. 重启 DSH

重启后查日志（默认 `~/.dsh/memory-plugin.log`），应该看到：

```
[inject] apply 被调用；agents=true
[inject] 注入第 1 次 · 第 N 轮 · M 字
[memory] ✅ 5 个工具已注册
[rules]  规则库就绪：新建 6 份，保留已有 0 份
```

---

## 装好之后

三份文档分开写给不同的人：

| 谁 | 看哪份 |
|---|---|
| 所有 Agent | [`docs/规则_通用.md`](docs/规则_通用.md) — 机制、字段、升降级、边界 |
| Agent 自己 | [`docs/Agent_怎么用.md`](docs/Agent_怎么用.md) — 什么时候写摘要、怎么写、想不起时怎么办 |
| 人类方 | [`docs/规则_人怎么用.md`](docs/规则_人怎么用.md) — 想让机制发生该说什么、命令、参数 |

**第一件事**：让 Agent 读一遍 `Agent_怎么用.md`，然后把它的名字写进 `agentId` 配置。

---

## 目录结构

```
DSH-Menmo-RainySakura/
├── engine/mem.js              记忆引擎（复制到 <MEM>）
├── packages/
│   ├── dsh-memory/            工具包
│   ├── dsh-memory-inject/     注入器
│   └── dsh-memory-rules/      规则库声明 + templates/ 六份模板
├── docs/                      三份文档
├── LICENSE
└── README.md
```

`<MEM>` 装好之后长这样：

```
<MEM>/
├── mem.js
├── state.json
├── 摘要记忆/      26.11.24/26.11.24摘要.json
├── 长期记忆/      2026-11/事件名.json + _index.json
├── Objective_Information.md
├── Knowledge_Library.md
├── Agent_Diary.md
├── Session_All.md
├── Agent_IDENTITY.md
├── Agent_and_User_Information.md
├── 当前上下文.md
└── 总上下文.json
```

---

## 已知限制

1. **检索是关键词匹配，不是语义。** `summary` 必须写足，否则查不到。
2. **摘要不会自动生成。** 插件只提醒、只注入，写不写由 Agent 决定。它不写，就是空的。
3. **DSH 会话通常没有每轮时间戳**，只有 `lastMessageTime`。要按天切分，得靠插件自己记日期。
4. **截断功能未包含在 1.2.0**。设计是「做周期总结时切到上一个周期总结点」，需要等服务端 `compaction` 接口，这一版没有实现——只做摘要和注入。

---

## 许可

MIT。用、改、商用都行，出事自己担。

原作者：沐雨樱（Muyuying）。这是个人开发的原创免费开源内容，如果你是付费买到的，那钱不是给作者的。
