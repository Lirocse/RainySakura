/**
 * dsh-menmo-rules —— 额外规则库声明
 *
 * 职责只有一个：**第一次启动时，在记忆目录里铺好六份声明文件。**
 *
 * 它不写摘要、不检索、不压缩。存在过的文件一律不覆盖——
 * 那里面是人跟 Agent 自己写的东西，插件没有资格动。
 *
 * 六个文件（名字里的 AgentID 由配置决定）：
 *   Objective_Information.md          信息库：标题-标签-内容
 *   Knowledge_Library.md              知识库：标题-标签 / 输入-输出-原理
 *   <Agent>_Diary.md                  日记：Agent 自己写
 *   Session_All.md                    上下文原文备份索引
 *   <Agent>_IDENTITY.md               个人记忆档案
 *   <Agent>_and_User_Information.md   人类方档案
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TPL_DIR = path.join(HERE, '..', 'templates')

const HOSTLOG = process.env.DSH_MEMORY_HOSTLOG
  || path.join(os.homedir(), '.dsh', 'memory-plugin.log')

function log(msg) {
  try {
    fs.appendFileSync(HOSTLOG, `[${new Date().toISOString()}] [rules] ${msg}\n`, 'utf8')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export const name = 'dsh-memory-rules'

/** 模板文件 → 目标文件名模板（{agentId} 会被替换） */
const MAP = {
  'Objective_Information.md': 'Objective_Information.md',
  'Knowledge_Library.md': 'Knowledge_Library.md',
  'Agent_Diary.md': '{agentId}_Diary.md',
  'Session_All.md': 'Session_All.md',
  'Agent_IDENTITY.md': '{agentId}_IDENTITY.md',
  'Agent_and_User_Information.md': '{agentId}_and_User_Information.md',
}

export function apply(ctx, config = {}) {
  const dir = config.memoryDir
    || process.env.DSH_MEMORY_DIR
    || path.join(os.homedir(), 'dsh-memory')
  const agentId = config.agentId || 'Agent'

  if (!fs.existsSync(TPL_DIR)) {
    log(`模板目录不存在：${TPL_DIR}`)
    return
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    log(`建记忆目录失败：${e && e.message}`)
    return
  }

  let created = 0
  let kept = 0

  for (const [tpl, target] of Object.entries(MAP)) {
    const src = path.join(TPL_DIR, tpl)
    const dst = path.join(dir, target.replace('{agentId}', agentId))
    if (!fs.existsSync(src)) {
      log(`跳过（模板缺失）：${tpl}`)
      continue
    }
    if (fs.existsSync(dst)) {
      kept += 1
      continue          // 已经有了就不动
    }
    try {
      let body = fs.readFileSync(src, 'utf8')
      body = body.replace(/\{agentId\}/g, agentId)
      fs.writeFileSync(dst, body, 'utf8')
      created += 1
    } catch (e) {
      log(`写 ${dst} 失败：${e && e.message}`)
    }
  }

  log(`规则库就绪：新建 ${created} 份，保留已有 ${kept} 份（目录 ${dir}）`)
}
