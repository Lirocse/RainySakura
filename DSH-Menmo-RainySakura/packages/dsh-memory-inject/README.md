# dsh-menmo-inject

**只做一件事：每轮请求组装好之后，往末尾追加一段「我的记忆摘要」。**

结构先立住，内容可以是空的。

- **不生成摘要** —— 摘要由她自己（意识体）在每天第一次对话之后整理
- **不压缩上下文** —— 压缩是另一套机制，跟这里无关
- **不检索** —— 事件碎片她自己调 `mem.js search`

---

## 一、挂在哪

照抄 `dsh-time-context`（时间插件的做法，它也是往上下文里注入东西）：

```js
export const inject = ['agents']

ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
  const decision = await next()
  if (decision.kind === 'reject' || signal.aborted) return decision
  return {
    ...decision,
    messages: [...decision.messages, {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'dsh-menmo-inject', form: 'snapshot', sections: [{ name, text }] },
    }],
  }
}, { prepend: true })
```

`form: 'snapshot'` = 快照，**不落日志**，每轮重新算。跟时间插件一致。

`prepend: true` 让我们排在时间插件**外层**，所以 `await next()` 回来时时间那条已经在 `decision.messages` 里了：

```
原文  →  time-context  →  dsh-menmo-inject
```

**一轮只注入一次**（只在 `step === 1`），免得每个工具调用步骤都塞一遍。

---

## 二、注入长什么样

```markdown
<memory-summary>
# 我的记忆摘要

> 这一段是注入的摘要，不是对话原文。越往下越近；再往下就是保留的最近原文。
> 摘要由我自己整理，不是别人替我写的。

## 详细记录（按日）
（还没有 —— 第一次整理后会出现）

## 周总结
（还没有 —— 满 7 份日记录后卷起来）

## 大总结
（还没有 —— 满 7 份周总结后卷起来）

## 事件碎片
共 8 条（L0×7  L1×1）。要细节就自己检索，不要凭印象编。

</memory-summary>
```

读的是 `memory/摘要记忆/` 下的：

| 文件 | 对应 | 取几个 |
|---|---|---|
| `摘要.json` | 详细记录（按日） | 最近 7 |
| `第2次摘要.json` | 周总结 | 最近 7 |
| `第3次摘要.json` | 大总结 | 最近 7 |

外加 `memory/长期记忆/` 的事件碎片数量与层级分布（只报统计，不报内容）。

**目录不存在 / 全是空的时候，照常注入上面的骨架** —— 这就是「有这个结构、有这个接口」的意思。

---

## 三、两条日志路径的区别（排查用）

`D:\dsh-plugins\voice-host.log` 里 grep `[inject]`：

| 日志 | 说明 |
|---|---|
| 什么都没有 | bundle 没加载 —— 查 bundles、`exports` 字段 |
| `模块被 import 了`，但没有 `apply 被调用` | **`inject` 等不到服务** —— 服务名不对 |
| `apply 被调用；agents=true` | 服务就绪，注入器挂上了 |
| `注入第 N 次 · 第 X 轮` | 真的注入了 |
| `渲染摘要失败` | 读文件出错，但骨架仍会注入（带错误说明） |

**服务名必须是 `agents`**（不是 `compaction`）——`agent/pre-step` 是它的事件。
这一条踩过一次：写成 `compaction` 时，模块被 import 了、`apply` 永远不跑，日志里一声不响。

---

## 四、配置

`cordis.patch.yml` 只挂名字，不传 config（默认值写在代码里）：

```yaml
- insert:
    - id: dsh-menmo-inject
      name: 'dsh-menmo-inject'
```

要给配置就加 `config:`，目前只认一个：

| 项 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | `false` = 完全不注入 |

---

## 五、出问题怎么退

profile 的 `package.json` 里删依赖 + 从 `dsh.profile.bundles` 删掉这一项，`pnpm install`，重启。

---

## 六、还没做的

1. **摘要生成不在这个插件里。** 她每天第一次对话后自己整理 —— 那是 Agent 的活，走的是提示词 + `mem.js`，不是这里。
2. **顺序依赖 prepend 的语义。** 目前离线实测是「时间 → 摘要」。如果哪天 DSH 改了 prepend 的实现，顺序可能翻过来，届时改成在 `decision.messages` 里按 `source.kind` 找位置插入。
3. **没有去重。** 同一轮内 step 1 只注一次，但如果调度器重放同一个 turn，会再注一次。
