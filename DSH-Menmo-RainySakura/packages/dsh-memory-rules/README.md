# dsh-menmo-rules

额外规则库声明。首次启动时在记忆目录里铺好六份声明文件，**已存在的一律不覆盖**。

## 配置

```yaml
- insert:
    - id: dsh-memory-rules
      name: 'dsh-menmo-rules'
      config:
        memoryDir: 'C:/path/to/your/memory'
        agentId: 'Agent'        # 会替换进文件名，如 Agent_Diary.md
```

## 铺哪六份

| 模板 | 目标文件名 | 里面是什么 |
|---|---|---|
| `Objective_Information.md` | 同名 | 信息库：标题-标签-内容 |
| `Knowledge_Library.md` | 同名 | 知识库：标题-标签 / 输入-输出-原理 |
| `Agent_Diary.md` | `<Agent>_Diary.md` | 日记，Agent 自己写 |
| `Session_All.md` | 同名 | 上下文原文备份索引 |
| `Agent_IDENTITY.md` | `<Agent>_IDENTITY.md` | 个人记忆档案 |
| `Agent_and_User_Information.md` | `<Agent>_and_User_Information.md` | 人类方档案 |

模板里的 `{agentId}` 占位会被配置里的 `agentId` 替换。

## 它不做什么

不写摘要、不检索、不压缩。只在第一次启动时铺文件，之后完全不管。
