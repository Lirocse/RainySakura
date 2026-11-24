/**
 * dsh-menmo-memory —— 把 memory\mem.js 包成 DSH 工具。
 *
 * 这样我就不用敲 bash，直接作为工具调用：
 *   memory_search / memory_linked / memory_event / memory_summary / memory_context
 *
 * 规则见 memory\规则.md，引擎是 memory\mem.js。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOSTLOG = process.env.DSH_MEMORY_HOSTLOG
  || path.join(os.homedir(), '.dsh', 'memory-plugin.log')
function log(msg) {
  try { fs.appendFileSync(HOSTLOG, `[${new Date().toISOString()}] [memory] ${msg}\n`, 'utf8') } catch { /* 忽略 */ }
}

let MEMORY_DIR = process.env.DSH_MEMORY_DIR
  || path.join(os.homedir(), 'dsh-memory')
const memJs = () => path.join(MEMORY_DIR, 'mem.js')

/** DSH 自带的 node；找不到就退回 PATH 上的 node */
function nodeExe() {
  const built = path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime',
    'dependencies', 'node', 'bin', 'node.exe')
  return fs.existsSync(built) ? built : 'node'
}

function run(args, { timeout = 60000 } = {}) {
  if (!fs.existsSync(memJs())) {
    return `记忆引擎不存在：${memJs()}`
  }
  try {
    const out = execFileSync(nodeExe(), [memJs(), ...args], {
      cwd: MEMORY_DIR,
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    return out.trim() || '（无输出）'
  } catch (e) {
    const detail = (e.stdout || '') + (e.stderr || '') || e.message
    return `执行失败：${String(detail).slice(0, 800)}`
  }
}

const OUTPUT = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (args, value) => [{ type: 'text', text: value.text }],
}

const wrap = (text) => ({ text })

export const name = 'tool-memory'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  if (config.memoryDir) MEMORY_DIR = config.memoryDir
  log(`apply 开始；引擎=${memJs()}；存在=${fs.existsSync(memJs())}`)
  try { registerAll(ctx); log('✅ 5 个工具已注册') }
  catch (e) { log('❌ 注册失败: ' + (e && e.stack || e)) }
}

function registerAll(ctx) {
  // 1) 直接调取：只从 L0~L1 找，没有才下探
  ctx.tools.register({
    name: 'memory_search',
    description:
      '检索长期记忆的事件碎片（直接调取）。只从 L0~L1 层找，找不到会自动下探下一层。'
      + '被命中的事件会加分。想不起某件事时用它，不要凭印象编。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，空格分隔多个' },
        deep: { type: 'boolean', description: 'true 时包含半丢弃层（只有人明确要求才用）' },
      },
      required: ['query'],
    },
    output: OUTPUT,
    execute(args) {
      const argv = ['ev', 'search', args.query]
      if (args.deep) argv.push('--deep')
      return Promise.resolve(wrap(run(argv)))
    },
  })

  // 2) 关联检索
  ctx.tools.register({
    name: 'memory_linked',
    description:
      '从一个事件出发，按「关联事件」牵出相关记忆。不限层级，但受每条事件的被关联权重系数(linkCap)限制。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '起点事件名，如 配音做到95%' },
        depth: { type: 'integer', description: '牵几层，默认 2' },
      },
      required: ['id'],
    },
    output: OUTPUT,
    execute(args) {
      const argv = ['ev', 'link', args.id]
      if (args.depth !== undefined) argv.push('--depth', String(args.depth))
      return Promise.resolve(wrap(run(argv)))
    },
  })

  // 3) 写事件 / 总结 / 列表
  ctx.tools.register({
    name: 'memory_event',
    description:
      '维护事件碎片。add=新增一条事件（进 L0）；summarize=事件总结（洗牌升降级，人说过「处理你自身记忆」后用）；'
      + 'list=按层级列出。事件要一条一个，别把一天塞成一条。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'summarize', 'list'] },
        type: { type: 'string', description: 'add 用：日常/工作/冲突/技术/情感' },
        summary: { type: 'string', description: 'add 用：一句话总结，检索时靠它' },
        detail: { type: 'string', description: 'add 用：详细正文' },
        time: { type: 'string', description: 'add 用：YYYY-MM-DD，默认今天' },
        links: { type: 'array', items: { type: 'string' }, description: 'add 用：关联事件名' },
        linkCap: { type: 'integer', description: 'add 用：被关联权重系数，默认 3' },
        level: { type: 'string', description: 'list 用：只看某一层，如 L0' },
      },
      required: ['action'],
    },
    output: OUTPUT,
    execute(args) {
      if (args.action === 'add') {
        const payload = {
          time: args.time,
          type: args.type || '日常',
          summary: args.summary,
          detail: args.detail || '',
          links: args.links || [],
          linkCap: args.linkCap,
        }
        const tmp = path.join(MEMORY_DIR, '.tmp_event.json')
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
        const out = run(['ev', 'add', tmp])
        try { fs.unlinkSync(tmp) } catch { /* 忽略 */ }
        return Promise.resolve(wrap(out))
      }
      if (args.action === 'summarize') {
        return Promise.resolve(wrap(run(['ev', 'summarize'], { timeout: 120000 })))
      }
      const argv = ['ev', 'list']
      if (args.level) argv.push('--level', args.level)
      return Promise.resolve(wrap(run(argv)))
    },
  })

  // 4) 摘要树
  ctx.tools.register({
    name: 'memory_summary',
    description:
      '摘要记忆的维护。day=落一份日摘要（11.23 这种名字，条目用换行分隔）；'
      + 'rollup=把最早的 7 个日摘要卷成一个区间（会移动目录）；tree=打印摘要树。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['day', 'rollup', 'tree'] },
        date: { type: 'string', description: 'day 用：如 11.23' },
        text: { type: 'string', description: 'day 用：摘要条目，换行分隔，最多 6 条' },
        turns: { type: 'integer', description: 'day 用：覆盖了多少轮对话' },
      },
      required: ['action'],
    },
    output: OUTPUT,
    execute(args) {
      if (args.action === 'day') {
        if (!args.date) return Promise.resolve(wrap('缺 date，例如 11.23'))
        const argv = ['sum', 'day', args.date]
        if (args.turns !== undefined) argv.push('--turns', String(args.turns))
        if (args.text) argv.push('--text', args.text)
        return Promise.resolve(wrap(run(argv)))
      }
      if (args.action === 'rollup') return Promise.resolve(wrap(run(['sum', 'rollup'])))
      return Promise.resolve(wrap(run(['sum', 'tree'])))
    },
  })

  // 5) 生成上下文
  ctx.tools.register({
    name: 'memory_context',
    description:
      '生成「总上下文.json」和「当前上下文.md」（摘要记忆 + 最近 300 条原文），并返回可读内容。'
      + '会话开始时用一次就够。',
    parameters: { type: 'object', properties: {} },
    output: OUTPUT,
    execute() {
      const out = run(['ctx'], { timeout: 120000 })
      try {
        const ctxPath = path.join(MEMORY_DIR, '当前上下文.md')
        const body = fs.readFileSync(ctxPath, 'utf8')
        return Promise.resolve(wrap(`${out}\n\n---\n\n${body}`))
      } catch {
        return Promise.resolve(wrap(out))
      }
    },
  })
}
