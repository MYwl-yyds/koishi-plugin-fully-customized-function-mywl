// ============ 全自定义功能插件 - 前端步骤树操作工具 ============
import { ref, reactive } from 'vue'

export interface TileParam {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean'
  default?: any
  required?: boolean
  placeholder?: string
  hint?: string
  options?: { label: string, value: string }[]
  min?: number
  max?: number
}

// OneBot 接口返回数据的字段说明（供条件区「取值字段」提示，与服务端 tiles.ts 保持一致）
export interface ReturnField {
  field: string      // 字段名（JSON 路径中的一段）
  type: string       // 类型：number / string / boolean / object / array / array<object>
  meaning: string    // 含义说明
  source?: string    // 数据来源
}

export interface TileDef {
  id: string
  label: string
  category: string
  kind: 'onebot' | 'control' | 'action'
  description: string
  params: TileParam[]
  api?: string
  apiParams?: string[]
  color?: string
  returns?: ReturnField[]
  examples?: Record<string, any>
  exampleNote?: string
}

export interface Step {
  id: string
  tile: string
  enabled: boolean
  params: Record<string, any>
  children?: Step[]
  elseChildren?: Step[]
  conditionSteps?: Step[]
}

// 当前正在编辑的任务步骤树（根层）
export const rootSteps = ref<Step[]>([])

// 多选集合（跨组件共享）
export const stepSelection = reactive<{ ids: Set<string> }>({ ids: new Set() })

// 右键上下文菜单状态（Tasks 页面统一渲染）
export const ctxMenu = reactive<{ open: boolean, x: number, y: number, stepId: string }>({
  open: false, x: 0, y: 0, stepId: '',
})
export function openCtxMenu(e: MouseEvent, stepId: string): void {
  const pad = 8
  const w = 180
  const h = 230
  ctxMenu.x = Math.min(e.clientX, window.innerWidth - w - pad)
  ctxMenu.y = Math.min(e.clientY, window.innerHeight - h - pad)
  ctxMenu.stepId = stepId
  ctxMenu.open = true
}
export function closeCtxMenu(): void {
  ctxMenu.open = false
}

// 按 id 折叠/展开（右键菜单与徽章共用）
export function toggleCollapse(taskId: string, stepId: string): void {
  const m = ensureCollapse(String(taskId || 'draft'))
  m[stepId] = !m[stepId]
  persistCollapse(taskId)
}
export function forceOpenStep(taskId: string, stepId: string): void {
  const m = ensureCollapse(String(taskId || 'draft'))
  delete m[stepId]
  persistCollapse(taskId)
}
export function duplicateStepById(stepId: string): void {
  const path = findPath(rootSteps.value, stepId)
  const s = stepById(rootSteps.value, stepId)
  if (!path || !s) return
  const list = getArray(rootSteps.value, path.slice(0, -1))
  if (!list) return
  const [copy] = deepCloneSteps([s])
  list.splice((path[path.length - 1] as number) + 1, 0, copy)
}

// 每任务的展开/折叠状态（key = 任务id，value = stepId -> collapsed）
export const uiState = reactive<{ collapse: Record<string, Record<string, boolean>> }>({ collapse: {} })

export function ensureCollapse(taskId: string): Record<string, boolean> {
  const key = String(taskId || 'draft')
  if (!uiState.collapse[key]) uiState.collapse[key] = {}
  return uiState.collapse[key]
}

const LOCAL_PREFIX = 'fc-collapse-'
export function loadCollapse(taskId: string): void {
  const key = String(taskId || 'draft')
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key)
    if (raw) uiState.collapse[key] = { ...JSON.parse(raw) }
    else ensureCollapse(key)
  } catch { ensureCollapse(key) }
}

// 折叠状态防抖持久化到 localStorage（本地存储，刷新后恢复）
const persistTimers: Record<string, any> = {}
export function persistCollapse(taskId: string): void {
  const key = String(taskId || 'draft')
  if (persistTimers[key]) clearTimeout(persistTimers[key])
  persistTimers[key] = setTimeout(() => {
    const map = uiState.collapse[key]
    if (!map) return
    try { localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(map)) } catch { /* ignore */ }
  }, 200)
}

// ---------- 批量操作（多选步骤） ----------
export function setManyEnabled(ids: string[], enabled: boolean): void {
  for (const id of ids) {
    const s = stepById(rootSteps.value, id)
    if (s) s.enabled = enabled
  }
}
export function removeMany(ids: string[]): void {
  for (const id of ids) {
    const path = findPath(rootSteps.value, id)
    if (!path) continue
    const list = getArray(rootSteps.value, path.slice(0, -1))
    if (!list) continue
    list.splice(path[path.length - 1] as number, 1)
  }
}
// 批量上移/下移：所选步骤须位于同一层列表
export function moveMany(ids: string[], delta: -1 | 1): boolean {
  if (!ids.length) return false
  const first = findPath(rootSteps.value, ids[0])
  if (!first) return false
  const listKey = first.slice(0, -1).join('/')
  const list = getArray(rootSteps.value, first.slice(0, -1))
  if (!list) return false
  // 校验全部在同层
  for (const id of ids) {
    const p = findPath(rootSteps.value, id)
    if (!p || p.slice(0, -1).join('/') !== listKey) return false
  }
  moveManyInList(list, ids, delta)
  return true
}
function moveManyInList(list: Step[], ids: string[], delta: -1 | 1): void {
  const targets = ids
    .map((id) => list.findIndex((s) => s.id === id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
  if (!targets.length) return
  // 所有选中项必须是连续块才整体位移，否则按单个成员分别操作
  const isBlock = targets[targets.length - 1] - targets[0] === targets.length - 1
  if (isBlock && delta === -1 && targets[0] > 0) {
    const [item] = list.splice(targets[0], 1)
    list.splice(targets[0] - 1, 0, item)
    return
  }
  if (isBlock && delta === 1 && targets[targets.length - 1] < list.length - 1) {
    const [item] = list.splice(targets[targets.length - 1], 1)
    list.splice(targets[targets.length - 1] + 1, 0, item)
    return
  }
  // 非连续：逐项移动（从边界向目标方向冒泡一次）
  if (delta === -1) {
    for (const i of targets) {
      if (i > 0 && !ids.includes(list[i - 1].id)) {
        const [item] = list.splice(i, 1)
        list.splice(i - 1, 0, item)
      }
    }
  } else {
    for (let k = targets.length - 1; k >= 0; k--) {
      const i = targets[k]
      if (i < list.length - 1 && !ids.includes(list[i + 1].id)) {
        const [item] = list.splice(i, 1)
        list.splice(i + 1, 0, item)
      }
    }
  }
}

// ---------- 指针拖拽（桌面鼠标 + 触屏长按统一） ----------
export type DragTarget = {
  node: 'parent'
  parentId: string
} | {
  node: 'list'
  listPath: (number | string)[]
  index: number
}

export const drag = reactive<{
  active: boolean
  kind: 'step' | 'tile' | null
  ids: string[]           // 本次拖拽的步骤 id 组（多选）
  tileId: string
  x: number               // 指针坐标（相对窗口）
  y: number
  offsetX: number         // 幽灵卡片保持指针相对元素偏移
  offsetY: number
  target: DragTarget | null
  valid: boolean
  hint: string
}>({
  active: false, kind: null, ids: [], tileId: '', x: 0, y: 0, offsetX: 0, offsetY: 0,
  target: null, valid: true, hint: '',
})

// 拖拽开始时快照的路径缓存（拖动期间树不变化，供合法性校验复用，避免每帧递归遍历）
let cachedPaths: Map<string, (number | string)[]> | null = null

export function startDragDetail(kind: 'step' | 'tile', ids: string[], tileId: string, offsetX: number, offsetY: number): void {
  drag.kind = kind
  drag.ids = ids
  drag.tileId = tileId
  drag.offsetX = offsetX
  drag.offsetY = offsetY
  drag.target = null
  drag.valid = true
  drag.hint = ''
  drag.active = true
  // 拖拽开始即快照被拖拽项的路径：拖动途中（树未变化）直接用缓存，避免每帧递归遍历
  cachedPaths = new Map()
  for (const id of ids) {
    const p = findPath(rootSteps.value, id)
    if (p) cachedPaths.set(id, p)
  }
  document.body.classList.add('fc-dragging')
}
export function setDragPos(x: number, y: number): void {
  drag.x = x
  drag.y = y
}
export function cancelDrag(): void {
  drag.active = false
  drag.kind = null
  drag.ids = []
  drag.tileId = ''
  drag.target = null
  drag.valid = true
  drag.hint = ''
  cachedPaths = null
  document.body.classList.remove('fc-dragging')
}

// 路径工具
function isPathPrefix(p: (number | string)[], long: (number | string)[]): boolean {
  return p.length <= long.length && p.every((seg, i) => seg === long[i])
}
function pathKey(p: (number | string)[]): string {
  return p.join('/')
}

// 目标命中：鼠标/触点在 (x,y) 时判定放置目标
// 优先级：进入父磁贴「头部」→ 作为子项；进入步长列表区域 → 按位置插入
export function computePointerTarget(x: number, y: number): DragTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el) return null
  const head = el.closest('.fc-step-head') as HTMLElement | null
  if (head) {
    const card = head.closest('.fc-step[data-id]') as HTMLElement | null
    const pid = card?.dataset.id
    if (pid) return { node: 'parent', parentId: pid }
  }
  const listEl = el.closest('.fc-steplist') as HTMLElement | null
  if (listEl) {
    let listPath: (number | string)[] = []
    try { listPath = JSON.parse(listEl.dataset.path || '[]') } catch { /* ignore */ }
    return { node: 'list', listPath, index: computeListIndex(listEl, y) }
  }
  return null
}
function computeListIndex(listEl: HTMLElement, y: number): number {
  const cards = Array.from(listEl.querySelectorAll(':scope > .fc-step')) as HTMLElement[]
  const n = cards.length
  if (n <= 60) {
    for (let i = 0; i < n; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) return i
    }
    return n
  }
  // 大列表（>60 项）：按等间距高度估算，避免遍历全部卡片触发批量重排
  const first = cards[0].getBoundingClientRect()
  const last = cards[n - 1].getBoundingClientRect()
  if (y <= first.top + first.height / 2) return 0
  if (y >= last.bottom - last.height / 2) return n
  const h = first.height || 32
  const est = Math.floor((y - first.top) / h)
  return Math.max(0, Math.min(n, est))
}

// 当前拖拽目标是否合法（循环/自身校验，供实时提示）
// paths：拖拽开始时的路径快照，拖动期间树结构不变，直接复用，避免每帧递归遍历
export function refreshDragValidity(hasZone: (tileId: string) => boolean): void {
  if (!drag.target) { drag.valid = true; drag.hint = ''; return }
  if (drag.target.node === 'parent') {
    const pid = drag.target.parentId
    drag.valid = canDropOntoParent(drag.ids, pid, hasZone)
    drag.hint = drag.valid ? '释放以添加为子项' : '无法移动到自身或后代内部'
  } else {
    drag.valid = canDropInto(drag.ids, drag.target.listPath)
    drag.hint = drag.valid ? '释放以插入此处（同级）' : '无法移动到自身内部'
  }
}

// 目标为列表：目标列表是否位于被拖拽组内部（循环）
export function canDropInto(ids: string[], listPath: (number | string)[]): boolean {
  const dst = getArray(rootSteps.value, listPath)
  if (!dst) return false
  for (const id of ids) {
    const p = cachedPaths?.get(id) ?? findPath(rootSteps.value, id)
    if (p && p.length < listPath.length && isPathPrefix(p, listPath)) return false
  }
  return true
}
// 目标为父磁贴：父是否可作为被拖拽组的子级宿主（不能是自己/后代/祖先被拖入自身）
export function canDropOntoParent(ids: string[], parentId: string, hasZone: (tileId: string) => boolean): boolean {
  if (ids.includes(parentId)) return false
  const parent = stepById(rootSteps.value, parentId)
  if (!parent || !hasZone(parent.tile)) return false
  const pp = findPath(rootSteps.value, parentId)
  if (!pp) return false
  for (const id of ids) {
    const p = cachedPaths?.get(id) ?? findPath(rootSteps.value, id)
    if (p && isPathPrefix(p, pp)) return false // 拖拽组是父的祖先 → 循环
  }
  return true
}

// 释放到列表：把 ids 组移除并插入 listPath 的 index 处（同列表自动修正下标）
export function dropIntoList(ids: string[], listPath: (number | string)[], index: number): boolean {
  if (!canDropInto(ids, listPath)) return false
  const dst = getArray(rootSteps.value, listPath)
  if (!dst) return false
  let insertIndex = Math.max(0, Math.min(index, dst.length))
  // 同列表移除会前移下标
  let removedBefore = 0
  const removed: Step[] = []
  for (const id of ids) {
    const p = findPath(rootSteps.value, id)
    if (!p) continue
    const list = getArray(rootSteps.value, p.slice(0, -1))
    if (!list) continue
    if (list === dst && (p[p.length - 1] as number) < insertIndex) removedBefore++
    const [step] = list.splice(p[p.length - 1] as number, 1)
    if (step) removed.push(step)
  }
  insertIndex = Math.max(0, insertIndex - removedBefore)
  dst.splice(insertIndex, 0, ...removed)
  return true
}
// 释放到父磁贴：成为其成立分支/循环体子项（追加到底部）
export function dropOntoParent(ids: string[], parentId: string, hasZone: (tileId: string) => boolean): boolean {
  if (!canDropOntoParent(ids, parentId, hasZone)) return false
  const parent = stepById(rootSteps.value, parentId)
  if (!parent) return false
  const removed: Step[] = []
  for (const id of ids) {
    const p = findPath(rootSteps.value, id)
    if (!p) continue
    const list = getArray(rootSteps.value, p.slice(0, -1))
    if (!list) continue
    const [step] = list.splice(p[p.length - 1] as number, 1)
    if (step) removed.push(step)
  }
  if (!parent.children) parent.children = []
  parent.children.push(...removed)
  return true
}
// 磁贴拖拽：把新磁贴插入目标
export function dropTileInto(target: DragTarget, tileId: string, tiles: TileDef[]): boolean {
  if (target.node === 'parent') {
    const parent = stepById(rootSteps.value, target.parentId)
    if (!parent || !tiles.some((t) => t.id === tileId)) return false
    if (!parent.children) parent.children = []
    parent.children.push(newStep(tileId, tiles))
    return true
  }
  if (!canDropInto([], target.listPath)) return false
  const dst = getArray(rootSteps.value, target.listPath)
  if (!dst) return false
  dst.splice(Math.max(0, Math.min(target.index, dst.length)), 0, newStep(tileId, tiles))
  return true
}

// 列表路径的比对键（StepList 渲染插入线时使用）
export function listKeyOf(p: (number | string)[]): string {
  return pathKey(p)
}

let seed = 0
export function genId(): string {
  return `${Date.now().toString(36)}_${(++seed).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function newStep(tileId: string, tiles: TileDef[]): Step {
  const tile = tiles.find((t) => t.id === tileId)
  const params: Record<string, any> = {}
  for (const p of tile?.params || []) {
    if (p.default !== undefined) {
      params[p.key] = p.default
    } else if (p.type === 'boolean') {
      params[p.key] = false
    } else if (p.type === 'select' && p.options?.length) {
      params[p.key] = p.options[0].value
    } else {
      params[p.key] = ''
    }
  }
  return { id: genId(), tile: tileId, enabled: true, params, children: [], elseChildren: [], conditionSteps: [] }
}

export function deepCloneSteps(steps: Step[]): Step[] {
  const clone = (s: Step): Step => ({
    ...s,
    id: genId(),
    params: { ...s.params },
    children: (s.children || []).map(clone),
    elseChildren: (s.elseChildren || []).map(clone),
    conditionSteps: (s.conditionSteps || []).map(clone),
  })
  return (steps || []).map(clone)
}

// 按路径读取数组中对应子树列表（path 形如 [0,'children',1]，根列表传 []）
function getArray(list: Step[], path: (number | string)[]): Step[] | null {
  let cur: any = list
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return null
    cur = cur[seg]
  }
  return Array.isArray(cur) ? cur : null
}

// 获取某个列表数组（path 为从根算起的下标路径，如 [2,'children',0]）
export function getListAtPath(list: Step[], path: (number | string)[]): Step[] | null {
  return getArray(list, path)
}

// 查找步骤 id 在树中的路径（结尾为数组内下标）
export function findPath(list: Step[], id: string): (number | string)[] | null {
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    if (s.id === id) return [i]
    const p1 = findPath(s.children || [], id)
    if (p1) return [i, 'children', ...p1]
    const p2 = findPath(s.elseChildren || [], id)
    if (p2) return [i, 'elseChildren', ...p2]
    const p3 = findPath(s.conditionSteps || [], id)
    if (p3) return [i, 'conditionSteps', ...p3]
  }
  return null
}

export function stepById(list: Step[], id: string): Step | null {
  for (const s of list) {
    if (s.id === id) return s
    const c = stepById(s.children || [], id)
    if (c) return c
    const e = stepById(s.elseChildren || [], id)
    if (e) return e
    const c3 = stepById(s.conditionSteps || [], id)
    if (c3) return c3
  }
  return null
}

export function removeByPath(path: (number | string)[]): Step | null {
  const list = getArray(rootSteps.value, path.slice(0, -1))
  const idx = path[path.length - 1] as number
  if (!list || idx < 0 || idx >= list.length) return null
  return list.splice(idx, 1)[0]
}

export function insertByPath(path: (number | string)[], step: Step): boolean {
  const list = getArray(rootSteps.value, path.slice(0, -1))
  const idx = path[path.length - 1] as number
  if (!list) return false
  list.splice(idx, 0, step)
  return true
}

// 判断 dst 是否位于 src 的子树内（避免把节点拖入自己内部造成循环）
function isDescendant(srcPath: (number | string)[], dstPath: (number | string)[]): boolean {
  if (srcPath.length === 0) return true
  return srcPath.every((seg, i) => dstPath[i] === seg)
}

// 移动步骤：将 stepId 拖到目标列表的 index 处
export function moveStep(stepId: string, dstPath: (number | string)[], index: number, notify?: (msg: string) => void): void {
  const src = findPath(rootSteps.value, stepId)
  if (!src) return
  const srcList = getArray(rootSteps.value, src.slice(0, -1))
  const srcIdx = src[src.length - 1] as number
  if (!srcList) return
  if (isDescendant(src, dstPath)) {
    notify?.('不能将步骤移动到它自己的分支内部')
    return
  }
  const step = srcList[srcIdx]
  // 同一列表内前移时修正下标
  let idx = index
  if (isSameList(src.slice(0, -1), dstPath.slice(0, -1)) && srcIdx < idx) idx--
  srcList.splice(srcIdx, 1)
  const dstList = getArray(rootSteps.value, dstPath.slice(0, -1))
  if (!dstList) return
  dstList.splice(idx, 0, step)
}

function isSameList(a: (number | string)[], b: (number | string)[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// 上移 / 下移（在原列表内）
export function moveByOffset(stepId: string, delta: -1 | 1): void {
  const path = findPath(rootSteps.value, stepId)
  if (!path) return
  const list = getArray(rootSteps.value, path.slice(0, -1))
  const idx = path[path.length - 1] as number
  if (!list) return
  const target = idx + delta
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(idx, 1)
  list.splice(target, 0, item)
}

// 条件规则比较运算（与后端 tiles.ts 保持一致）
export const COMPARE_OPS: { value: string, label: string }[] = [
  { value: '==', label: '== 等于' },
  { value: '!=', label: '!= 不等于' },
  { value: '>', label: '> 大于' },
  { value: '>=', label: '>= 大于等于' },
  { value: '<', label: '< 小于' },
  { value: '<=', label: '<= 小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'isEmpty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
]
// 需要填写对比值的运算符
export const OP_NEEDS_VALUE = new Set(COMPARE_OPS.map((o) => o.value).filter((v) => v !== 'isEmpty' && v !== 'notEmpty'))

// 校验必填参数（前端提示用）
export function validateParams(steps: Step[], tiles: TileDef[]): string[] {
  const errors: string[] = []
  const walk = (list: Step[], prefix: string, inCond = false) => {
    for (const s of list) {
      const tile = tiles.find((t) => t.id === s.tile)
      if (!tile) { errors.push(`${prefix}存在未知磁贴`); continue }
      for (const p of tile.params) {
        if (p.required) {
          const v = s.params?.[p.key]
          if (v === undefined || v === null || v === '') errors.push(`${prefix}「${tile.label}」缺少必填参数「${p.label}」`)
        }
      }
      if (inCond) {
        const op = String(s.params?.compareOp || '')
        if (!op) errors.push(`${prefix}「${tile.label}」缺少比较运算符`)
        if (OP_NEEDS_VALUE.has(op) && String(s.params?.compareValue ?? '').trim() === '') {
          errors.push(`${prefix}「${tile.label}」该比较运算符需要填写对比值`)
        }
      }
      walk(s.children || [], `${prefix}${tile.label} › `)
      walk(s.elseChildren || [], `${prefix}${tile.label} › `)
      walk(s.conditionSteps || [], `${prefix}${tile.label} › 条件规则 › `, true)
    }
  }
  walk(steps, '')
  return errors
}