// ============ 全自定义功能插件 - 数据存储 ============
import { Context } from 'koishi'
import { TaskRecord, LogRecord } from './types'

let modelsInited = false
export function initModels(ctx: Context): void {
  if (modelsInited) return
  modelsInited = true
  ctx.model.extend('mywl_ftask' as any, {
    id: 'unsigned',
    name: 'string',
    description: 'text',
    enabled: 'boolean',
    trigger: 'string',
    cron: 'string',
    interval: 'integer',
    event: 'string',
    steps: 'json',
    runCount: 'integer',
    lastRunAt: 'string',
    lastRunStatus: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  }, { autoInc: true })

  ctx.model.extend('mywl_flog' as any, {
    id: 'unsigned',
    taskId: 'integer',
    taskName: 'string',
    status: 'string',
    message: 'text',
    detail: 'text',
    duration: 'integer',
    createdAt: 'string',
    finishedAt: 'string',
  }, { autoInc: true })
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export class Store {
  private db: any
  // 执行统计内存缓存（避免快照每次全表扫描）
  private statCache = { day: '', todayRuns: 0, successRuns: 0, loaded: false }
  // 任务列表内存缓存（写入类操作失效；WebUI 快照构建高频读取时避免反复查库）
  private taskCache: TaskRecord[] | null = null

  constructor(ctx: Context) {
    this.db = ctx.database
  }

  // ---------- 任务 ----------
  async taskList(): Promise<TaskRecord[]> {
    if (this.taskCache) return this.taskCache
    const rows = await this.db.get('mywl_ftask', {}, { sort: { updatedAt: 'desc' } })
    this.taskCache = rows
    return rows
  }

  // 任务数据变更后失效缓存
  private invalidateTasks(): void {
    this.taskCache = null
  }

  async taskGet(id: number): Promise<TaskRecord | undefined> {
    const rows = await this.db.get('mywl_ftask', { id })
    return rows[0]
  }

  async taskSave(data: Partial<TaskRecord> & { name: string, trigger: string, steps: any[] }): Promise<TaskRecord> {
    const now = nowStr()
    if (data.id) {
      const { id, ...patch } = data as any
      await this.db.set('mywl_ftask', { id: data.id }, { ...patch, updatedAt: now })
      const rows = await this.db.get('mywl_ftask', { id: data.id })
      this.invalidateTasks()
      return rows[0]
    }
    const row = await this.db.create('mywl_ftask', {
      name: data.name,
      description: data.description || '',
      enabled: data.enabled !== false,
      trigger: data.trigger || 'manual',
      cron: data.cron || '',
      interval: data.interval || 60,
      event: data.event || '',
      steps: data.steps || [],
      runCount: 0,
      lastRunAt: '',
      lastRunStatus: '',
      createdAt: now,
      updatedAt: now,
    })
    return Array.isArray(row) ? row[0] : row
  }

  async taskRemove(id: number): Promise<void> {
    await this.db.remove('mywl_ftask', { id })
    this.invalidateTasks()
  }

  async taskToggle(id: number, enabled: boolean): Promise<void> {
    await this.db.set('mywl_ftask', { id }, { enabled, updatedAt: nowStr() })
    this.invalidateTasks()
  }

  // 记录一次运行结束状态
  async taskMarkRun(id: number, status: string): Promise<void> {
    const [task] = await this.db.get('mywl_ftask', { id })
    if (!task) return
    await this.db.set('mywl_ftask', { id }, {
      runCount: (task.runCount || 0) + 1,
      lastRunAt: nowStr(),
      lastRunStatus: status,
      updatedAt: nowStr(),
    })
    this.invalidateTasks()
  }

  // ---------- 执行日志 ----------
  async logCreate(entry: Partial<LogRecord>): Promise<LogRecord> {
    const status = entry.status || 'running'
    const row = await this.db.create('mywl_flog', {
      taskId: entry.taskId || 0,
      taskName: entry.taskName || '',
      status,
      message: entry.message || '',
      detail: entry.detail || '[]',
      duration: entry.duration || 0,
      createdAt: nowStr(),
      finishedAt: entry.finishedAt || '',
    })
    const rec = Array.isArray(row) ? row[0] : row
    this.touchStat(status)
    return rec
  }

  async logUpdate(id: number, patch: Partial<LogRecord>): Promise<void> {
    await this.db.set('mywl_flog', { id }, patch)
    if (patch.status === 'success') this.touchStat('success')
  }

  async logGet(id: number): Promise<LogRecord | undefined> {
    const rows = await this.db.get('mywl_flog', { id })
    return rows[0]
  }

  async logList(limit = 200): Promise<LogRecord[]> {
    return this.db.get('mywl_flog', {}, { sort: { createdAt: 'desc' }, limit })
  }

  async logClear(): Promise<void> {
    await this.db.remove('mywl_flog', {})
    this.statCache.todayRuns = 0
    this.statCache.successRuns = 0
    const today = new Date().toISOString().slice(0, 10)
    this.statCache.day = today
    this.statCache.loaded = true
  }

  // 清理保留期外的日志并限制总量
  async logCleanup(retentionDays: number): Promise<void> {
    try {
      const days = Math.max(1, retentionDays || 7)
      const cutoff = new Date(Date.now() - days * 86400000)
      const cut = cutoff.toISOString().slice(0, 10)
      // 只按日期字符串前缀清理
      await this.db.remove('mywl_flog', (row) => row.createdAt < cut)
      const all: LogRecord[] = await this.db.get('mywl_flog', {}, { sort: { createdAt: 'desc' } })
      if (all.length > 2000) {
        const keepIds = all.slice(2000).map((l) => l.id)
        for (const id of keepIds) await this.db.remove('mywl_flog', { id })
      }
      // 内存统计失效，下次读取时重建
      this.statCache.loaded = false
    } catch { /* 忽略清理错误 */ }
  }

  // 增量更新统计缓存（今日/成功次数）
  private touchStat(status: string) {
    const today = new Date().toISOString().slice(0, 10)
    this.statCache.day = today
    this.statCache.todayRuns++
    if (status === 'success') this.statCache.successRuns++
  }

  // 今日/成功统计
  async logStats(): Promise<{ todayRuns: number, successRuns: number }> {
    const today = new Date().toISOString().slice(0, 10)
    if (!this.statCache.loaded || this.statCache.day !== today) {
      // 首次使用或跨天 / 清理后：全表重建一次
      const all: LogRecord[] = await this.db.get('mywl_flog', {})
      this.statCache.todayRuns = all.filter((l) => String(l.createdAt).startsWith(today)).length
      this.statCache.successRuns = all.filter((l) => l.status === 'success').length
      this.statCache.day = today
      this.statCache.loaded = true
    }
    return { todayRuns: this.statCache.todayRuns, successRuns: this.statCache.successRuns }
  }
}