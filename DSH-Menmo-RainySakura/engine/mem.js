#!/usr/bin/env node
/**
 * 记忆引擎（按《Agent模型记忆优化规则》实现）
 *
 * 事件碎片：
 *   node mem.js ev add <json>            加一条事件（进 L0，freq=100, score=0）
 *   node mem.js ev search "关键词"        直接调取（只找 L0~L1，没有才下探）
 *   node mem.js ev link <id> [--depth 1]  被关联检索（不限层级，受 linkCap 限制）
 *   node mem.js ev deep "关键词"          明确要求，含半丢弃层
 *   node mem.js ev summarize              事件总结：洗牌、升降级
 *   node mem.js ev list [--level L0]
 *   node mem.js ev show <id>
 *
 * 摘要记忆：
 *   node mem.js sum day 11.23 --turns 20 --text "..."   落日摘要
 *   node mem.js sum rollup                              每 7 个日摘要 → 区间（会移动目录）
 *   node mem.js sum tree                                打印摘要树
 *
 * 上下文：
 *   node mem.js ctx                      生成 总上下文.json + 当前上下文.md
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EVENTS = path.join(HERE, '长期记忆')
const SUMS = path.join(HERE, '摘要记忆')
const FACTS = path.join(HERE, '客观信息')
const STATE = path.join(HERE, 'state.json')
const TOTAL = path.join(HERE, '总上下文.json')
const CTX = path.join(HERE, '当前上下文.md')

// ---- 常量（改这里就够，不要在别处写魔法数）----
const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', '半丢弃']
const GAIN_DIRECT = 3          // 直接引用加分
const GAIN_LINK = 1            // 被关联加分
const MULT = { L0: 1, L1: 1, L2: 1, L3: 1.5, L4: 2, L5: 3, 半丢弃: 5 }
const TOP_RATIO = 0.3          // 前 30%
const BATCH_UP = 2             // L3/L4/L5 每次最多直接升几个到 L2
const LINK_BUDGET = 10         // 单次联想：牵出事件的被关联权重之和上限
const RECENT_TURNS = 300       // 上下文保留最近 300 条原文
const SUM_KEEP = { detail: 7, week: 7, big: 7 }   // 注入：7 详细 + 7 周 + 7 大

const today = () => new Date().toISOString().slice(0, 10)
const nowISO = () => new Date().toISOString()
const ensure = (d) => fs.mkdirSync(d, { recursive: true })

// ---------------- 事件读写 ----------------
// 存储分两半（2026-11-24 改）：
//   事件本体   <事件名>.json    —— name / time / type / summary / detail / links，基本不变
//   会变的指标 _index.json      —— weight(被关联权重系数) / score(频率系数) / rating(评定分) / level / 次数
// 代码内部沿用旧字段名，映射只在读写层做：
//   e.freq  ← 文件里的 score     （频率系数）
//   e.freq ← 文件里的 rating    （评定分）
// 这样下面全部升降级逻辑一行都不用动。

const INDEX_NAME = '_index.json'

function eventFiles() {
  const out = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.json') && e.name !== INDEX_NAME) out.push(p)
    }
  }
  walk(EVENTS)
  return out
}

function loadIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, INDEX_NAME), 'utf8')) }
  catch { return { events: {} } }
}

function saveIndex(dir, idx) {
  ensure(dir)
  idx.updatedAt = nowISO()
  fs.writeFileSync(path.join(dir, INDEX_NAME), JSON.stringify(idx, null, 2), 'utf8')
}

function loadEvents() {
  return eventFiles().map(p => {
    const body = JSON.parse(fs.readFileSync(p, 'utf8'))
    const dir = path.dirname(p)
    const meta = loadIndex(dir).events[body.name] || {}
    return {
      ...body,
      id: body.name,
      freq: meta.score ?? 100,               // 频率系数（洗牌 -20/+10/赋分 作用在它上面）
      rating: meta.rating ?? 0,              // 评定分（直调 +3 / 关联 +1）
      level: meta.level || 'L0',
      hits: meta.hits || 0,
      linkedHits: meta.linkedHits || 0,
      lastTouch: meta.lastTouch || body.time,
      missStreak: meta.missStreak || 0,
      weight: meta.weight ?? (meta.linkedHits || 0),
      _file: p,
      _dir: dir,
    }
  })
}

function saveEvent(e) {
  const name = e.name || e.id
  const dir = e._dir || path.join(EVENTS, (e.time || today()).slice(0, 7))
  ensure(dir)
  const body = {
    name,
    time: e.time,
    type: e.type,
    summary: e.summary,
    detail: e.detail,
    links: e.links || [],
    linkCap: e.linkCap ?? 3,
    created: e.created || nowISO(),
  }
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(body, null, 2), 'utf8')
  const idx = loadIndex(dir)
  idx.events[name] = {
    weight: e.linkedHits || 0,             // 被关联权重系数
    score: e.freq ?? 100,                  // 文件 score = 频率系数
    rating: e.rating ?? 0,                 // 文件 rating = 评定分
    level: e.level,
    hits: e.hits || 0,
    linkedHits: e.linkedHits || 0,
    lastTouch: e.lastTouch,
    missStreak: e.missStreak || 0,
  }
  saveIndex(dir, idx)
  e._dir = dir
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) }
  catch { return { lastSummarize: null } }
}
function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8') }

// ---------------- 事件检索 ----------------

function match(e, terms) {
  const hay = `${e.summary} ${e.type} ${(e.links || []).join(' ')} ${e.detail || ''}`.toLowerCase()
  let n = 0
  for (const t of terms) if (hay.includes(t)) n++
  return n
}

function gainFor(e, kind) {
  const mult = MULT[e.level] ?? 1
  const base = kind === 'direct' ? GAIN_DIRECT : GAIN_LINK
  return base * mult
}

function touch(e, kind) {
  const g = gainFor(e, kind)
  e.rating = (e.rating || 0) + g        // 评定分：直调 +3 / 关联 +1
  if (kind === 'direct') e.hits = (e.hits || 0) + 1
  else e.linkedHits = (e.linkedHits || 0) + 1
  e.lastTouch = today()
  saveEvent(e)
  return g
}

/** 直接调取：只从 L0~L1 找，找不到才下探一层 */
function cmdSearch(argv) {
  const inclDeep = argv.includes('--deep')
  const terms = argv.filter(a => !a.startsWith('--')).join(' ').toLowerCase().split(/[\s,，]+/).filter(Boolean)
  if (!terms.length) return console.error('用法: node mem.js ev search "关键词" [--deep]')

  const all = loadEvents()
  const order = inclDeep ? ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', '半丢弃'] : ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
  let picked = []
  let usedLevel = null

  for (const lv of order) {
    const hits = all.filter(e => e.level === lv)
      .map(e => ({ e, m: match(e, terms) }))
      .filter(x => x.m > 0)
      .sort((a, b) => b.m - a.m || b.e.freq - a.e.freq)
    if (hits.length) { picked = hits; usedLevel = lv; break }
  }

  if (!picked.length) {
    console.log('（没有找到目标事件）')
    return
  }

  for (const { e } of picked) touch(e, 'direct')

  console.log(`\n在 ${usedLevel} 层命中 ${picked.length} 条：`)
  for (const { e } of picked) {
    const cap = e.linkCap ?? 3
    console.log(`\n【${e.id}】${e.level}  频率系数=${e.freq}  评定分=${e.rating}`)
    console.log(`  ${e.time} · ${e.type}`)
    console.log(`  ${e.summary}`)
    if (e.links?.length) console.log(`  关联(${cap}): ${e.links.join(', ')}`)
    if (e.detail) console.log('  ' + e.detail.split('\n').slice(0, 4).join('\n  '))
  }
}

/** 被关联检索：从某条出发，不限层级，受 linkCap 限制 */
function cmdLink(argv) {
  const id = argv.find(a => !a.startsWith('--'))
  if (!id) return console.error('用法: node mem.js ev link <id> [--depth 2]')
  const depthArg = argv.indexOf('--depth')
  const maxDepth = depthArg >= 0 ? Number(argv[depthArg + 1]) : 2

  const all = loadEvents()
  const byId = new Map(all.map(e => [e.id, e]))
  const root = byId.get(id)
  if (!root) return console.error('找不到: ' + id)

  const seen = new Set([id])
  let frontier = [root]
  const found = []
  // 单次联想：牵出事件的「被关联权重」之和上限。被关联得越多，单条越占额度。
  let budget = LINK_BUDGET

  outer:
  for (let d = 0; d < maxDepth; d++) {
    const next = []
    for (const cur of frontier) {
      const cap = cur.linkCap ?? 3
      const linked = (cur.links || []).map(x => byId.get(x)).filter(Boolean)
      // 受 linkCap 限制：最多牵出 cap 条关联
      for (const l of linked.slice(0, cap)) {
        if (seen.has(l.id)) continue
        const cost = Math.max(1, l.weight || 0)   // 没人关联过也算 1
        if (cost > budget) break outer            // 额度用完，本轮到此为止
        budget -= cost
        seen.add(l.id)
        found.push({ e: l, from: cur.id, depth: d + 1, cost })
        next.push(l)
      }
    }
    frontier = next
    if (!frontier.length) break
  }

  if (!found.length) return console.log('（这条没有关联事件）')

  for (const { e } of found) touch(e, 'linked')
  console.log(`\n从 ${id} 牵出 ${found.length} 条关联事件（权重额度 ${LINK_BUDGET - budget}/${LINK_BUDGET}）：`)
  for (const { e, from, depth, cost } of found) {
    console.log(`\n[${depth}] 【${e.id}】${e.level} 频率系数=${e.freq} 权重=${e.weight}  占额度${cost}  ← ${from}`)
    console.log(`  ${e.summary}`)
  }
}

/** 事件总结：洗牌与升降级 */
function cmdSummarize() {
  const st = loadState()
  const since = st.lastSummarize
  const all = loadEvents()
  if (!all.length) return console.log('（没有事件碎片）')

  const touched = (e) => !since || (e.lastTouch && e.lastTouch >= since)
  const origLevel = new Map(all.map(e => [e.id, e.level]))   // 本轮按开始时的层级分组
  const log = []

  // ---- L0：独特机制 ----
  const l0 = all.filter(e => origLevel.get(e.id) === 'L0')
  const l0Touched = l0.filter(touched).sort((a, b) => b.rating - a.rating)
  const l0Cold = l0.filter(e => !touched(e))

  for (const e of l0Cold) {                       // 完全没被调用 → -40 直接到 L2
    e.freq -= 40; e.level = 'L2'; e.missStreak = 0
    log.push(`${e.id} L0 → L2  (−40, 未调用)`)
    saveEvent(e)
  }
  const keepN = Math.ceil(l0Touched.length * TOP_RATIO)
  l0Touched.forEach((e, i) => {
    if (i < keepN && l0Touched.length > 1) {      // 前 30% → +10 留 L0
      e.freq += 10; e.missStreak = 0
      log.push(`${e.id} L0 留  (+10, 前30%)`)
    } else {                                       // 其余 → -20 降 L1
      e.freq -= 20; e.level = 'L1'; e.missStreak = 0
      log.push(`${e.id} L0 → L1  (−20)`)
    }
    saveEvent(e)
  })

  // ---- L1~L5：同一套 ----
  for (const lv of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    const group = all.filter(e => origLevel.get(e.id) === lv).sort((a, b) => b.rating - a.rating)
    if (!group.length) continue
    const topN = Math.max(1, Math.ceil(group.length * TOP_RATIO))

    group.forEach((e, i) => {
      if (!touched(e)) {
        e.missStreak = (e.missStreak || 0) + 1
        if (e.missStreak >= 2) {                   // 连续两次没调用 → -20 降一层
          e.freq -= 20
          const ni = LEVELS.indexOf(e.level) + 1
          e.level = LEVELS[Math.min(ni, LEVELS.length - 1)]
          log.push(`${e.id} ${lv} 降级  (−20, 连续${e.missStreak}次未调用)`)
        } else {                                   // 一次没调用 → -10
          e.freq -= 10
          log.push(`${e.id} ${lv} 留  (−10, 未调用)`)
        }
      } else if (i < topN) {                       // 前 30% → +20 + 赋分 → 升一层
        const bonus = Math.round((10 * (topN - i)) / topN)   // 10 分制赋分
        e.freq += 20 + bonus
        const ni = Math.max(0, LEVELS.indexOf(e.level) - 1)
        e.level = LEVELS[ni]
        e.missStreak = 0
        log.push(`${e.id} ${lv} 升级  (+${20 + bonus} = 20+赋分${bonus})`)
      } else {
        e.missStreak = 0
        log.push(`${e.id} ${lv} 保持`)
      }
      saveEvent(e)
    })
  }

  // ---- 批量例外：L3/L4/L5 里分数最高的几个直接升 L2 ----
  const lows = all.filter(e => ['L3', 'L4', 'L5'].includes(origLevel.get(e.id))).sort((a, b) => b.rating - a.rating)
  for (const e of lows.slice(0, BATCH_UP)) {
    e.level = 'L2'
    log.push(`${e.id} ${'L3/L4/L5'} → L2  (批量, ${e.freq})`)
    saveEvent(e)
  }

  st.lastSummarize = nowISO()
  saveState(st)

  console.log(`事件总结完成，处理 ${all.length} 条：\n`)
  console.log(log.join('\n') || '（没有变化）')
  cmdList([])
}

function slugOf(summary) {
  // 文件名就用事件名：去掉 Windows 非法字符，限长 24 字
  return (summary || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24) || '未命名事件'
}

function cmdAdd(argv) {
  const src = argv[0]
  if (!src || !fs.existsSync(src)) return console.error('用法: node mem.js ev add <json>')
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'))
  const time = raw.time || today()
  const summary = raw.summary || '(无总结)'
  let name = raw.name || slugOf(summary)
  const exist = new Set(loadEvents().map(e => e.id))
  if (exist.has(name)) {                     // 重名加序号，别覆盖已有事件
    let i = 2
    while (exist.has(`${name}(${i})`)) i++
    name = `${name}(${i})`
  }
  const e = {
    name,
    time,
    type: raw.type || '日常',
    summary,
    detail: raw.detail || '',
    links: raw.links || [],
    linkCap: raw.linkCap ?? 3,
    freq: 100,
    rating: 0,
    level: 'L0',
    hits: 0,
    linkedHits: 0,
    lastTouch: time,
    missStreak: 0,
    created: nowISO(),
  }
  saveEvent(e)
  console.log(`✅ ${name}  L0  频率系数=100  评定分=0  ${summary}`)
}

function cmdList(argv) {
  const lv = argv.includes('--level') ? argv[argv.indexOf('--level') + 1] : null
  let all = loadEvents()
  if (lv) all = all.filter(e => e.level === lv)
  all.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.freq - a.freq)
  if (!all.length) return console.log('（空）')
  let cur = null
  for (const e of all) {
    if (e.level !== cur) { cur = e.level; console.log(`\n── ${cur} ──`) }
    console.log(`  ${String(e.freq).padStart(4)}  ${String(e.rating).padStart(4)}  ${e.id}  ${e.summary}`)
  }
}

function cmdShow(argv) {
  const id = argv[0]
  const e = loadEvents().find(x => x.id === id)
  if (!e) return console.error('找不到: ' + id)
  const { _file, ...rest } = e
  console.log(JSON.stringify(rest, null, 2))
}

// ---------------- 摘要记忆 ----------------

function dayDir(name) { return path.join(SUMS, name) }

function cmdSumDay(argv) {
  const name = argv.find(a => !a.startsWith('--'))
  const tIdx = argv.indexOf('--turns')
  const xIdx = argv.indexOf('--text')
  const turnText = tIdx >= 0 ? argv[tIdx + 1] : ''
  const text = xIdx >= 0 ? argv[xIdx + 1] : ''
  if (!name) return console.error('用法: node mem.js sum day 11.23 --turns 20 --text "摘要内容"')

  const dir = dayDir(name)
  ensure(path.join(dir, '下属记忆'))
  const payload = {
    date: name,
    turns: turnText,
    createdAt: nowISO(),
    items: text ? text.split(/\n+/).filter(Boolean) : [],
  }
  fs.writeFileSync(path.join(dir, `${name}摘要.json`), JSON.stringify(payload, null, 2), 'utf8')
  console.log(`✅ 摘要记忆/${name}/${name}摘要.json  （${payload.items.length} 条）`)
}

// ---------------- 摘要锚点：两段「每日首次打招呼」之间 ----------------
// 摘要的边界不是"天"，是"上一次每日首次打招呼 → 这一次"。
// 锚点记的是「上次摘要停在第几轮」，跨天与否由意识体自己判断。

const ANCHOR = path.join(SUMS, '_anchor.json')
const SESSION_DIR = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
const DEFAULT_SESSION = '61b7d693-5935-4950-920c-308d2f6b7a99'

function readAnchor() {
  try {
    const a = JSON.parse(fs.readFileSync(ANCHOR, 'utf8'))
    if (!a.sessions) a.sessions = {}
    return a
  } catch {
    return { sessions: {} }
  }
}

function writeAnchor(a) {
  ensure(SUMS)
  a.updatedAt = nowISO()
  fs.writeFileSync(ANCHOR, JSON.stringify(a, null, 2), 'utf8')
}

function sidOf(argv) {
  const i = argv.indexOf('--session')
  return i >= 0 ? argv[i + 1] : DEFAULT_SESSION
}

function loadTurns(sid) {
  const f = path.join(SESSION_DIR, sid + '.json')
  if (!fs.existsSync(f)) throw new Error(`找不到会话文件 ${f}`)
  const d = JSON.parse(fs.readFileSync(f, 'utf8'))
  return d.record.rows.turnOutline.val.turns
}

function mmddOf(d = new Date()) {
  // 26.11.24 这种：年(两位).月.日。文档里的文件夹格式就是 XX.XX.XX
  const yy = String(d.getFullYear()).slice(2)
  return `${yy}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** 读/写锚点：`sum anchor` 看，`sum anchor --set 1190` 推 */
function cmdAnchor(argv) {
  const a = readAnchor()
  const sid = sidOf(argv)
  const i = argv.indexOf('--set')
  if (i >= 0) {
    a.sessions[sid] = Number(argv[i + 1])
    writeAnchor(a)
    console.log(`✅ 锚点 ${sid.slice(0, 8)} → 第 ${a.sessions[sid]} 轮`)
    return
  }
  const cur = a.sessions[sid] ?? 0
  const turns = (() => {
    try { return loadTurns(sid) } catch { return [] }
  })()
  const last = turns.length ? turns[turns.length - 1].turn : '?'
  console.log(`会话 ${sid.slice(0, 8)}  锚点: 第 ${cur} 轮 · 会话末轮: ${last}`)
  console.log(cur === 0 ? '（还没摘要过，下次从第 1 轮取）' : `（下次从第 ${cur + 1} 轮取起）`)
}

/** 导出「锚点 → 当前」之间的完整对话，供意识体概括 */
function cmdWindow(argv) {
  const a = readAnchor()
  const sid = sidOf(argv)
  const fromIdx = argv.indexOf('--from')
  const toIdx = argv.indexOf('--to')
  const turns = loadTurns(sid)
  const lastTurn = turns[turns.length - 1].turn
  const from = fromIdx >= 0 ? Number(argv[fromIdx + 1]) : (a.sessions[sid] ?? 0)
  const to = toIdx >= 0 ? Number(argv[toIdx + 1]) : lastTurn

  const picked = turns.filter((t) => t.turn > from && t.turn <= to)
  if (picked.length === 0) {
    console.log(`第 ${from + 1}–${to} 轮之间没有新对话（锚点就是 ${from}）`)
    return
  }

  const dir = path.join(HERE, '.work')
  ensure(dir)
  const out = path.join(dir, `待摘要-${from + 1}-${to}.md`)

  const lines = [
    `# 待摘要：第 ${from + 1} – ${to} 轮`,
    '',
    `> 共 ${picked.length} 轮。这是两段「每日首次打招呼」之间的完整对话。`,
    '> 概括成摘要，保真度 85% 以上——他原话里的判断、数字、路径、情绪转折都不能走形。',
    '> 概括完：`node mem.js sum save --from ' + from + ' --to ' + to + ' --file <条目文件>`',
    '',
  ]
  for (const t of picked) {
    lines.push(`## 第 ${t.turn} 轮`)
    lines.push(`**他**：${String(t.prompt || '').trim()}`)
    lines.push('')
    lines.push(`**我**：${String(t.response || '').trim()}`)
    lines.push('')
  }
  fs.writeFileSync(out, lines.join('\n'), 'utf8')

  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`✅ ${out}`)
  console.log(`   ${picked.length} 轮 · ${kb} KB · 第 ${from + 1}–${to} 轮`)
  console.log(`   概括完写进 ${mmddOf()}：node mem.js sum save --from ${from} --to ${to} --file <条目文件>`)
}

/** 写入日摘要并推进锚点 */
function cmdSave(argv) {
  const get = (k, d = '') => {
    const i = argv.indexOf('--' + k)
    return i >= 0 ? argv[i + 1] : d
  }
  const sid = sidOf(argv)
  const date = get('date') || mmddOf()
  const from = Number(get('from', '0'))
  const to = Number(get('to', '0'))
  const file = get('file')

  let items = []
  if (file && fs.existsSync(file)) {
    items = fs.readFileSync(file, 'utf8')
      .split(/\n+/)
      .map((s) => s.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
  } else {
    items = get('text', '').split(/\n+/).filter(Boolean)
  }
  if (items.length === 0) {
    return console.error('没有条目。用 --file <文件> 或 --text "条目1\\n条目2"')
  }
  if (!to) return console.error('必须带 --to <截止轮次>，否则锚点不知道推到哪')

  const dir = dayDir(date)
  ensure(path.join(dir, '下属记忆'))
  const outFile = path.join(dir, `${date}摘要.json`)

  // 同一天可能写多段（一天里多次打招呼），合并而不是覆盖
  let payload = { date, createdAt: nowISO(), segments: [], items: [] }
  if (fs.existsSync(outFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(outFile, 'utf8'))
      payload.segments = Array.isArray(old.segments) ? old.segments : []
      payload.items = Array.isArray(old.items) ? old.items : []
    } catch {
      /* 坏文件重写 */
    }
  }
  payload.segments.push({ from, to, createdAt: nowISO(), items })
  payload.items = [...new Set([...payload.items, ...items])]
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')

  const a = readAnchor()
  a.sessions[sid] = to
  writeAnchor(a)

  console.log(`✅ 摘要记忆/${date}/${date}摘要.json（本次 ${items.length} 条，累计 ${payload.items.length} 条）`)
  console.log(`✅ 锚点 → 第 ${to} 轮`)
}

/** 每 7 个日摘要卷成区间；只建结构 + 提示我去写总结 */
function cmdRollup() {  const names = fs.existsSync(SUMS) ? fs.readdirSync(SUMS, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{2}\.\d{2}\.\d{2}$/.test(d.name))
    .map(d => d.name).sort() : []

  if (names.length < 7) {
    return console.log(`当前日摘要 ${names.length} 个，还不够 7 个（还差 ${7 - names.length} 个）`)
  }
  const batch = names.slice(0, 7)
  const range = `${batch[0]}～${batch[batch.length - 1]}`
  const dir = dayDir(range)
  ensure(path.join(dir, '下属记忆'))

  for (const n of batch) {
    const from = dayDir(n)
    const to = path.join(dir, '下属记忆', n)
    if (fs.existsSync(from)) fs.renameSync(from, to)
  }

  const placeholder = path.join(dir, `${range}记忆文档.json`)
  if (!fs.existsSync(placeholder)) {
    fs.writeFileSync(placeholder, JSON.stringify({
      range, createdAt: nowISO(),
      items: [], note: '待我读「下属记忆」里的 7 份摘要后填入 ≤6 条',
    }, null, 2), 'utf8')
  }
  console.log(`✅ 已卷成 摘要记忆/${range}/ （7 个日摘要已移入 下属记忆/）`)
  console.log(`   下一步：写满 ${range}/${range}记忆文档.json 的 items`)
}

function cmdSumTree() {
  const walk = (dir, depth, prefix) => {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '下属记忆')
      .map(d => d.name).sort()
    for (const name of entries) {
      const p = path.join(dir, name)
      const files = fs.readdirSync(p).filter(f => f.endsWith('.json'))
      console.log(`${'  '.repeat(depth)}${prefix}${name}   ${files.join(', ') || '(空)'}`)
      const sub = path.join(p, '下属记忆')
      if (fs.existsSync(sub)) walk(sub, depth + 1, '')
    }
  }
  console.log('摘要记忆/')
  walk(SUMS, 1, '')
}

// ---------------- 上下文 ----------------

const clip = (s, n) => {
  const one = String(s || '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

/** 递归收集某一层的摘要文件，按目录名取最近 limit 个
 *  命名约定（文档 Vol1.2.0.6）：
 *    日    26.11.24/26.11.24摘要.json
 *    周    26.11.16～26.11.22/26.11.16～26.11.22记忆文档.json
 *    周期  26.10～26.11/26.10～26.11周期文档.json
 *    年    2026/2026年度文档.json
 */
function collectSummaries(kind, limit) {
  const suffix = {
    detail: '摘要.json', week: '记忆文档.json',
    big: '周期文档.json', year: '年度文档.json',
  }[kind]
  const found = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = path.join(dir, e.name)
      let files = []
      try { files = fs.readdirSync(p) } catch { continue }
      const hit = files.find(f => f.startsWith(e.name) && f.endsWith(suffix))
      if (hit) {
        try { found.push({ name: e.name, data: JSON.parse(fs.readFileSync(path.join(p, hit), 'utf8')) }) } catch { /* 忽略坏文件 */ }
      }
      walk(p)   // 进「下属记忆」等子目录
    }
  }
  walk(SUMS)
  return found.sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit)
}

function latestTurns() {
  const s = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions',
    '61b7d693-5935-4950-920c-308d2f6b7a99.json')
  if (!fs.existsSync(s)) return []
  const d = JSON.parse(fs.readFileSync(s, 'utf8'))
  return d.record.rows.turnOutline.val.turns.slice(-RECENT_TURNS)
    .map(t => ({ turn: t.turn, prompt: t.prompt || '', response: t.response || '' }))
}

function cmdCtx() {
  const detail = collectSummaries('detail', SUM_KEEP.detail)
  const week = collectSummaries('week', SUM_KEEP.week)
  const big = collectSummaries('big', SUM_KEEP.big)
  const turns = latestTurns()

  const payload = {
    generatedAt: nowISO(),
    规则: '7 详细 + 7 周 + 7 大 + 最近 300 条原文',
    详细记录: detail,
    周总结: week,
    大总结: big,
    最近原文: turns,
  }
  fs.writeFileSync(TOTAL, JSON.stringify(payload, null, 2), 'utf8')

  const out = ['# 当前上下文', '', `> ${nowISO()} · 原始片段 ${turns.length} 条`, '']

  const section = (title, arr, empty) => {
    out.push(`## ${title}（${arr.length} 个）`, '')
    if (!arr.length) out.push(`- （${empty}）`)
    for (const d of arr) {
      out.push(`### ${d.name}`)
      const items = d.data.items || []
      if (!items.length) out.push('- （还没收敛出条目）')
      for (const it of items.slice(0, 8)) out.push(`- ${it}`)
      out.push('')
    }
  }

  section('详细记录（日）', detail, '还没有日摘要')
  section('周总结', week, '还没有周总结')
  section('大总结', big, '还没有大总结')

  out.push(`## 最近 ${turns.length} 条原文`, '', '| 轮 | 他 | 她 |', '|---|---|---|')
  for (const t of turns) out.push(`| ${t.turn} | ${clip(t.prompt, 40)} | ${clip(t.response, 50)} |`)

  fs.writeFileSync(CTX, out.join('\n') + '\n', 'utf8')
  console.log(`✅ 总上下文.json（${(fs.statSync(TOTAL).size / 1024).toFixed(0)} KB）`)
  console.log(`✅ 当前上下文.md（${(fs.statSync(CTX).size / 1024).toFixed(0)} KB）`)
  console.log(`   详细 ${detail.length} · 周 ${week.length} · 大 ${big.length} · 原文 ${turns.length}`)
}

// ---------------- 入口 ----------------

const [group, cmd, ...rest] = process.argv.slice(2)
const table = {
  ev: { add: cmdAdd, search: cmdSearch, link: cmdLink, summarize: cmdSummarize, list: cmdList, show: cmdShow },
  sum: {
    day: cmdSumDay, rollup: cmdRollup, tree: cmdSumTree,
    anchor: cmdAnchor, window: cmdWindow, save: cmdSave,
  },
  ctx: { '': cmdCtx },
}

if (group === 'ctx') { cmdCtx(); }
else if (table[group] && table[group][cmd]) { table[group][cmd](rest) }
else {
  console.log(`记忆引擎

事件碎片
  node mem.js ev add <json>
  node mem.js ev search "关键词" [--deep]
  node mem.js ev link <id> [--depth 2]
  node mem.js ev summarize
  node mem.js ev list [--level L0]
  node mem.js ev show <id>

摘要记忆
  node mem.js sum anchor                   看摘要锚点停在哪一轮
  node mem.js sum anchor --set 1190        手动推锚点
  node mem.js sum window                   导出「锚点→当前」的完整对话
  node mem.js sum save --from 832 --to 1190 --file 条目.md   写摘要并推锚点
  node mem.js sum day 11.23 --text "条目1\\n条目2"
  node mem.js sum rollup
  node mem.js sum tree

上下文
  node mem.js ctx`)
}
