// ============ 全自定义功能插件 - 任务执行引擎 ============
// 按步骤顺序执行，支持 if 分支、for/while 循环、延时、变量、日志、OneBot 接口、数据库、文件、命令注册
import { Context } from 'koishi'
import { createHash, randomInt, randomUUID } from 'crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Step, TaskRecord, TileDef } from './types'
import { TILE_MAP, OP_NEEDS_VALUE } from './tiles'
import { template, evaluate, evalCondition } from './expr'

export interface LogLine { time: string, level: string, text: string }

export interface RunResult {
  ok: boolean
  status: 'success' | 'failed' | 'stopped'
  entries: LogLine[]
  message: string
}

export interface RunOptions {
  vars?: Record<string, any>
  onStatus?: (status: string, message: string) => void
}

// 循环控制信号
class BreakSignal extends Error {}
class ContinueSignal extends Error {}

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const LOG_LEVELS = new Set(['info', 'warn', 'error'])

// 查找可用的 OneBot 机器人
function findOneBotBot(ctx: Context): any {
  for (const bot of ctx.bots) {
    const b: any = bot
    if (b && (typeof b.onebot === 'function' || b.internal)) return b
  }
  return ctx.bots[0] as any || null
}

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

// 支持的 OneBot 框架
export type OneBotFramework = 'auto' | 'llbot' | 'napcat'

export function frameworkLabel(f: OneBotFramework): string {
  return f === 'napcat' ? 'NapCat' : f === 'llbot' ? 'LLOneBot' : '自动识别'
}

// 已知框架差异：个别扩展接口在不同实现中的 action 别名（标准名优先，失败后依次尝试）
const ACTION_ALIASES: Record<string, string[]> = {
  get_group_msg_history: ['get_group_msg_history', 'get_group_history_msg'],
  send_group_sign: ['send_group_sign', 'send_sign'],
  ocr_image: ['ocr_image', 'ocr'],
  get_group_honor_info: ['get_group_honor_info', 'get_group_honor_list'],
}

// 参数规范化：模板渲染后 boolean 会变成字符串，LLOneBot/NapCat 等框架要求真布尔值；
// 转发消息等 JSON 文本参数转换为对象/数组（message 内容除外，避免误解析用户文本）
function normalizeParams(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(params || {})) {
    if (v === 'true') out[k] = true
    else if (v === 'false') out[k] = false
    else if (k !== 'message' && k !== 'card' && typeof v === 'string' && /^[\[{]/.test(v.trim())) {
      try { out[k] = JSON.parse(v) } catch { out[k] = v }
    } else {
      out[k] = v
    }
  }
  return out
}

// 自动检测框架：依据适配器/平台信息尽力识别，无法识别时按标准 v11 处理
export function detectFramework(bot: any, fallback: OneBotFramework = 'auto'): OneBotFramework {
  if (fallback && fallback !== 'auto') return fallback
  try {
    const probe = String(((bot as any)?.adapter?.name ?? '') + ' ' + ((bot as any)?.platform ?? '') + ' ' + ((bot as any)?.selfId ?? '')).toLowerCase()
    if (probe.includes('napcat')) return 'napcat'
    if (probe.includes('llonebot') || probe.includes('llbot')) return 'llbot'
  } catch { /* ignore */ }
  return 'auto'
}

function oneBotErr(action: string, framework: OneBotFramework, detail?: string): string {
  const hint = `接口 ${action}（框架适配：${frameworkLabel(framework)}）`
  if (framework !== 'auto') return detail ? `${hint}：${detail}；如接口在该框架上不支持，请改用 auto 或更换框架` : `${hint}不受当前框架支持`
  return detail ? `接口 ${action}：${detail}` : `接口 ${action} 调用失败`
}

// 调用 OneBot 接口：优先 bot.onebot(action, params)，失败时按别名/驼峰 internal 回退
export async function callOneBot(bot: any, action: string, params: Record<string, any>, framework: OneBotFramework = 'auto'): Promise<any> {
  if (!bot) throw new Error('未找到可用的机器人')
  const p = normalizeParams(params)
  const attempts = [action]
  for (const alias of ACTION_ALIASES[action] || []) {
    if (!attempts.includes(alias)) attempts.push(alias)
  }
  const raw = bot.onebot
  if (typeof raw === 'function') {
    let lastErr: Error | null = null
    for (const act of attempts) {
      try {
        const res = await raw(act, p)
        // OneBot 通用返回包装：{ status, retcode, data, message }
        if (res && typeof res === 'object' && 'retcode' in res && res.retcode !== 0) {
          lastErr = new Error(oneBotErr(action, framework, `retcode=${res.retcode} ${res.message || res.error || ''}`))
          continue // 尝试别名
        }
        return res && typeof res === 'object' && 'data' in res ? res.data : res
      } catch (e) {
        lastErr = e as Error
        continue // 尝试别名
      }
    }
    throw lastErr || new Error(oneBotErr(action, framework))
  }
  const internal = bot.internal
  if (internal) {
    for (const act of attempts) {
      const method = internal[camelCase(act)]
      if (typeof method === 'function') {
        return await method(...Object.values(p))
      }
    }
  }
  throw new Error(oneBotErr(action, framework))
}

function escapeCq(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/,/g, '&#44;')
}

function messageForTile(tileId: string, params: Record<string, any>): Record<string, any> {
  const out = { ...params }
  const file = escapeCq(params.file)
  if (tileId === 'ob.send_image_msg') out.message = `[CQ:image,file=${file},cache=${params.cache === false ? 0 : 1}]`
  else if (tileId === 'ob.send_audio_msg') out.message = `[CQ:record,file=${file},magic=${params.magic === true ? 1 : 0}]`
  else if (tileId === 'ob.send_file_msg') {
    out.message = `[CQ:file,file=${file}${params.name ? `,name=${escapeCq(params.name)}` : ''}]`
  } else if (tileId === 'ob.send_video_msg') {
    out.message = `[CQ:video,file=${file}${params.cover ? `,cover=${escapeCq(params.cover)}` : ''}]`
  } else if (tileId === 'ob.send_card_msg') {
    out.message = `[CQ:json,data=${escapeCq(params.card)}]`
  }
  delete out.file
  delete out.cache
  delete out.magic
  delete out.name
  delete out.cover
  delete out.card
  return out
}

function commandArgs(input: string): string[] {
  const result: string[] = []
  const matcher = /(?:[^\s"']+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')+/g
  for (const token of input.match(matcher) || []) {
    const quote = token[0]
    const value = (quote === '"' || quote === "'") && token.endsWith(quote) ? token.slice(1, -1) : token
    result.push(value.replace(/\\([\\"'])/g, '$1'))
  }
  return result
}

function toNumber(v: any): number {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').trim())
  return isNaN(n) ? NaN : n
}

// 宽松相等：双方均可解析为数字时按数字比较，否则按字符串比较
function looseEqual(a: string, b: string): boolean {
  const na = toNumber(a)
  const nb = toNumber(b)
  if (!isNaN(na) && !isNaN(nb)) return na === nb
  return a === b
}

// 条件规则比较：value 为子磁贴返回的真实值，op 为运算符，target 为对比值（支持 {变量}）
export function compareValues(value: string, op: string, target: string): boolean {
  const v = String(value ?? '')
  const t = String(target ?? '')
  switch (op) {
    case 'isEmpty': return v.trim() === ''
    case 'notEmpty': return v.trim() !== ''
    case 'contains': return v.includes(t)
    case 'notContains': return !v.includes(t)
    case 'regex':
    case 'notRegex': {
      try {
        const re = new RegExp(t)
        const ok = re.test(v)
        return op === 'regex' ? ok : !ok
      } catch { return false }
    }
    case '>': return toNumber(v) > toNumber(t)
    case '>=': return toNumber(v) >= toNumber(t)
    case '<': return toNumber(v) < toNumber(t)
    case '<=': return toNumber(v) <= toNumber(t)
    case '!=': return !looseEqual(v, t)
    case '==':
    default: return looseEqual(v, t)
  }
}

const OP_LABELS: Record<string, string> = {
  '==': '等于', '!=': '不等于', '>': '大于', '>=': '大于等于', '<': '小于', '<=': '小于等于',
  contains: '包含', notContains: '不包含', regex: '正则匹配', notRegex: '正则不匹配',
  isEmpty: '为空', notEmpty: '不为空',
}
export function opLabel(op: string): string {
  return OP_LABELS[op] || op
}
function truncate(s: string, max = 120): string {
  const str = String(s ?? '')
  return str.length > max ? str.slice(0, max) + '…' : str
}

const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024

function parseJsonObject(value: any, label: string): Record<string, any> {
  if (value === undefined || value === null || String(value).trim() === '') return {}
  let parsed: any
  try { parsed = typeof value === 'object' ? value : JSON.parse(String(value)) } catch (e) {
    throw new Error(`${label} JSON 解析失败：${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象`)
  return parsed
}

function parseJsonValue(value: any, label: string): any {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch (e) {
    throw new Error(`${label} JSON 解析失败：${(e as Error).message}`)
  }
}

async function readHttpResponse(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_HTTP_RESPONSE_BYTES) throw new Error(`响应体超过 ${MAX_HTTP_RESPONSE_BYTES} 字节限制`)
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_RESPONSE_BYTES) throw new Error(`响应体超过 ${MAX_HTTP_RESPONSE_BYTES} 字节限制`)
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > MAX_HTTP_RESPONSE_BYTES) throw new Error(`响应体超过 ${MAX_HTTP_RESPONSE_BYTES} 字节限制`)
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

async function requestHttp(method: 'GET' | 'POST', params: Record<string, any>): Promise<any> {
  const rawUrl = String(params.url ?? '').trim()
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('URL 格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('URL 仅允许 http 或 https 协议')
  const headersJson = parseJsonObject(params.headers, '请求头')
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(headersJson)) {
    if (value !== null && value !== undefined) headers[key] = String(value)
  }
  if (method === 'GET') {
    const query = parseJsonObject(params.query, '查询参数')
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)))
      else url.searchParams.set(key, String(value))
    }
  }
  const init: RequestInit = { method, headers }
  if (method === 'POST') {
    const bodyType = String(params.bodyType || 'json')
    const body = String(params.body ?? '')
    if (bodyType === 'json') {
      const parsed = parseJsonValue(body, 'JSON 请求体')
      init.body = JSON.stringify(parsed)
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
    } else if (bodyType === 'form') {
      const form = parseJsonObject(body, '表单请求体')
      init.body = new URLSearchParams(Object.entries(form).reduce<Record<string, string>>((out, [key, value]) => {
        out[key] = value === null || value === undefined ? '' : String(value)
        return out
      }, {})).toString()
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else {
      init.body = body
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'text/plain;charset=UTF-8'
    }
  }
  const response = await fetch(url, init)
  const text = await readHttpResponse(response)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `：${truncate(text)}` : ''}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.toLowerCase().includes('json')) {
    try { return JSON.parse(text) } catch { return text }
  }
  return text
}

async function requestAiOcr(params: Record<string, any>): Promise<Record<string, any>> {
  const endpoint = String(params.aiEndpoint || '').trim()
  const apiKey = String(params.aiApiKey || '').trim()
  const model = String(params.aiModel || '').trim()
  const image = String(params.image || '').trim()
  const prompt = String(params.aiPrompt || '').trim()
  if (!endpoint || !apiKey || !model || !image) throw new Error('AI OCR 兜底需要填写服务地址、API 密钥、视觉模型名和图片 URL')
  let endpointUrl: URL
  let imageUrl: URL
  try { endpointUrl = new URL(endpoint) } catch { throw new Error('AI OCR 服务地址格式无效') }
  try { imageUrl = new URL(image) } catch { throw new Error('AI OCR 兜底仅支持公开可访问的 http/https 图片 URL') }
  if (!['http:', 'https:'].includes(endpointUrl.protocol) || !['http:', 'https:'].includes(imageUrl.protocol)) throw new Error('AI OCR 服务地址和图片 URL 仅允许 http 或 https 协议')
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt || '请识别图片中的全部可见文字，按原有阅读顺序输出纯文本。' },
        { type: 'image_url', image_url: { url: imageUrl.href } },
      ] }],
      temperature: 0,
    }),
  })
  const text = await readHttpResponse(response)
  if (!response.ok) throw new Error(`AI OCR 服务响应失败：HTTP ${response.status} ${response.statusText}`)
  let raw: any
  try { raw = JSON.parse(text) } catch { throw new Error('AI OCR 服务未返回合法 JSON') }
  const content = raw?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI OCR 服务响应中缺少识别文本')
  return {
    texts: [{ text: content.trim(), confidence: null, coordinates: [] }],
    language: 'ai-vision',
    source: 'ai-fallback',
    model: String(raw?.model || model),
    usage: raw?.usage || {},
    raw,
  }
}

async function requestAiChat(params: Record<string, any>): Promise<Record<string, any>> {
  const endpoint = String(params.endpoint || '').trim()
  const apiKey = String(params.apiKey || '').trim()
  const model = String(params.model || '').trim()
  const prompt = String(params.prompt || '')
  if (!endpoint || !apiKey || !model || !prompt) throw new Error('AI 服务地址、API 密钥、模型名和用户提示词均不能为空')
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error('AI 服务地址格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AI 服务地址仅允许 http 或 https 协议')
  const messages: { role: string, content: string }[] = []
  const system = String(params.system || '').trim()
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const body: Record<string, any> = { model, messages, temperature: Math.max(0, Math.min(2, Number(params.temperature ?? 0.7))) }
  const maxTokens = Number(params.maxTokens || 0)
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = Math.min(Math.floor(maxTokens), 32768)
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await readHttpResponse(response)
  if (!response.ok) throw new Error(`AI 服务响应失败：HTTP ${response.status} ${response.statusText}`)
  let raw: any
  try { raw = JSON.parse(text) } catch { throw new Error('AI 服务未返回合法 JSON') }
  const content = raw?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('AI 服务响应中缺少 choices[0].message.content')
  return { content, model: String(raw?.model || model), usage: raw?.usage || {}, raw }
}

// ---------- 数据库 / 文件 磁贴辅助函数 ----------
// 允许的数据库表名（Koishi 表名通常为 字母/数字/下划线/冒号）
function assertTableName(table: string): void {
  if (!table) throw new Error('表名为空')
  if (!/^[A-Za-z_][A-Za-z0-9_:]*$/.test(table)) throw new Error(`非法表名：${table}`)
}

// 解析磁贴中 JSON 文本参数（空串按空对象处理）；已是对象/数组则直接使用
function parseJsonArg(value: any, label: string): any {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!s) return {}
  try { return JSON.parse(s) } catch (e) { throw new Error(`${label} JSON 解析失败：${(e as Error).message}`) }
}

// 文件基础目录：选定后自动创建
async function fsBaseDir(ctx: Context, base: string): Promise<string> {
  const root = base === 'data'
    ? path.join(ctx.baseDir, 'data')
    : base === 'temp'
      ? path.join(os.tmpdir(), 'fully-customized-function-mywl')
      : path.join(ctx.baseDir, 'data', 'fully-customized-function-mywl')
  await fs.mkdir(root, { recursive: true })
  return root
}

// 相对路径解析到基础目录内，禁止越界（防 ../ 逃逸）
function resolveInside(baseDir: string, rel: string): string {
  const target = path.resolve(baseDir, rel || '.')
  const base = path.resolve(baseDir)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界：${rel} 不在基础目录内（禁止通过 .. 跳出）`)
  }
  return target
}

// ---------- Koishi 自定义命令注册 ----------
interface RegisteredCommand { ctx: Context, name: string }
const registeredCommands: RegisteredCommand[] = []
export function disposeRegisteredCommands(ctx: Context): void {
  for (let i = registeredCommands.length - 1; i >= 0; i--) {
    const rc = registeredCommands[i]
    if (rc.ctx === ctx) {
      try { (ctx as any).removeCommand?.(rc.name) } catch { /* 忽略移除失败 */ }
      registeredCommands.splice(i, 1)
    }
  }
}

// ---------- 工具磁贴辅助函数 ----------
// CPU 使用率：两次 process.cpuUsage() 差值的占比（%）
let cpuSample = { time: 0, user: 0, sys: 0 }
function cpuPercent(): number {
  try {
    const usage = process.cpuUsage()
    const now = Date.now()
    if (!cpuSample.time) {
      cpuSample = { time: now, user: usage.user, sys: usage.system }
      return 0
    }
    const dt = now - cpuSample.time
    const du = (usage.user + usage.system) - (cpuSample.user + cpuSample.sys)
    cpuSample = { time: now, user: usage.user, sys: usage.system }
    if (dt <= 0) return 0
    return Math.max(0, Math.min(99.9, (du / dt / 1000) * 100))
  } catch { return 0 }
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${d}天${h}小时${m}分${s}秒`
}

function fmtDate(d: Date, fmt: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0'),
    HH: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
    ss: String(d.getSeconds()).padStart(2, '0'),
  }
  return (fmt || 'YYYY-MM-DD HH:mm:ss').replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m] || m)
}

// 简易 XML → JSON 树（标签/属性/文本/子节点，无第三方依赖）
function xmlToTree(xml: string): any {
  const root: any = { name: '#root', children: [] }
  let cur: any = root
  const textBuf: string[] = []
  const tagRe = /<(\/?)([A-Za-z0-9_:.-]+)((?:\s+[A-Za-z0-9_:.-]+=(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  const flush = () => {
    const t = textBuf.join('').trim()
    if (t) {
      if (!cur.children) cur.children = []
      cur.children.push({ type: 'text', value: t })
    }
    textBuf.length = 0
  }
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(String(xml)))) {
    textBuf.push(String(xml).slice(last, m.index))
    last = tagRe.lastIndex
    const [, close, name, attrsRaw, selfClose] = m
    if (close) { flush(); cur = cur.parent || root; continue }
    flush()
    const node: any = { name, parent: cur }
    const attrs: Record<string, string> = {}
    const attrRe = /([A-Za-z0-9_:.-]+)=("([^"]*)"|'([^']*)')/g
    let am: RegExpExecArray | null
    while ((am = attrRe.exec(attrsRaw || ''))) attrs[am[1]] = am[3] ?? am[4] ?? ''
    if (Object.keys(attrs).length) node.attrs = attrs
    if (!cur.children) cur.children = []
    cur.children.push(node)
    if (!selfClose) cur = node
  }
  flush()
  const strip = (n: any) => {
    delete n.parent
    ;(n.children || []).forEach(strip)
    return n
  }
  return root.children?.map(strip) ?? []
}

// JSON 树 → 美化 XML（配合 xmlToTree 使用）
function xmlNodeToString(n: any, ind: number): string {
  const pad = '  '.repeat(ind)
  if (n.type === 'text') return n.value
  const attrs = n.attrs ? ' ' + Object.entries(n.attrs).map(([k, v]) => `${k}="${v}"`).join(' ') : ''
  if (!n.children || !n.children.length) return `${pad}<${n.name}${attrs}/>`
  const inner = n.children.map((c: any) => xmlNodeToString(c, ind + 1)).join('\n')
  return `${pad}<${n.name}${attrs}>\n${inner}\n${pad}</${n.name}>`
}

export class Runner {
  private ctx: Context
  private opts: RunOptions
  private vars: Record<string, any>
  entries: LogLine[] = []
  private stopRequested = false
  private opCount = 0
  private maxOps = 200000
  private startTime = Date.now()
  private hooks: Required<RunOptions>
  private framework: OneBotFramework
  // 调试日志开关：false 时抑制步骤级信息/警告日志，仅保留明确配置的输出与错误
  private debug: boolean

  constructor(ctx: Context, private task: TaskRecord, options: RunOptions = {}, framework: OneBotFramework = 'auto', debug = false) {
    this.ctx = ctx
    this.opts = options
    this.hooks = options as Required<RunOptions>
    this.framework = framework
    this.debug = debug
    this.vars = {
      now: fmtTime(new Date()),
      taskName: task.name,
      taskId: String(task.id),
      lastResult: '',
      ...(options.vars || {}),
    }
  }

  // 供命令回调等场景复用：在独立变量上下文中执行一组步骤，结束后恢复原变量
  async runStepList(steps: Step[], extraVars?: Record<string, any>): Promise<void> {
    const keys = Object.keys(extraVars || {})
    const prev: Record<string, any> = {}
    for (const k of keys) {
      prev[k] = this.vars[k]
      this.vars[k] = extraVars![k]
    }
    try {
      await this.runList(steps)
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete this.vars[k]
        else this.vars[k] = prev[k]
      }
    }
  }

  stop(): void {
    this.stopRequested = true
  }

  log(level: 'info' | 'warn' | 'error', text: string, force = false) {
    // 调试关闭时：抑制步骤级 info/warn（显式配置的输出任务除外），错误信息仍保留
    if (!this.debug && !force && level !== 'error') return
    const line = { time: fmtTime(new Date()), level, text }
    this.entries.push(line)
    if (level === 'warn') this.ctx.logger('全自定义功能').warn(this.task.name, text)
    else if (level === 'error') this.ctx.logger('全自定义功能').error(this.task.name, text)
    else this.ctx.logger('全自定义功能').info(this.task.name, text)
  }

  private opGuard() {
    if (this.stopRequested) throw new BreakSignal() // 用 BreakSignal 终止最外层（无循环时被吞掉）
    if (++this.opCount > this.maxOps) throw new Error('执行步骤数超限（可能死循环），已自动终止')
  }

  // 条件规则子磁贴：取其「被比较的值」（resultVar → var_set 的 var → lastResult），
// 若配置了 JSON 路径字段则从返回结果中提取（如 group_id）
  private ruleValue(rule: Step): string {
    const key = String(rule.params?.resultVar || '').trim()
      || (rule.tile === 'sys.var_set' ? String(rule.params?.var || '').trim() : '')
      || 'lastResult'
    const v = this.vars[key]
    let raw = v === undefined || v === null ? '' : String(v)
    const field = String(rule.params?.compareField || '').trim()
    if (field) {
      try {
        const obj = typeof v === 'object' ? v : JSON.parse(raw)
        let cur: any = obj
        for (const seg of field.split('.')) {
          if (cur === null || cur === undefined) break
          cur = cur[seg]
        }
        if (cur !== undefined && cur !== null) raw = String(cur)
      } catch { /* 非 JSON 内容则使用原始值 */ }
    }
    return raw
  }

  run(): Promise<RunResult> {
    return this.runList(this.task.steps || [])
      .then(() => ({ ok: true, status: 'success' as const, entries: this.entries, message: `执行完成，耗时 ${Date.now() - this.startTime}ms` }))
      .catch((e) => {
        if (this.stopRequested && e instanceof BreakSignal) {
          this.entries.push({ time: fmtTime(new Date()), level: 'warn', text: '任务已被手动停止' })
          return { ok: false, status: 'stopped' as const, entries: this.entries, message: '任务已停止' }
        }
        if (e instanceof BreakSignal) return { ok: true, status: 'success' as const, entries: this.entries, message: '执行完成（跳出无循环包裹）' }
        if (e instanceof ContinueSignal) return { ok: true, status: 'success' as const, entries: this.entries, message: '执行完成（跳过无循环包裹）' }
        this.entries.push({ time: fmtTime(new Date()), level: 'error', text: `执行出错：${(e as Error).message}` })
        return { ok: false, status: 'failed' as const, entries: this.entries, message: (e as Error).message }
      })
  }

  private async runList(steps: Step[]): Promise<void> {
    for (const step of steps || []) {
      this.opGuard()
      if (!step.enabled) continue
      const tile = TILE_MAP[step.tile]
      if (!tile) {
        if (this.debug) this.log('warn', `跳过未知磁贴 ${step.tile}`)
        continue
      }
      if (this.debug) {
        const params = step.params || {}
        this.log('info', `▶ 进入步骤：${tile.label}（${step.tile}）参数：${JSON.stringify(params)}`)
      }
      await this.runStep(tile, step)
      if (this.debug) this.log('info', `◀ 退出步骤：${tile.label}`)
    }
  }

  private async runStep(tile: TileDef, step: Step): Promise<void> {
    switch (tile.kind) {
      case 'control':
        await this.runControl(tile, step)
        return
      case 'action':
        await this.runAction(tile, step)
        return
      case 'onebot':
        await this.runOneBot(tile, step)
        return
    }
  }

  // ---------- 流程控制 ----------
  private async runControl(tile: TileDef, step: Step): Promise<void> {
    const p = this.resolveParams(step.params)
    switch (tile.id) {
      case 'sys.if': {
        // 条件由「条件规则区」子磁贴自动生成：执行取值磁贴 → 按 op 与对比值比较 → 按 and/or 合并
        const rules = step.conditionSteps || []
        let cond: boolean
        if (rules.length === 0) {
          // 兼容旧版任务：退化为条件表达式求值
          const legacy = String(step.params?.condition ?? '')
          cond = legacy ? evalCondition(legacy, this.vars) : false
        } else {
          const logic = String(step.params?.logic || 'and')
          const results: boolean[] = []
          for (const rule of rules) {
            if (!rule.enabled) continue
            await this.runList([rule])
            const value = this.ruleValue(rule)
            const op = String(rule.params?.compareOp || '==')
            const target = template(String(rule.params?.compareValue ?? ''), this.vars)
            const ok = compareValues(value, op, target)
            results.push(ok)
            this.log('info', `[条件规则] ${opLabel(op)}：${truncate(value)} ${op !== 'isEmpty' && op !== 'notEmpty' ? `，对比值 ${target || '(空)'}` : ''} => ${ok ? '满足' : '不满足'}`)
          }
          cond = logic === 'or' ? results.some(Boolean) : results.every(Boolean)
          this.log('info', `[条件判断] ${results.length} 条规则（${logic === 'or' ? '任一满足' : '全部满足'}）=> ${cond ? '成立' : '不成立'}`)
        }
        try {
          if (cond) await this.runList(step.children || [])
          else await this.runList(step.elseChildren || [])
        } catch (e) {
          if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e
          throw e
        }
        return
      }
      case 'sys.loop_count': {
        const count = Math.max(0, parseInt(String(p.count || 0), 10) || 0)
        const varName = String(p.var || 'i')
        this.log('info', `[次数循环] 循环 ${count} 次`)
        for (let i = 1; i <= count; i++) {
          this.opGuard()
          this.vars[varName] = i
          try {
            await this.runList(step.children || [])
          } catch (e) {
            if (e instanceof BreakSignal) { this.log('info', `[次数循环] 第 ${i} 次被跳出`); break }
            if (e instanceof ContinueSignal) continue
            throw e
          }
        }
        return
      }
      case 'sys.loop_while': {
        const maxIter = Math.max(1, parseInt(String(p.max_iter || 100), 10) || 100)
        const condExpr = String(step.params?.condition ?? '')
        let iter = 0
        this.log('info', `[条件循环] 开始 while(${condExpr})`)
        while (evalCondition(condExpr, this.vars)) {
          if (++iter > maxIter) { this.log('warn', `[条件循环] 超过最大次数 ${maxIter}，已终止`); break }
          this.opGuard()
          try {
            await this.runList(step.children || [])
          } catch (e) {
            if (e instanceof BreakSignal) { this.log('info', `[条件循环] 第 ${iter} 次被跳出`); break }
            if (e instanceof ContinueSignal) continue
            throw e
          }
        }
        return
      }
      case 'sys.break':
        this.log('info', '[跳出循环]')
        throw new BreakSignal('break')
      case 'sys.continue':
        this.log('info', '[跳过本次循环]')
        throw new ContinueSignal('continue')
      case 'sys.wait': {
        const ms = Math.max(0, parseInt(String(p.ms || 0), 10) || 0)
        this.log('info', `[延时等待] ${ms}ms`)
        await new Promise((resolve) => setTimeout(resolve, ms))
        return
      }
      default:
        this.log('warn', `未知控制磁贴 ${tile.id}`)
    }
  }

  // ---------- 系统动作 ----------
  private async runAction(tile: TileDef, step: Step): Promise<void> {
    const p = this.resolveParams(step.params)
    switch (tile.id) {
      case 'sys.var_set': {
        const rawParams = step.params || {}
        const varName = String(rawParams.var || '').trim()
        if (!varName) { this.log('warn', '[设置变量] 变量名为空，已跳过'); return }
        if (!/^[A-Za-z_][\w]*$/.test(varName)) { this.log('warn', `[设置变量] 非法变量名 ${varName}`); return }
        const rawValue = String(rawParams.value ?? '')
        let value: any
        if (rawParams.mode === 'expr') {
          // 表达式模式直接对原始值求值（求值器内部负责 {变量} 替换与转义）
          try {
            value = evaluate(rawValue, this.vars)
          } catch (e) {
            this.log('warn', `[设置变量] 表达式解析失败，回退为文本：${(e as Error).message}`)
            value = template(rawValue, this.vars)
          }
        } else {
          value = template(rawValue, this.vars)
        }
        this.vars[varName] = value
        this.log('info', `[设置变量] ${varName} = ${value === '' || value === undefined || value === null ? '(空)' : String(value)}`)
        return
      }
      case 'sys.var_out': {
        const content = template(p.content ?? '', this.vars)
        this.log('info', `[读取变量] ${content}`, true)
        return
      }
      case 'sys.log': {
        const level = LOG_LEVELS.has(p.level) ? p.level : 'info'
        this.log(level, `[日志输出] ${template(p.content ?? '', this.vars)}`, true)
        return
      }
      case 'sys.comment':
        return

      // ---------- Koishi 信息 ----------
      case 'sys.koishi_status': {
        try {
          const mem = process.memoryUsage()
          const uptime = process.uptime()
          let pluginCount = 0
          try { pluginCount = Number((this.ctx as any).registry?.size ?? 0) } catch { /* ignore */ }
          let version = ''
          try { version = require('koishi/package.json').version } catch {
            try { version = String((this.ctx as any).version || '') } catch { /* ignore */ }
          }
          const totalRuns = await (this.ctx.database as any).get('mywl_ftask', {}, { fields: ['runCount'] })
            .then((rows: any[]) => rows.reduce((s, r) => s + (r.runCount || 0), 0))
            .catch(() => 0)
          const info = {
            koishiVersion: version || '未知',
            nodeVersion: process.version,
            uptimeSec: Math.round(uptime),
            uptimeText: fmtUptime(uptime),
            pluginCount,
            botCount: this.ctx.bots.length,
            memoryMB: Math.round(mem.rss / 1024 / 1024),
            cpuPercent: Math.round(cpuPercent() * 10) / 10,
            totalTaskRuns: totalRuns,
          }
          this.saveResult(step, info)
          this.log('info', `[Koishi 状态] ${JSON.stringify(info, null, 2)}`)
        } catch (e) {
          this.log('warn', `[Koishi 状态] 读取失败：${(e as Error).message}`)
        }
        return
      }
      case 'sys.bot_status': {
        const list = this.ctx.bots.map((bot: any) => ({
          platform: bot.platform || '',
          selfId: String(bot.selfId ?? ''),
          status: String(bot.status ?? 'unknown'),
          online: String(bot.status ?? 'online') !== 'offline',
          name: bot.user?.name || '',
        }))
        this.saveResult(step, list)
        this.log('info', `[机器人状态] ${JSON.stringify(list, null, 2)}`)
        return
      }

      case 'sys.http_get':
      case 'sys.http_post': {
        const result = await requestHttp(tile.id === 'sys.http_get' ? 'GET' : 'POST', p)
        this.saveResult(step, result)
        this.log('info', `[${tile.label}] 返回 ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`)
        return
      }

      case 'sys.json_tool': {
        const mode = String(step.params?.mode || 'parse')
        const input = String(step.params?.input ?? '')
        const pretty = step.params?.pretty !== false
        try {
          if (mode === 'stringify') {
            let parsed: any
            try { parsed = JSON.parse(input) } catch { parsed = input }
            const out = JSON.stringify(parsed, null, pretty ? 2 : 0)
            this.saveResult(step, out)
            this.log('info', `[JSON 序列化] ${out}`)
          } else {
            const obj = JSON.parse(input)
            const out = JSON.stringify(obj, null, pretty ? 2 : 0)
            this.saveResult(step, out)
            this.log('info', `[JSON 解析] ${out}`)
          }
        } catch (e) {
          this.log('error', `[JSON 处理] 失败：${(e as Error).message}`)
          throw new Error(`JSON 处理失败：${(e as Error).message}`)
        }
        return
      }
      case 'sys.xml_tool': {
        const mode = String(step.params?.mode || 'parse')
        const input = String(step.params?.input ?? '')
        try {
          const tree = xmlToTree(input)
          if (mode === 'format') {
            const out = tree.map((n: any) => xmlNodeToString(n, 0)).join('\n')
            this.saveResult(step, out)
            this.log('info', `[XML 格式化]\n${out}`)
          } else {
            const out = JSON.stringify(tree, null, 2)
            this.saveResult(step, out)
            this.log('info', `[XML 解析] ${out}`)
          }
        } catch (e) {
          this.log('error', `[XML 处理] 失败：${(e as Error).message}`)
          throw new Error(`XML 处理失败：${(e as Error).message}`)
        }
        return
      }
      case 'sys.random': {
        const type = String(step.params?.type || 'int')
        const min = Number(step.params?.min ?? 1)
        const max = Number(step.params?.max ?? 100)
        const lo = Math.min(min, max)
        const hi = Math.max(min, max)
        let out = ''
        try {
          if (type === 'float') {
            out = String(lo + Math.random() * (hi - lo))
          } else if (type === 'string') {
            const len = Math.max(1, Math.min(64, Number(step.params?.length) || 8))
            const pool = String(step.params?.chars || '').trim() || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
            const arr = pool.split('')
            let s = ''
            for (let i = 0; i < len; i++) s += arr[randomInt(arr.length)]
            out = s
          } else if (type === 'uuid') {
            out = randomUUID()
          } else {
            out = String(randomInt(lo, hi + 1))
          }
        } catch {
          // 极端参数下回退 Math.random
          out = type === 'float' ? String(lo + Math.random() * (hi - lo)) : String(Math.floor(lo + Math.random() * (hi - lo + 1)))
        }
        this.saveResult(step, out)
        this.log('info', `[随机数] ${type} => ${out}`)
        return
      }
      case 'sys.time': {
        const mode = String(step.params?.mode || 'format')
        const fmt = String(step.params?.format || 'YYYY-MM-DD HH:mm:ss')
        const d = new Date()
        let out = ''
        if (mode === 'timestamp') {
          out = String(Math.floor(d.getTime() / 1000))
        } else {
          const offsetSec = Number(step.params?.offsetSec || 0)
          const target = offsetSec ? new Date(d.getTime() + offsetSec * 1000) : d
          out = fmtDate(target, fmt)
        }
        this.saveResult(step, out)
        this.log('info', `[时间日期] ${out}`)
        return
      }
      case 'sys.string_tool': {
        const op = String(step.params?.op || 'md5')
        const input = String(step.params?.input ?? '')
        let out = input
        try {
          switch (op) {
            case 'md5': out = createHash('md5').update(input).digest('hex'); break
            case 'sha1': out = createHash('sha1').update(input).digest('hex'); break
            case 'sha256': out = createHash('sha256').update(input).digest('hex'); break
            case 'base64_encode': out = Buffer.from(input, 'utf8').toString('base64'); break
            case 'base64_decode': out = Buffer.from(input, 'base64').toString('utf8'); break
            case 'url_encode': out = encodeURIComponent(input); break
            case 'url_decode': out = decodeURIComponent(input); break
            case 'upper': out = input.toUpperCase(); break
            case 'lower': out = input.toLowerCase(); break
            case 'trim': out = input.trim(); break
            default: break
          }
        } catch (e) {
          this.log('error', `[字符串处理] 失败：${(e as Error).message}`)
          throw new Error(`字符串处理失败：${(e as Error).message}`)
        }
        this.saveResult(step, out)
        this.log('info', `[字符串处理] ${op} => ${out}`)
        return
      }
      case 'sys.array_tool': {
        const op = String(step.params?.op || 'dedup')
        const input = String(step.params?.input ?? '')
        let arr: any[]
        try {
          arr = JSON.parse(input)
        } catch (e) {
          throw new Error(`数组解析失败：${(e as Error).message}，请输入 JSON 数组文本`)
        }
        if (!Array.isArray(arr)) throw new Error('输入内容不是 JSON 数组')
        let out: any = arr
        switch (op) {
          case 'dedup': out = [...new Set(arr)]; break
          case 'sortAsc': out = [...arr].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)); break
          case 'sortDesc': out = [...arr].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); break
          case 'reverse': out = [...arr].reverse(); break
          case 'length': out = arr.length; break
          case 'compact': out = arr.filter(Boolean); break
          case 'deepCopy': out = JSON.parse(JSON.stringify(arr)); break
          default: break
        }
        const text = typeof out === 'number' ? String(out) : JSON.stringify(out)
        this.saveResult(step, text)
        this.log('info', `[数组操作] ${JSON.stringify(arr)} ${op} => ${text}`)
        return
      }

      // ---------- 数据库 ----------
      case 'sys.db_tool': {
        const op = String(p.op || 'query')
        const table = String(p.table || '').trim()
        assertTableName(table)
        const db: any = this.ctx.database
        const where = parseJsonArg(p.where, '条件')
        const data = parseJsonArg(p.data, '数据')
        let result: any
        try {
          if (op === 'create') {
            const rec = await db.create(table, data && typeof data === 'object' && !Array.isArray(data) ? data : {})
            result = { _inserted: rec || null }
          } else if (op === 'update') {
            const ok = await db.set(table, where, data && typeof data === 'object' && !Array.isArray(data) ? data : {})
            result = { _updated: !!ok }
          } else if (op === 'delete') {
            const n = await db.remove(table, where)
            result = { _count: n === undefined ? 0 : Number(n) }
          } else {
            const limit = Math.min(Math.max(1, Number(p.limit) || 50), 1000)
            result = await db.get(table, where, { limit })
          }
        } catch (e) {
          this.log('error', `[数据库操作] ${op} ${table} 失败：${(e as Error).message}`)
          throw new Error(`数据库操作失败：${(e as Error).message}`)
        }
        this.saveResult(step, result)
        this.log('info', `[数据库操作] ${op} ${table} 条件 ${JSON.stringify(where)} => ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`)
        return
      }

      // ---------- 文件操作 ----------
      case 'sys.fs_write': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        const content = String(p.content ?? '')
        try {
          if (p.mode === 'append') await fs.appendFile(abs, content, 'utf8')
          else await fs.writeFile(abs, content, 'utf8')
        } catch (e) {
          this.log('error', `[写入文件] ${abs} 失败：${(e as Error).message}`)
          throw new Error(`写入文件失败：${(e as Error).message}`)
        }
        this.saveResult(step, { path: abs, bytes: Buffer.byteLength(content, 'utf8') })
        this.log('info', `[写入文件] ${abs}（${p.mode === 'append' ? '追加' : '覆盖'} ${Buffer.byteLength(content, 'utf8')} 字节）`)
        return
      }
      case 'sys.fs_read': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        const buf = await fs.readFile(abs)
        if (buf.byteLength > MAX_HTTP_RESPONSE_BYTES) throw new Error(`文件超过 ${MAX_HTTP_RESPONSE_BYTES} 字节限制`)
        const text = buf.toString('utf8')
        this.saveResult(step, text)
        this.log('info', `[读取文件] ${abs} => ${truncate(text)}`)
        return
      }
      case 'sys.fs_delete': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        try {
          await fs.unlink(abs)
        } catch (e) {
          const err = e as NodeJS.ErrnoException
          if (err.code === 'ENOENT' && p.ignoreMissing) {
            this.saveResult(step, { deleted: false, reason: '文件不存在（已忽略）' })
            this.log('info', `[删除文件] ${abs} 不存在，已忽略`)
            return
          }
          throw new Error(`删除文件失败：${(e as Error).message}`)
        }
        this.saveResult(step, { deleted: true, path: abs })
        this.log('info', `[删除文件] ${abs}`)
        return
      }
      case 'sys.fs_mkdir': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        await fs.mkdir(abs, { recursive: true })
        this.saveResult(step, { path: abs })
        this.log('info', `[创建文件夹] ${abs}`)
        return
      }
      case 'sys.fs_rmdir': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        await fs.rm(abs, { recursive: true, force: true })
        this.saveResult(step, { path: abs, removed: true })
        this.log('info', `[删除文件夹] ${abs}`)
        return
      }
      case 'sys.fs_list': {
        const baseDir = await fsBaseDir(this.ctx, String(p.base || 'plugin'))
        const abs = resolveInside(baseDir, String(p.path || ''))
        const items = await fs.readdir(abs, { withFileTypes: true })
        const list = items.map((it) => ({ name: it.name, type: it.isDirectory() ? 'dir' : it.isFile() ? 'file' : 'other' }))
        this.saveResult(step, list)
        this.log('info', `[列出目录] ${abs} => ${list.length} 项`)
        return
      }

      // ---------- AI 服务 / Koishi 扩展 ----------
      case 'sys.ai_chat': {
        const result = await requestAiChat(p)
        this.saveResult(step, result)
        this.log('info', `[AI 对话请求] 模型 ${result.model} 完成：${truncate(result.content)}`)
        return
      }
      case 'sys.command_invoke': {
        const name = String(p.commandCustom || p.command || '').trim().replace(/^\/+/, '')
        if (!name || /\s/.test(name)) throw new Error('命令名不能为空且不能包含空格')
        const session = this.vars._session
        if (!session) throw new Error('触发已有命令需要消息事件上下文，请将任务触发方式设为事件，或在自定义命令回调中调用')
        const commander: any = (this.ctx as any).$commander
        const command = commander?.get?.(name)
        if (!command || typeof command.execute !== 'function') throw new Error(`未找到可执行的 Koishi 命令：${name}`)
        const args = commandArgs(String(p.arguments || ''))
        const argv = { name, args, options: {}, session, command }
        let result: any
        try {
          result = await command.execute(argv)
        } catch (e) {
          this.log('error', `[触发已有命令] /${name} 失败：${(e as Error).message}`)
          throw new Error(`触发命令失败：${(e as Error).message}`)
        }
        this.saveResult(step, result)
        this.log('info', `[触发已有命令] /${name}${args.length ? ` ${args.join(' ')}` : ''} => ${typeof result === 'object' ? JSON.stringify(result) : String(result ?? '')}`)
        return
      }
      case 'sys.command': {
        const name = String(p.command || '').trim().replace(/^\/+/, '')
        if (!name) throw new Error('命令名为空')
        const ctx = this.ctx
        if (registeredCommands.some((rc) => rc.ctx === ctx && rc.name === name)) {
          this.log('warn', `[注册命令] /${name} 已注册，跳过重复注册`)
          return
        }
        const description = String(p.description || '').trim()
        const argType = String(p.argType || 'open')
        const usage = String(p.usage || '').trim()
        const aliases = String(p.aliases || '').split(/[,，;；]/).map((a) => a.trim().replace(/^\/+/, '')).filter(Boolean)
        const children = JSON.parse(JSON.stringify(step.children || [])) as Step[]
        let def: any
        try {
          def = ctx.command(name, description)
          if (argType === 'declared' && usage) def.usage(`${name} ${usage}`)
          def.action((session: any) => {
            const raw = String(session?.content || '')
            const cmdContent = raw.replace(/^\s*\/*\S+\s*/, '')
            const args = raw.replace(/^\s*\/*\S+\s*/, '').split(/\s+/).filter(Boolean)
            const vars: Record<string, any> = {
              _session: session,
              cmdName: name,
              cmdContent,
              cmdArgs: JSON.stringify(args),
              content: raw,
              userId: session?.userId ?? '',
              groupId: session?.groupId ?? session?.channelId ?? '',
              nickname: session?.username ?? '',
              messageId: session?.messageId ?? '',
            }
            const runner = new Runner(ctx, this.task, {}, this.framework, this.debug)
            const log1 = this.ctx.logger('全自定义功能')
            void runner.runStepList(children, vars).catch((e) => log1.error(this.task.name, `命令 /${name} 执行失败：${(e as Error).message}`))
            return '已触发 ' + name
          })
          for (const a of aliases) def = def.alias(a)
        } catch (e) {
          this.log('error', `[注册命令] /${name} 注册失败：${(e as Error).message}`)
          throw new Error(`命令注册失败：${(e as Error).message}`)
        }
        registeredCommands.push({ ctx, name })
        this.log('info', `[注册命令] /${name} 已注册${aliases.length ? `（别名 ${aliases.map((a) => '/' + a).join('，')}）` : ''}`)
        return
      }

      default:
        this.log('warn', `未知动作磁贴 ${tile.id}`)
    }
  }

  // ---------- OneBot 接口 ----------
  private async runOneBot(tile: TileDef, step: Step): Promise<void> {
    const p = messageForTile(tile.id, this.resolveParams(step.params))
    const apiParams: Record<string, any> = {}
    for (const key of tile.apiParams || []) {
      const raw = p[key]
      if (raw === undefined || raw === null || raw === '') continue
      // number 型参数转数字
      const spec = tile.params.find((pp) => pp.key === key)
      if (spec?.type === 'number') {
        const num = Number(raw)
        apiParams[key] = isNaN(num) ? raw : num
      } else {
        apiParams[key] = raw
      }
    }
    const bot = findOneBotBot(this.ctx)
    if (!bot) {
      this.log('error', `[${tile.label}] 未找到可用机器人`)
      throw new Error('未找到可用的机器人')
    }
    this.log('info', `[${tile.label}] 调用 ${tile.api} ${JSON.stringify(apiParams)}（框架：${frameworkLabel(detectFramework(bot, this.framework))}）`)
    let result: any
    try {
      result = await callOneBot(bot, tile.api!, apiParams, this.framework)
    } catch (error) {
      if (tile.id !== 'ob.ocr_image' || String(p.aiFallback || 'off') !== 'on') throw error
      this.log('warn', `[图片OCR] OneBot OCR 失败，改用 AI 视觉兜底：${(error as Error).message}`)
      result = await requestAiOcr(p)
    }
    const resultVar = String(p.resultVar || '').trim()
    if (resultVar) {
      this.vars[resultVar] = result === undefined || result === null ? '' : (typeof result === 'object' ? JSON.stringify(result) : String(result))
      if (resultVar !== 'lastResult') this.vars.lastResult = this.vars[resultVar]
    }
    this.log('info', `[${tile.label}] 返回 ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`)
  }

  // 参数值解析：文本型模板化，布尔型保留
  private resolveParams(params: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
    for (const key of Object.keys(params || {})) {
      const v = params[key]
      out[key] = typeof v === 'string' ? template(v, this.vars) : v
    }
    return out
  }

  // 工具磁贴结果保存：写入 resultVar（留空则不保存），并同步 lastResult
  private saveResult(step: Step, result: any): void {
    const resultVar = String(step.params?.resultVar || '').trim()
    if (!resultVar) return
    const text = result === null || result === undefined ? '' : (typeof result === 'object' ? JSON.stringify(result) : String(result))
    this.vars[resultVar] = text
    this.vars.lastResult = text
  }
}

// 便捷入口
export function runTask(ctx: Context, task: TaskRecord, vars: Record<string, any> = {}, onStatus?: RunOptions['onStatus'], framework: OneBotFramework = 'auto', debug = false): { runner: Runner, promise: Promise<RunResult> } {
  const runner = new Runner(ctx, task, { vars, onStatus }, framework, debug)
  return { runner, promise: runner.run() }
}

// 校验二维步骤中的必填参数（用于保存与前端实时校验提示）
export function validateSteps(steps: Step[]): string[] {
  const errors: string[] = []
  const walk = (list: Step[], prefix: string, inCond = false) => {
    for (const step of list) {
      const tile = TILE_MAP[step.tile]
      if (!tile) { errors.push(`${prefix}存在未知磁贴`); continue }
      for (const param of tile.params) {
        if (param.required) {
          const v = step.params?.[param.key]
          if (v === undefined || v === null || v === '') errors.push(`${prefix}「${tile.label}」缺少必填参数「${param.label}」`)
        }
      }
      // 条件规则区：比较运算符必填；需要对比值的运算符必须填写对比值
      if (inCond) {
        const op = String(step.params?.compareOp || '')
        if (!op) errors.push(`${prefix}「${tile.label}」缺少比较运算符`)
        if (OP_NEEDS_VALUE.has(op) && String(step.params?.compareValue ?? '').trim() === '') {
          errors.push(`${prefix}「${tile.label}」该比较运算符需要填写对比值`)
        }
      }
      walk(step.children || [], `${prefix}${tile.label} › `)
      walk(step.elseChildren || [], `${prefix}${tile.label} › `)
      walk(step.conditionSteps || [], `${prefix}${tile.label} › 条件规则 › `, true)
    }
  }
  walk(steps, '')
  return errors
}