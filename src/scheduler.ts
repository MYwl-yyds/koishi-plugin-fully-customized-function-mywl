// ============ 全自定义功能插件 - 任务调度器 ============
// 支持 cron 表达式、定时间隔、事件监听与手动触发
import { Context, Session } from 'koishi'
import { TaskRecord } from './types'
import { runTask, Runner, OneBotFramework } from './engine'
import { Store } from './store'
import { logger } from './utils'

interface CronField { values: Set<number>, all: boolean }

// 解析 cron 字段：支持 * ? 数字 a-b a/b a,b,c
function parseField(field: string, min: number, max: number): CronField {
  const out: CronField = { values: new Set(), all: false }
  const parts = String(field).trim().split(',')
  for (const part of parts) {
    const p = part.replace('?', '*')
    if (p === '*') { out.all = true; continue }
    const stepM = p.match(/^(\d+|\*)\/(\d+)$/)
    if (stepM) {
      const step = Math.max(1, parseInt(stepM[2], 10))
      const from = stepM[1] === '*' ? min : parseInt(stepM[1], 10)
      for (let v = from; v <= max; v += step) if (v >= min) out.values.add(v)
      continue
    }
    const rangeM = p.match(/^(\d+)-(\d+)$/)
    if (rangeM) {
      for (let v = parseInt(rangeM[1], 10); v <= parseInt(rangeM[2], 10); v++) {
        if (v >= min && v <= max) out.values.add(v)
      }
      continue
    }
    if (/^\d+$/.test(p)) {
      const v = parseInt(p, 10)
      if (v >= min && v <= max) out.values.add(v)
    }
    // 非法片段忽略
  }
  return out
}

export interface Cron {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

export function parseCron(expr: string): Cron | null {
  const f = String(expr || '').trim().split(/\s+/)
  if (f.length !== 5) return null
  return {
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dow: parseField(f[4], 0, 6),
  }
}

function cronMatch(cron: Cron, d: Date): boolean {
  const hit = (c: CronField, v: number) => c.all || c.values.has(v)
  return hit(cron.minute, d.getMinutes()) && hit(cron.hour, d.getHours())
    && hit(cron.dom, d.getDate()) && hit(cron.month, d.getMonth() + 1) && hit(cron.dow, d.getDay())
}

export function validateCron(expr: string): boolean {
  return parseCron(expr) !== null
}

function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
}

// 从 session 提取事件变量
function sessionVars(session: Session): Record<string, any> {
  const extra: any = (session as any).extra || {}
  const vars: Record<string, any> = {
    _session: session,
    userId: String(session.userId ?? extra.user_id ?? extra.operator_id ?? ''),
    nickname: String(session.author?.name ?? extra.nickname ?? ''),
    messageId: String(session.messageId ?? extra.message_id ?? ''),
  }
  const guildId = session.guildId ?? session.channelId ?? extra.group_id
  if (guildId) vars.groupId = String(guildId)
  if (session.content != null) vars.content = session.content
  if (extra.operator_id != null) vars.operatorId = String(extra.operator_id)
  if (extra.user_id != null && !vars.userId) vars.userId = String(extra.user_id)
  return vars
}

interface TaskInfo { cron?: Cron, lastKey?: string, nextAt?: number }

export class Scheduler {
  private participants: Map<string, TaskInfo> = new Map()
  private tickHandle: any
  private tickHandle2: any
  private eventOff: (() => void)[] = []

  // 内存缓存：任务列表与「事件 -> 任务」映射（由 reschedule 重建，避免高频查库）
  private tasksCache: TaskRecord[] = []
  private eventCache = new Map<string, TaskRecord[]>()
  private cacheReady = false

  public runs: Map<number, Runner> = new Map()
  private listeners = new Set<() => void>()

  constructor(private ctx: Context, private store: Store, private framework: OneBotFramework = 'auto', private debugLog = false) {}

  // 运行状态变化通知（WebUI 据此更新 running 快照）
  onChange(fn: () => void) { this.listeners.add(fn) }
  private emit() { for (const fn of this.listeners) fn() }

  isRunning(taskId: number): boolean { return this.runs.has(taskId) }

  start() {
    if (this.tickHandle) return
    this.reschedule()
    this.tickHandle = this.ctx.setInterval(() => { this.tick() }, 5000)
    // 有任务正在运行时每 15s 推送一次运行状态（WebUI 「运行中」标记保持实时，避免整页轮询）
    this.tickHandle2 = this.ctx.setInterval(() => { if (this.runs.size) this.emit() }, 15000)
    this.registerEvents()
  }

  dispose() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle as any)
      this.tickHandle = null
    }
    if (this.tickHandle2) {
      clearInterval(this.tickHandle2 as any)
      this.tickHandle2 = null
    }
    for (const off of this.eventOff) off()
    this.eventOff = []
    for (const runner of this.runs.values()) runner.stop()
    this.runs.clear()
    this.participants.clear()
    this.tasksCache = []
    this.eventCache.clear()
    this.cacheReady = false
  }

  // 根据数据库任务重建缓存与定时参与表
  async reschedule(): Promise<void> {
    const tasks = await this.store.taskList()
    this.tasksCache = tasks
    this.eventCache.clear()
    for (const task of tasks) {
      if (!task.enabled || task.trigger !== 'event' || !task.event) continue
      const list = this.eventCache.get(task.event) || []
      list.push(task)
      this.eventCache.set(task.event, list)
    }
    this.cacheReady = true

    const participantIds = new Set<number>()
    for (const task of tasks) {
      if (!task.enabled) continue
      participantIds.add(task.id)
      const info = this.participants.get(String(task.id))
      if (info) {
        // 任务配置可能已变更：重置 cron 与下次触发时间
        if (task.trigger === 'cron' && task.cron) {
          info.cron = parseCron(task.cron) || undefined
          info.lastKey = undefined
        }
        info.nextAt = undefined
        if (task.trigger !== 'cron') info.cron = undefined
      } else {
        this.participants.set(String(task.id), {})
      }
    }
    for (const key of [...this.participants.keys()]) {
      if (!participantIds.has(Number(key))) this.participants.delete(key)
    }
  }

  private async tick() {
    if (!this.cacheReady) return
    const now = Date.now()
    const d = new Date(now)
    const key = minuteKey(d)
    const tasks = this.tasksCache
    for (const task of tasks) {
      if (!task.enabled || this.runs.has(task.id)) continue
      const info = this.participants.get(String(task.id))
      if (!info) continue
      if (task.trigger === 'cron' && task.cron) {
        if (!info.cron) info.cron = parseCron(task.cron) || undefined
        if (!info.cron) continue
        const matched = cronMatch(info.cron, d)
        if (info.lastKey === undefined) {
          // 首次启动：对齐当前分钟，避免立即重复触发
          info.lastKey = key
          continue
        }
        if (matched && info.lastKey !== key) {
          info.lastKey = key
          this.launch(task, {}).catch(() => {})
        }
      } else if (task.trigger === 'interval') {
        const intervalMs = Math.max(5, Number(task.interval) || 60) * 1000
        if (!info.nextAt || now >= info.nextAt) {
          info.nextAt = now + intervalMs
          this.launch(task, {}).catch(() => {})
        }
      }
    }
  }

  // 注册事件监听
  private registerEvents() {
    const watch = (event: string, extract: (s: Session) => Record<string, any>) => {
      const off = this.ctx.on(event as any, (session: Session) => {
        this.runForEvent(event, extract(session)).catch(() => {})
      })
      this.eventOff.push(off)
    }
    watch('message', (s) => sessionVars(s))
    // 成员变动与撤回属于 bot 级事件：对每个机器人注册并区分群号
    const botLevel = (event: string) => {
      this.ctx.bots.forEach((bot: any) => {
        if (!bot || typeof bot.on !== 'function') return
        const off = bot.on(event as any, (session: Session) => {
          this.runForEvent(event, sessionVars(session)).catch(() => {})
        })
        this.eventOff.push(off)
      })
    }
    botLevel('group-member-added')
    botLevel('group-member-removed')
    botLevel('group-recall')
  }

  private async runForEvent(firedEvent: string, vars: Record<string, any>) {
    if (!this.cacheReady) return
    let candidates: TaskRecord[]
    if (firedEvent === 'message') {
      // message 事件分流为群聊 / 私聊
      const isGroup = !!vars.groupId && vars.groupId !== vars.userId
      const target = isGroup ? 'message.group' : 'message.private'
      candidates = [...(this.eventCache.get('message') || []), ...(this.eventCache.get(target) || [])]
    } else {
      candidates = this.eventCache.get(firedEvent) || []
    }
    for (const task of candidates) {
      if (this.runs.has(task.id)) continue
      this.launch(task, vars).catch(() => {})
    }
  }

  // 手动触发
  async runManual(task: TaskRecord, vars: Record<string, any> = {}): Promise<{ ok: boolean, error?: string }> {
    if (this.runs.has(task.id)) return { ok: false, error: '该任务正在运行中，请等待完成或先停止' }
    const res = await this.launch(task, vars)
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  }

  stopTask(taskId: number): boolean {
    const runner = this.runs.get(taskId)
    if (!runner) return false
    runner.stop()
    return true
  }

  // 启动一次任务执行
  private async launch(task: TaskRecord, vars: Record<string, any>): Promise<{ ok: boolean, error?: string }> {
    if (this.runs.has(task.id)) return { ok: false, error: '任务已在运行' }
    const id = task.id
    const log = logger(this.ctx)
    const startedAt = Date.now()
    let logId = 0
    try {
      const row = await this.store.logCreate({ taskId: id, taskName: task.name, status: 'running' })
      logId = row.id
    } catch { /* 日志写入失败不阻塞执行 */ }
    const { runner, promise } = runTask(this.ctx, task, vars, undefined, this.framework, this.debugLog)
    this.runs.set(id, runner)
    this.emit()
    log.info(`任务「${task.name}」开始执行`)
    const result = await promise
    this.runs.delete(id)
    try {
      const patch = {
        status: result.status,
        message: result.message,
        detail: JSON.stringify(result.entries),
        duration: Date.now() - startedAt,
        finishedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }
      if (logId) await this.store.logUpdate(logId, patch)
      else await this.store.logCreate({ taskId: id, taskName: task.name, ...patch })
      await this.store.taskMarkRun(id, result.status)
    } catch { /* ignore */ }
    log.info(`任务「${task.name}」执行结束（${result.status}）：${result.message}`)
    this.emit()
    return { ok: result.ok, error: result.message }
  }
}