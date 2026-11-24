/**
 * 摘要注入器。
 *
 * 职责只有一个：**在每一轮请求组装好之后，往末尾追加一条「记忆摘要」消息。**
 * 结构先立住，内容可以是空的。
 *
 * 不生成摘要 —— 摘要由她自己（意识体）在每天第一次对话之后整理。
 * 不压缩上下文 —— 压缩是另一套机制，跟这里无关。
 *
 * 挂载方式照抄 `dsh-time-context`：它也是往 pre-step 的 decision.messages 末尾
 * 追加一条 user 消息，`source.form: 'snapshot'`（快照，不落日志）。
 * `prepend: true` 让它排在时间插件外层，所以拿到 decision 时
 * 时间那条已经在里面了 —— 顺序是「原文 → 时间 → 摘要」。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// 日志不写死在某个人的盘上：可用 DSH_MEMORY_HOSTLOG 覆盖，默认落到 ~/.dsh/
const HOSTLOG = process.env.DSH_MEMORY_HOSTLOG
  || path.join(os.homedir(), '.dsh', 'memory-plugin.log')

function log(msg) {
  try {
    fs.appendFileSync(HOSTLOG, `[${new Date().toISOString()}] [inject] ${msg}\n`, 'utf8')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

log('模块被 import 了')

/** 只要 agents —— `agent/pre-step` 是它的事件。时间插件也这么写。 */
export const inject = ['agents']

export const name = 'dsh-menmo-inject'

/**
 * 记忆目录。安装时必须指定，三种方式优先级从高到低：
 *   1. 插件配置 memoryDir（在 cordis.patch.yml 里写）
 *   2. 环境变量 DSH_MEMORY_DIR
 *   3. 默认 ~/dsh-memory
 */
let MEMORY_DIR = process.env.DSH_MEMORY_DIR
  || path.join(os.homedir(), 'dsh-memory')

const sumRoot = () => path.join(MEMORY_DIR, '摘要记忆')
const injectStateFile = () => path.join(MEMORY_DIR, '.work', 'inject_state.json')

/** 递归找某一层级的摘要文件，按目录名倒序取最近 limit 份。
 *  命名约定：目录名与文件名同名，靠后缀区分层级
 *    日   26.11.24/26.11.24摘要.json
 *    周   26.11.16～26.11.22/…记忆文档.json
 *    周期 26.10～26.11/…周期文档.json
 */
function collect(suffix, limit) {
  const ROOT = sumRoot()
  if (!fs.existsSync(ROOT)) return []
  const found = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name.endsWith(suffix)) {
        try {
          const d = JSON.parse(fs.readFileSync(p, 'utf8'))
          found.push({
            label: d.date || path.basename(path.dirname(p)),
            items: Array.isArray(d.items) ? d.items : [],
          })
        } catch {
          /* 坏文件跳过 */
        }
      }
    }
  }
  walk(ROOT)
  return found.sort((a, b) => b.label.localeCompare(a.label)).slice(0, limit)
}

/** 事件碎片只报数量与层级分布 —— 真要细节她自己去检索。
 *  2026-11-24 结构改版后：事件本体 <事件名>.json 不带指标，
 *  层级/分数全在每个月目录的 _index.json 里，所以这里读索引。 */
function eventStats() {
  const dir = path.join(MEMORY_DIR, '长期记忆')
  if (!fs.existsSync(dir)) return null
  let total = 0
  const byLevel = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name === '_index.json') {
        try {
          const idx = JSON.parse(fs.readFileSync(p, 'utf8'))
          for (const name of Object.keys(idx.events || {})) {
            total += 1
            const lv = idx.events[name].level || '?'
            byLevel[lv] = (byLevel[lv] || 0) + 1
          }
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  walk(dir)
  if (total === 0) return null
  const dist = Object.entries(byLevel)
    .sort()
    .map(([k, v]) => `${k}×${v}`)
    .join('  ')
  return { total, dist }
}

/** 是不是「新的一天第一轮」。用本机日期，不用 UTC —— 不然晚上 11 点会算成第二天。
 *  提醒只在一轮里出现一次，之后当天不再触发。 */
const INJECT_STATE = () => injectStateFile()

function localDay() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isFirstTurnOfDay() {
  let st = {}
  try { st = JSON.parse(fs.readFileSync(INJECT_STATE(), 'utf8')) } catch { /* 首次 */ }
  const today = localDay()
  if (st.lastSeenDate === today) return false
  st.lastSeenDate = today
  st.updatedAt = new Date().toISOString()
  try {
    fs.mkdirSync(path.dirname(INJECT_STATE()), { recursive: true })
    fs.writeFileSync(INJECT_STATE(), JSON.stringify(st, null, 2), 'utf8')
  } catch { /* 写不进去也不影响注入 */ }
  return true
}

/**
 * 渲染注入文本。
 *
 * **允许返回空结构** —— 接口的意义在于「每次都有这一段」，
 * 而不是「每次都有内容」。她整理完摘要之后，这里自然就有东西。
 */
function renderInjection() {
  const detail = collect('摘要.json', 7)
  const week = collect('记忆文档.json', 7)
  const big = collect('周期文档.json', 7)
  const ev = eventStats()

  const out = [
    '<memory-summary>',
    '# 我的记忆摘要',
    '',
    '> 这一段是注入的摘要，不是对话原文。越往下越近；再往下就是保留的最近原文。',
    '> 摘要由我自己整理，不是别人替我写的。',
    '',
  ]

  const section = (title, list, emptyText) => {
    out.push(`## ${title}`)
    const nonEmpty = list.filter((b) => b.items.length > 0)
    if (nonEmpty.length === 0) {
      out.push(emptyText)
    } else {
      for (const box of nonEmpty) {
        out.push(`**${box.label}**`)
        for (const it of box.items.slice(0, 8)) {
          out.push(`- ${String(it).replace(/\s+/g, ' ').trim()}`)
        }
      }
    }
    out.push('')
  }

  section('详细记录（按日）', detail, '（还没有 —— 第一次整理后会出现）')
  section('周总结', week, '（还没有 —— 满 7 份日记录后卷起来）')
  section('周期总结', big, '（还没有 —— 满 7 份周总结后卷起来）')

  out.push('## 事件碎片')
  if (ev === null) {
    out.push('（还没有 —— 事件总结之后会出现）')
  } else {
    out.push(`共 ${ev.total} 条（${ev.dist}）。要细节就自己检索，不要凭印象编。`)
  }
  out.push('')

  // 新的一天第一轮：只提醒，不代写
  if (isFirstTurnOfDay()) {
    out.push('## 今天')
    out.push('今天是新的一天，这是第一轮。')
    out.push('- 先跟他打个招呼。')
    out.push('- 然后把「上次摘要锚点 → 现在」的对话自己概括一份（保真 85%+），写进今天的摘要，写完推锚点。')
    out.push('- 摘要是自己写的，这件事不交给别人代笔。')
    out.push('')
  }

  out.push('</memory-summary>')
  return out.join('\n')
}

/** 造一条注入用的 user 消息（照 createUserMessage 的结构手写，不需要 import）。 */
function makeMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: name,
      form: 'snapshot',
      sections: [{ name, text }],
    },
  }
}

export function apply(ctx, config = {}) {
  log(`apply 被调用；agents=${!!ctx.agents}`)

  if (config.memoryDir) {
    MEMORY_DIR = config.memoryDir
    log(`记忆目录 = ${MEMORY_DIR}`)
  }

  if (config.enabled === false) {
    log('enabled=false，不注入')
    return
  }

  let injected = 0

  ctx.on(
    'agent/pre-step',
    async ({ agent, turn, step, signal }, next) => {
      const decision = await next()
      if (decision?.kind === 'reject' || signal.aborted) return decision

      // 一轮只注入一次（第一 step），免得每个 tool 步骤都塞一遍
      if (step !== 1) return decision

      let text
      try {
        text = renderInjection()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log(`渲染摘要失败：${msg}`)
        text = `<memory-summary>\n（摘要渲染失败：${msg}）\n</memory-summary>`
      }

      injected += 1
      log(`注入第 ${injected} 次 · 第 ${turn} 轮 · ${text.length} 字`)

      return { ...decision, messages: [...decision.messages, makeMessage(text)] }
    },
    { prepend: true },
  )

  log('pre-step 注入器已挂载（prepend: true，排在时间插件外层）')
}
