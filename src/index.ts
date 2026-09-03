import { Context } from 'koishi'
import { Config } from './config'
import type { PluginConfig } from './config'
import { initModels, Store } from './store'
import { Scheduler } from './scheduler'
import { applyWebUI } from './webui'
import { logger } from './utils'

export { Config, name } from './config'
export type { PluginConfig } from './config'
export { TILES, ONEBOT_CATEGORIES, SYSTEM_CATEGORIES } from './tiles'
export { validateCron, parseCron } from './scheduler'

export const using = ['database'] as const

export function apply(ctx: Context, config: PluginConfig) {
  const log = logger(ctx)
  if (config.enable === false) {
    log.info('全自定义功能已关闭')
    return
  }

  initModels(ctx)
  const store = new Store(ctx)
  const scheduler = new Scheduler(ctx, store, config.onebotFramework || 'auto', !!config.debugLog)

  // 启动调度（定时 / 间隔 / 事件）
  scheduler.start()

  // 定期清理过期执行日志
  ctx.setInterval(async () => {
    await store.logCleanup(config.logRetentionDays ?? 7)
  }, 10 * 60 * 1000)

  // WebUI（任务编排面板），仅安装了 console 插件时启用
  ctx.using(['console'], (cctx) => {
    applyWebUI(cctx, store, scheduler, log)
  })

  ctx.on('dispose', () => {
    scheduler.dispose()
  })

  log.info('全自定义功能插件已启动（磁贴任务编排已就绪）')
}