# 上下文全文备份 · Session_All

> **规则**：{agentId} 或人类方从 DSH 里找到上下文原文文件，显式存一份，并把索引记在这里。
> 摘要会失真，原文不会。**这里是最后的底**——摘要滚错、截断误伤时，回来这儿对。

---

## 索引

| 日期 | 来源 | 原文位置 | 轮次 | 备注 |
|---|---|---|---|---|
| | | | | |

---

## 取用方法

DSH 的会话文件是**结构化数据**，不是纯文本。常见位置：

```
~/.dsh/storages/session_projcache/sessions/<session-id>.json
  └─ record.rows.turnOutline.val.turns[]     每轮
       ├─ seq                                轮次号（锚点用这个）
       └─ lastMessageTime                    通常只有这一处时间
```

`.zstd` 结尾的先解压。
