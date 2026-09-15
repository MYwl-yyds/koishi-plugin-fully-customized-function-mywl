// ============ 全自定义功能插件 - 类型定义 ============

// 任务触发方式
export type TriggerType = 'manual' | 'cron' | 'interval' | 'event'

// 任务记录（数据库表 mywl_ftask）
export interface TaskRecord {
  id: number
  name: string
  description: string
  enabled: boolean
  trigger: TriggerType
  cron: string
  interval: number          // 秒
  event: string             // 事件触发名，如 message.group
  steps: Step[]             // 顶层步骤列表
  runCount: number
  lastRunAt: string
  lastRunStatus: string     // success / failed / stopped
  createdAt: string
  updatedAt: string
}

// 事件触发列表（供 WebUI 下拉选择）
export const EVENT_OPTIONS: { label: string, value: string }[] = [
  { label: '群消息', value: 'message.group' },
  { label: '私聊消息', value: 'message.private' },
  { label: '有人入群', value: 'group-member-added' },
  { label: '有人退群', value: 'group-member-removed' },
  { label: '群消息撤回', value: 'group-recall' },
]

// 步骤
export interface Step {
  id: string
  tile: string            // 磁贴 id
  enabled: boolean
  params: Record<string, any>
  children?: Step[]       // 循环体 / if 的 then 分支
  elseChildren?: Step[]   // if 的 else 分支
  conditionSteps?: Step[] // if 的「条件取值」磁贴（先执行，结果可被条件表达式引用）
}

// 磁贴参数定义
export type ParamType = 'text' | 'textarea' | 'number' | 'select' | 'boolean'

export interface TileParam {
  key: string
  label: string
  type: ParamType
  default?: any
  required?: boolean
  placeholder?: string
  hint?: string
  options?: { label: string, value: string }[]
  dynamicOptions?: 'commands'
  // number 类型专用
  min?: number
  max?: number
}

export type TileKind = 'onebot' | 'control' | 'action'

// OneBot 接口返回数据的字段说明（供前端条件区「取值字段」提示，依据 OneBot v11 文档）
export interface ReturnField {
  field: string      // 字段名（JSON 路径中的一段）
  type: string       // 类型：number / string / boolean / object / array / array<object>
  meaning: string    // 含义说明
  source?: string    // 数据来源（接口/原始数据），一般为空即来自本接口返回
}

export interface TileDef {
  id: string
  label: string
  category: string        // onebot 分类 or system
  kind: TileKind
  description: string
  params: TileParam[]
  // OneBot 接口名（kind=onebot）
  api?: string
  // 参与 OneBot 调用的输出参数顺序（其余如结果变量为运行期剥离）
  apiParams?: string[]
  color?: string
  // 该接口返回数据的全部可用字段（kind=onebot 时有值；发送/管理类为 [] 或无）
  returns?: ReturnField[]
  // 一键填入的示例参数（供前端「填入示例」按钮使用）
  examples?: Record<string, any>
  // 示例说明文字（简要展示功效）
  exampleNote?: string
}

// 执行日志（数据库表 mywl_flog）
export interface LogRecord {
  id: number
  taskId: number
  taskName: string
  status: string          // running / success / failed / stopped
  message: string
  detail: string          // JSON 数组，逐条执行记录
  duration: number        // 毫秒
  createdAt: string
  finishedAt: string
}

// WebUI 快照
export interface Snapshot {
  tasks: TaskRecord[]
  logs: LogRecord[]
  tiles: TileDef[]
  events: { label: string, value: string }[]
  commands: { label: string, value: string, description?: string }[]
  running: Record<number, boolean>
  stats: {
    totalTasks: number
    enabledTasks: number
    runningCount: number
    todayRuns: number
    successRuns: number
  }
}

export interface MutateResponse {
  ok: boolean
  error?: string
  snapshot?: Snapshot
}