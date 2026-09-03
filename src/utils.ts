// ============ 全自定义功能插件 - 工具函数 ============
import { Context } from 'koishi'

export function logger(ctx: Context) {
  return ctx.logger('全自定义功能')
}

// 生成步骤唯一 id
let seed = 0
export function genId(): string {
  return `${Date.now().toString(36)}_${(++seed).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}