import { Schema } from 'koishi'

export const name = 'quanmian-ziyou-gongneng'

// 插件 Schema 保持极简，其余功能全部在控制台 WebUI 中配置
export interface PluginConfig {
  enable: boolean
  logRetentionDays: number
  // OneBot 框架适配：auto 自动检测，或手动指定为 LLOneBot（LLBot）/ NapCat
  onebotFramework: 'auto' | 'llbot' | 'napcat'
  // 任务执行调试日志开关
  debugLog: boolean
}

export const Config: Schema<PluginConfig> = Schema.object({
  enable: Schema.boolean()
    .default(true)
    .description('插件总开关'),
  logRetentionDays: Schema.number()
    .min(1)
    .max(90)
    .default(7)
    .description('执行日志保留天数（自动清理）'),
  onebotFramework: Schema.union(['auto', 'llbot', 'napcat'])
    .default('auto')
    .description('OneBot 框架适配：auto 自动识别；也可手动指定 LLOneBot（LLBot）或 NapCat，插件会对接口参数与 action 命名做兼容处理'),
  debugLog: Schema.boolean()
    .default(false)
    .description('任务调试日志：开启后任务执行时每一步都会输出详细日志（进入/退出节点、参数值、中间结果、判断结果、错误信息）；关闭后仅输出任务中显式配置的「日志输出 / 读取变量」与最终结果（信息/警告级静默，仅保留错误与失败摘要）'),
}).description('全自定义功能自动化（任务编排请在控制台左侧「全自定义功能」页面操作）')