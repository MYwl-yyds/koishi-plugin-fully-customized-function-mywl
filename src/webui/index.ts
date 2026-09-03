// ============ 全自定义功能插件 - WebUI 后端 ============
import { Context } from 'koishi'
import { resolve } from 'path'
import { DataService } from '@koishijs/plugin-console'
import { Snapshot, TaskRecord, Step, EVENT_OPTIONS } from '../types'
import { TILES } from '../tiles'
import { validateSteps } from '../engine'
import { validateCron } from '../scheduler'
import { Store } from '../store'
import { Scheduler } from '../scheduler'

// 校验任务数据（保存前）
async function validateTask(svc: { store: Store }, data: any): Promise<string[]> {
  const errors: string[] = []
  if (!data.name || !String(data.name).trim()) errors.push('任务名称不能为空')
  const trigger = data.trigger || 'manual'
  if (trigger === 'cron') {
    if (!data.cron || !validateCron(data.cron)) errors.push('cron 表达式无效（需为 5 段，如 */5 * * * *）')
  } else if (trigger === 'interval') {
    const v = Number(data.interval)
    if (!v || isNaN(v) || v < 5) errors.push('间隔时间需为不小于 5 的整数（秒）')
  } else if (trigger === 'event') {
    if (!EVENT_OPTIONS.some((e) => e.value === data.event)) errors.push('事件类型无效')
  }
  // 步骤必填参数校验
  const stepErrors = validateSteps((data.steps || []) as Step[])
  errors.push(...stepErrors.slice(0, 20))
  // 总步骤数上限保护
  let count = 0
  const walk = (list: Step[]) => {
    for (const s of list || []) {
      count++
      walk(s.children || [])
      walk(s.elseChildren || [])
      walk(s.conditionSteps || [])
    }
  }
  walk(data.steps || [])
  if (count > 500) errors.push('步骤总数超过上限（500）')
  if (errors.length > 20) errors.length = 20
  return errors
}

export async function buildSnapshot(ctx: Context, store: Store, scheduler: Scheduler): Promise<Snapshot> {
  const [tasks, logs, stats] = await Promise.all([
    store.taskList(),
    store.logList(200),
    store.logStats(),
  ])
  const running: Record<number, boolean> = {}
  for (const id of scheduler.runs.keys()) running[id] = true
  return {
    tasks,
    // 日志只下发摘要，明细按需通过 log-detail 获取（减小快照体积、加快加载）
    logs: logs.map(({ detail, ...rest }) => rest as any),
    tiles: TILES,
    events: EVENT_OPTIONS,
    running,
    stats: {
      totalTasks: tasks.length,
      enabledTasks: tasks.filter((t) => t.enabled).length,
      runningCount: scheduler.runs.size,
      todayRuns: stats.todayRuns,
      successRuns: stats.successRuns,
    },
  }
}

export function applyWebUI(ctx: Context, store: Store, scheduler: Scheduler, log: any) {
  const consoleService = (ctx as any).console
  if (!consoleService) return

  const svc = { ctx, store }

  class FcData extends DataService<Snapshot> {
    constructor(cctx: any) {
      super(cctx, 'mywl-auto' as any)
    }
    async get(): Promise<Snapshot> {
      return buildSnapshot(ctx, store, scheduler)
    }
  }
  ctx.plugin(FcData as any)

  interface MutateResult { ok: boolean; error?: string; snapshot?: Snapshot; saved?: TaskRecord }

  async function handleMutate(action: string, data: any): Promise<MutateResult> {
    try {
      let saved: TaskRecord | undefined
      switch (action) {
        case 'task.save': {
          const errors = await validateTask(svc, data)
          if (errors.length > 0) return { ok: false, error: '保存失败：\n' + errors.join('\n') }
          saved = await store.taskSave(data)
          await scheduler.reschedule()
          log.info(`任务「${data.name}」已保存`)
          break
        }
        case 'task.delete': {
          const task = await store.taskGet(Number(data.id))
          await store.taskRemove(Number(data.id))
          if (scheduler.runs.has(Number(data.id))) scheduler.stopTask(Number(data.id))
          await scheduler.reschedule()
          log.info(`任务「${task?.name || data.id}」已删除`)
          break
        }
        case 'task.toggle': {
          await store.taskToggle(Number(data.id), !!data.enabled)
          await scheduler.reschedule()
          break
        }
        case 'task.duplicate': {
          const src = await store.taskGet(Number(data.id))
          if (!src) return { ok: false, error: '任务不存在' }
          const { id: _srcId, ...rest } = src
          const copy: Omit<TaskRecord, 'id'> = {
            ...rest,
            name: `${src.name}（副本）`,
            enabled: false,
            steps: JSON.parse(JSON.stringify(src.steps || [])) as Step[],
            runCount: 0,
            lastRunAt: '',
            lastRunStatus: '',
          }
          await store.taskSave(copy as any)
          await scheduler.reschedule()
          log.info(`任务「${src.name}」已复制`)
          break
        }
        case 'task.run': {
          const task = await store.taskGet(Number(data.id))
          if (!task) return { ok: false, error: '任务不存在' }
          const res = await scheduler.runManual(task, (data.vars || {}) as Record<string, any>)
          return res.ok ? { ok: true } : { ok: false, error: res.error || '任务执行出错' }
        }
        case 'task.stop': {
          scheduler.stopTask(Number(data.id))
          break
        }
        case 'log.clear':
          await store.logClear()
          break
        default:
          return { ok: false, error: `未知操作 ${action}` }
      }
      return { ok: true, snapshot: await buildSnapshot(ctx, store, scheduler), saved }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  consoleService.addListener('mywl-auto/mutate', async function (this: any, payload: any) {
    const res = await handleMutate(payload.action, payload.data || {})
    if (res?.ok && res.snapshot) {
      await consoleService.broadcast('patch', { key: 'mywl-auto', value: res.snapshot })
    }
    return res
  })

  consoleService.addListener('mywl-auto/refresh', async () => {
    const snapshot = await buildSnapshot(ctx, store, scheduler)
    await consoleService.broadcast('patch', { key: 'mywl-auto', value: snapshot })
    return snapshot
  })

  // 按需获取单条日志的执行明细（快照不下发 detail，减小体积）
  consoleService.addListener('mywl-auto/log-detail', async (payload: any) => {
    try {
      const row = await store.logGet(Number(payload?.id))
      if (!row) return { ok: false, error: '日志不存在' }
      return { ok: true, detail: row.detail || '[]' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 运行状态变化时推送最新快照
  scheduler.onChange(async () => {
    try {
      const snapshot = await buildSnapshot(ctx, store, scheduler)
      await consoleService.broadcast('patch', { key: 'mywl-auto', value: snapshot })
    } catch { /* ignore */ }
  })

  // 供前端生成新步骤（客户端用磁贴定义本地生成，无需服务端）
  consoleService.addEntry({
    dev: resolve(__dirname, '../../client/index.ts'),
    prod: resolve(__dirname, '../../dist'),
  })
}