<template>
  <div>
    <div class="fc-heading">
      <h2>任务编排</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="fc-btn sm" @click="refresh">刷新</button>
        <button class="fc-btn sm primary" @click="newTask">+ 新建任务</button>
      </div>
    </div>

    <template v-if="data">
      <div class="fc-stats" style="margin-bottom:12px">
        <div class="fc-stat"><div class="num">{{ data.stats.totalTasks }}</div><div class="label">任务总数</div></div>
        <div class="fc-stat"><div class="num">{{ data.stats.enabledTasks }}</div><div class="label">已启用</div></div>
        <div class="fc-stat"><div class="num">{{ data.stats.runningCount }}</div><div class="label">运行中</div></div>
        <div class="fc-stat"><div class="num">{{ data.stats.todayRuns }}</div><div class="label">今日执行</div></div>
      </div>

      <div class="fc-taskbar">
        <!-- 左侧任务列表 -->
        <div class="fc-tasklist">
          <div class="fc-card" style="margin-bottom:4px">
            <div class="fc-hint" style="margin:0">点击任务进行编辑；任务按最后一次保存时间排序。</div>
          </div>
          <div
            v-for="t in data.tasks"
            :key="t.id"
            class="fc-task-item"
            :class="{ active: selectedId === t.id, off: !t.enabled }"
            @click="selectTask(t)"
          >
            <div class="name">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.name || '（未命名）' }}</span>
              <span v-if="data.running[t.id]" class="fc-stat-pill run">运行中</span>
              <span v-else-if="t.lastRunStatus === 'failed'" class="fc-stat-pill err">失败</span>
            </div>
            <div class="sub">
              <span class="fc-stat-pill">{{ triggerLabel(t.trigger) }}</span>
              <span v-if="t.enabled" class="fc-stat-pill">已启用</span>
              <span v-else class="fc-stat-pill" style="background:#e2e6f0;color:#6b7280">停用</span>
              <span v-if="t.runCount">执行 {{ t.runCount }} 次</span>
            </div>
            <div class="sub" style="margin-top:6px;justify-content:flex-end">
              <button class="fc-btn sm" @click.stop="loadFromServer(t)" title="放弃本地未保存修改，重新加载">重载</button>
              <button class="fc-btn sm" @click.stop="dupTask(t)">复制</button>
              <button class="fc-btn sm danger" @click.stop="delTask(t)">删除</button>
            </div>
          </div>
          <div v-if="data.tasks.length === 0" class="fc-empty">暂无任务，点击「新建任务」开始编排</div>
        </div>

        <!-- 右侧编辑器 -->
        <div v-if="editing" class="fc-editor">
          <div class="fc-editor-head">
            <div class="fc-field" style="margin:0">
              <label>任务名称<span class="req"> *</span></label>
              <input v-model="editing.name" class="fc-input" placeholder="输入任务名称" />
            </div>
            <div class="fc-field" style="margin:0">
              <label>触发方式</label>
              <select v-model="editing.trigger" class="fc-select" @change="onTriggerChange">
                <option value="manual">手动触发</option>
                <option value="cron">定时触发（cron）</option>
                <option value="interval">固定间隔触发</option>
                <option value="event">事件触发</option>
              </select>
            </div>
            <div class="fc-field" style="margin:0">
              <label v-if="editing.trigger === 'cron'">cron 表达式<span class="req"> *</span></label>
              <label v-else-if="editing.trigger === 'interval'">间隔时长（秒）<span class="req"> *</span></label>
              <label v-else-if="editing.trigger === 'event'">监听事件</label>
              <label v-else>说明</label>
              <input
                v-if="editing.trigger === 'cron'"
                v-model="editing.cron"
                class="fc-input"
                placeholder="如 */5 * * * *"
              />
              <input
                v-else-if="editing.trigger === 'interval'"
                v-model.number="editing.interval"
                type="number" min="5"
                class="fc-input"
              />
              <select v-else-if="editing.trigger === 'event'" v-model="editing.event" class="fc-select">
                <option v-for="ev in data.events" :key="ev.value" :value="ev.value">{{ ev.label }}</option>
              </select>
              <span v-else class="fc-hint" style="margin:0">手动触发：点击「立即执行」时运行</span>
            </div>
            <div class="fc-editor-actions">
              <button class="fc-btn" :disabled="!isRunning" @click="stopRun">停止</button>
              <button class="fc-btn" :disabled="isRunning" @click="runNow">立即执行</button>
              <button class="fc-btn" @click="showTree = true" title="树形结构预览、搜索、导入导出">树形预览</button>
              <button class="fc-btn primary" @click="save">保存</button>
            </div>
            <div v-if="lastSavedAt" class="fc-autosave-hint">✔ 已自动保存 {{ lastSavedAt }}</div>
            <div class="fc-field" style="margin:0;display:flex;align-items:end;gap:8px">
              <div>
                <div class="fc-switch" :class="{ on: editing.enabled }" @click="editing.enabled = !editing.enabled"></div>
              </div>
              <label style="margin:0">{{ editing.enabled ? '已启用' : '已停用' }}</label>
            </div>
            <div class="fc-field" style="margin:0;grid-column:1 / -1">
              <input v-model="editing.description" class="fc-input" placeholder="任务说明（可选）" />
            </div>
          </div>

          <div v-if="editing.trigger === 'cron'" class="fc-warn-hint">
            每个空格分隔 5 个字段：<b>分 时 日 月 周</b>。例：<code>0 8 * * *</code> 每天 08:00；<code>*/10 * * * *</code> 每 10 分钟；<code>0 9 * * 1</code> 每周一 09:00。
          </div>

          <div class="fc-workspace">
            <!-- 磁贴库（固定视口 + 独立滚动翻页） -->
            <div class="fc-palette">
              <div class="fc-palette-head">
                <span class="fc-palette-title">🧩 磁贴库 <i>{{ tiles.length }}</i></span>
                <input v-model="paletteKeyword" class="fc-input fc-palette-search" placeholder="搜索磁贴…" />
                <span class="fc-palette-nav">
                  <button class="fc-btn sm" title="上翻" @click="paletteScroll(-1)">▲</button>
                  <button class="fc-btn sm" title="下翻" @click="paletteScroll(1)">▼</button>
                </span>
              </div>
              <div class="fc-palette-list" ref="paletteRef">
                <div class="fc-card">
                  <div class="fc-hint" style="margin:0">拖拽磁贴到右侧画布任意位置，或<b>点击磁贴</b>追加到任务末尾。</div>
                </div>
                <div v-for="cat in palette" :key="cat.label" class="fc-card">
                  <h4>{{ cat.label }}（{{ cat.tiles.length }}）</h4>
                  <div class="fc-tile-grid">
                    <div
                      v-for="t in cat.tiles"
                      :key="t.id"
                      class="fc-tile"
                      :title="t.description"
                      @pointerdown="onTilePointerDown($event, t)"
                      @click="appendTile(t)"
                    >
                      <span class="dot" :style="{ background: t.color || '#888' }"></span>
                      <span class="t-name">{{ t.label }}</span>
                      <span class="t-sub" :style="{ color: t.color || '#888' }">{{ cat.kind === 'system' ? '系统' : t.api }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 步骤画布 -->
            <div class="fc-canvas fc-scroll">
              <div class="fc-hint" style="margin-bottom:8px">
                🧩 <b>变量说明</b>：定时/间隔任务内置 <code>{now}</code> <code>{taskName}</code>；事件任务另有
                <code>{groupId}</code> <code>{userId}</code> <code>{nickname}</code> <code>{content}</code> <code>{messageId}</code>（入群/退群含 <code>{operatorId}</code>）；
                OneBot 接口结果默认存入 <code>{lastResult}</code>，也可自定义「结果保存变量」。任何文本参数均可使用 <code>{变量名}</code> 引用。
              </div>
              <div v-if="rootSteps.length === 0" class="fc-canvas-empty">
                <span class="big">🗂</span>
                <span>从左侧磁贴库拖拽或点击磁贴开始搭建流程</span>
              </div>
              <StepList :steps="rootSteps" :list-path="[]" :tiles="tiles" :task-id="taskKey" />
              <div v-if="previewErrors.length" class="fc-warn-hint">
                未保存问题：<br /><span v-for="e in previewErrors" :key="e" style="display:block">• {{ e }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="fc-card" style="flex:1;display:flex;align-items:center;justify-content:center;min-height:320px">
          <div class="fc-empty">👈 选择左侧任务，或点击「新建任务」开始编排</div>
        </div>
      </div>
    </template>
    <div v-else class="fc-empty" style="padding:40px">正在加载…</div>

    <!-- 批量操作栏（多选 ≥2 时出现） -->
    <transition name="fc-toast">
      <div v-if="selectedSteps.length >= 2" class="fc-batch-bar">
        <span class="fc-batch-count">已选 {{ selectedSteps.length }} 项</span>
        <button class="fc-btn sm" @click="batchSet(true)">启用</button>
        <button class="fc-btn sm" @click="batchSet(false)">禁用</button>
        <button class="fc-btn sm" @click="batchMove(-1)">上移</button>
        <button class="fc-btn sm" @click="batchMove(1)">下移</button>
        <button class="fc-btn sm danger" @click="batchDelete">删除</button>
        <button class="fc-btn sm" @click="batchClear">清除</button>
      </div>
    </transition>

    <!-- 右键上下文菜单 -->
    <ContextMenu :tiles="tiles" :task-id="editing?.id ? String(editing.id) : 'draft'" />

    <!-- 树形预览 -->
    <TreePreview v-if="showTree && editing" :visible="showTree" :task="editing" :tiles="tiles" @close="showTree = false" @import="onTreeImport" />

    <!-- 拖拽幽灵卡片：跟随指针，随内容显示磁贴/步骤信息 -->
    <div v-if="drag.active" class="fc-ghost" :style="ghostStyle">
      <span class="dot" :style="{ background: ghostColor }"></span>
      <span class="g-title">{{ ghostTitle }}</span>
      <span v-if="drag.kind === 'step' && drag.ids.length > 1" class="g-count">+{{ drag.ids.length - 1 }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import StepList from '../StepList.vue'
import ContextMenu from '../ContextMenu.vue'
import TreePreview from '../TreePreview.vue'
import { useGmData } from '../useData'
import { toast } from '../toast'
import {
  Step, TileDef, newStep, validateParams, rootSteps, stepById,
  stepSelection, setManyEnabled, removeMany, moveMany, loadCollapse,
  drag, startDragDetail, setDragPos, cancelDrag, computePointerTarget, refreshDragValidity, dropTileInto, listKeyOf,
} from '../steps'

const { data, mutate, refresh } = useGmData()
const selectedId = ref<number | null>(null)
const editing = ref<any>(null)
const dirty = ref(false)

const tiles = computed<TileDef[]>(() => data.value?.tiles || [])
const isRunning = computed(() => data.value?.running?.[editing.value?.id] ?? false)
const taskKey = computed(() => String(editing.value?.id || 'draft'))

// 树形预览弹窗
const showTree = ref(false)
// 自动保存状态
const lastSavedAt = ref<number | string>('')
// 磁贴库搜索
const paletteKeyword = ref('')

// 对象整体被替换时不置脏（选择/新建/保存后由调用方控制），内部属性变更时置脏并触发自动保存
watch(editing, (newV, oldV) => {
  if (!newV) return
  if (newV !== oldV) { dirty.value = false; return }
  dirty.value = true
  scheduleAutoSave()
}, { deep: true })

// ---------- 自动保存（拖拽排序 / 编辑后 1.5s 防抖持久化到后端） ----------
let saveTimer: any = null
let saving = false
function scheduleAutoSave() {
  if (!editing.value || !dirty.value) return
  const name = String(editing.value.name || '').trim()
  if (!name) return
  if (previewErrors.value.length) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(runAutoSave, 1500)
}
async function runAutoSave() {
  if (saving || !editing.value) return
  saving = true
  const payload = JSON.parse(JSON.stringify(editing.value))
  payload.steps = rootSteps.value
  const res = await mutate('task.save', payload)
  saving = false
  if (res?.ok) {
    if (res.saved?.id && editing.value.id !== res.saved.id) {
      editing.value.id = res.saved.id
      selectedId.value = res.saved.id
    }
    dirty.value = false
    lastSavedAt.value = new Date().toLocaleTimeString()
  }
  // 自动保存失败（如校验问题）静默，等待手动保存
}

// ---------- 多选批量操作 ----------
const selectedSteps = computed(() => [...stepSelection.ids])
function batchSet(v: boolean) {
  setManyEnabled(selectedSteps.value, v)
}
function batchMove(delta: -1 | 1) {
  const ok = moveMany(selectedSteps.value, delta)
  if (!ok) toast.info('批量移动仅支持同一层级的步骤')
}
function batchDelete() {
  if (!confirm(`确定删除选中的 ${selectedSteps.value.length} 个步骤？`)) return
  removeMany(selectedSteps.value)
  stepSelection.ids.clear()
}
function batchClear() {
  stepSelection.ids.clear()
}

// 磁贴库分组（OneBot 分类在前，系统磁贴在后）
const onebotOrder = ['消息操作', '群聊操作', '好友与请求', '信息查询', '文件媒体', '系统维护']
const palette = computed(() => {
  const all = tiles.value
  const kw = paletteKeyword.value.trim().toLowerCase()
  const groups: { label: string, kind: string, tiles: TileDef[] }[] = []
  const pushCat = (label: string) => {
    let list = all.filter((t) => t.category === label)
    if (kw) {
      list = list.filter((t) =>
        t.label.toLowerCase().includes(kw)
        || (t.api || '').toLowerCase().includes(kw)
        || t.description.toLowerCase().includes(kw),
      )
    }
    if (list.length) groups.push({ label, kind: list[0].kind, tiles: list })
  }
  for (const label of onebotOrder) pushCat(label)
  pushCat('流程控制')
  pushCat('变量与日志')
  pushCat('Koishi 信息')
  pushCat('代码工具')
  return groups
})

const triggerLabel = (t: string) => ({ manual: '手动触发', cron: '定时', interval: '间隔', event: '事件' } as Record<string, string>)[t] || t

function newTask() {
  if (dirty.value && !confirm('当前任务有未保存的修改，确定放弃？')) return
  editing.value = {
    id: null, name: '', description: '', enabled: true, trigger: 'manual',
    cron: '', interval: 60, event: 'message.group',
    steps: [], runCount: 0, lastRunAt: '', lastRunStatus: '',
  }
  rootSteps.value = editing.value.steps
  selectedId.value = null
  dirty.value = false
  stepSelection.ids.clear()
  loadCollapse('draft')
}

function selectTask(t: any) {
  if (dirty.value && selectedId.value !== t.id && !confirm('当前任务有未保存的修改，确定放弃？')) return
  const clone = JSON.parse(JSON.stringify(t))
  clone.steps = clone.steps || []
  editing.value = clone
  rootSteps.value = clone.steps
  selectedId.value = t.id
  dirty.value = false
  stepSelection.ids.clear()
  loadCollapse(String(t.id))
}

function loadFromServer(t: any) {
  selectTask(t)
  toast.info('已重新加载该任务')
}

// 树形预览导入：替换当前任务步骤
function onTreeImport(steps: Step[]) {
  if (!editing.value) return
  editing.value.steps = steps
  rootSteps.value = steps
  dirty.value = true
  showTree.value = false
  toast.info('已导入结构，请检查后保存')
}

function onTriggerChange() {
  dirty.value = true
}

// ---------- 磁贴：指针拖拽（鼠标 / 触屏长按 300ms） ----------
function hasZone(id: string): boolean {
  return id === 'sys.if' || id === 'sys.loop_count' || id === 'sys.loop_while'
}

// 幽灵卡片内容：步骤拖拽显示步骤磁贴名，磁贴拖拽显示磁贴名
const ghostTitle = computed(() => {
  if (drag.kind === 'step' && drag.ids[0]) {
    const s = stepById(rootSteps.value, drag.ids[0])
    const tile = tiles.value.find((t) => t.id === s?.tile)
    return tile?.label || s?.tile || ''
  }
  if (drag.kind === 'tile' && drag.tileId) {
    return tiles.value.find((t) => t.id === drag.tileId)?.label || drag.tileId
  }
  return ''
})
const ghostColor = computed(() => {
  if (drag.kind === 'step' && drag.ids[0]) {
    const s = stepById(rootSteps.value, drag.ids[0])
    return tiles.value.find((t) => t.id === s?.tile)?.color || '#888'
  }
  if (drag.kind === 'tile' && drag.tileId) {
    return tiles.value.find((t) => t.id === drag.tileId)?.color || '#888'
  }
  return '#888'
})
// 幽灵卡定位用 transform（合成器线程完成，不触发重排）
const ghostStyle = computed(() => ({
  transform: `translate3d(${drag.x - drag.offsetX + 12}px, ${drag.y - drag.offsetY + 12}px, 0) rotate(-1.5deg)`,
}))

// 拖拽结束后抑制紧随的 click（防止长按释放时误追加磁贴）
let suppressClick = false
const tilePressTimer = ref<any>(null)
let tileRaf = 0
let lastTileKey = ''
let lastTileTime = 0

function onTilePointerDown(e: PointerEvent, t: TileDef) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (!editing.value) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const startX = e.clientX
  const startY = e.clientY
  const startRect = el.getBoundingClientRect()
  let armed = false
  let dragging = false

  function cleanup() {
    clearTimeout(tilePressTimer.value)
    if (tileRaf) { cancelAnimationFrame(tileRaf); tileRaf = 0 }
    lastTileKey = ''
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }
  function beginDrag() {
    dragging = true
    suppressClick = true
    startDragDetail('tile', [], t.id, startX - startRect.left, startY - startRect.top)
    setDragPos(startX, startY)
  }
  // 目标计算 rAF 合帧 + 变更检测（同目标且 <100ms 跳过）
  function updateTarget(x: number, y: number) {
    const now = Date.now()
    const next = computePointerTarget(x, y)
    const key = next ? (next.node === 'parent' ? 'p:' + next.parentId : 'l:' + listKeyOf(next.listPath) + ':' + next.index) : ''
    if (key === lastTileKey && now - lastTileTime < 100) return
    lastTileKey = key
    lastTileTime = now
    drag.target = next
    refreshDragValidity(hasZone)
  }
  const onMove = (ev: PointerEvent) => {
    const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
    if (!dragging && (armed || dist > 6)) beginDrag()
    if (!dragging) return
    setDragPos(ev.clientX, ev.clientY)
    if (tileRaf) return
    const px = ev.clientX
    const py = ev.clientY
    tileRaf = requestAnimationFrame(() => {
      tileRaf = 0
      updateTarget(px, py)
    })
  }
  const onUp = (ev: PointerEvent) => {
    cleanup()
    if (!dragging) return
    const inCanvas = !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fc-canvas')
    if (drag.target && drag.valid) {
      dropTileInto(drag.target, drag.tileId, tiles.value)
      dirty.value = true
    } else if (inCanvas) {
      // 拖到画布空白处 → 追加到任务末尾
      rootSteps.value.push(newStep(drag.tileId, tiles.value))
      dirty.value = true
    } else {
      toast.info(`已取消添加「${t.label}」`)
    }
    cancelDrag()
    // click 事件在 pointerup 之后同步触发；等它派发完再解除抑制标记
    setTimeout(() => { suppressClick = false }, 0)
  }
  const onCancel = () => {
    cleanup()
    cancelDrag()
    setTimeout(() => { suppressClick = false }, 0)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  tilePressTimer.value = setTimeout(() => { armed = true }, 300)
}

function appendTile(t: TileDef) {
  if (suppressClick) { suppressClick = false; return }
  if (!editing.value) return
  rootSteps.value.push(newStep(t.id, tiles.value))
  dirty.value = true
  toast.info(`已添加「${t.label}」到任务末尾`)
}

// ---------- 拖拽辅助：接近画布边缘时自动滚动（步骤/磁贴拖拽共用） ----------
let autoScrollRaf = 0
function onDragWinMove(ev: PointerEvent) {
  if (!drag.active) return
  const canvas = document.querySelector<HTMLElement>('.fc-canvas.fc-scroll')
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  const margin = 48
  let dy = 0, dx = 0
  if (ev.clientY < r.top + margin) dy = -16
  else if (ev.clientY > r.bottom - margin) dy = 16
  if (ev.clientX < r.left + margin) dx = -16
  else if (ev.clientX > r.right - margin) dx = 16
  if (dy || dx) {
    cancelAnimationFrame(autoScrollRaf)
    autoScrollRaf = requestAnimationFrame(() => canvas.scrollBy({ top: dy, left: dx }))
  }
}
function onDragWinKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && drag.active) cancelDrag()
}
onMounted(() => {
  window.addEventListener('pointermove', onDragWinMove)
  window.addEventListener('keydown', onDragWinKey)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragWinMove)
  window.removeEventListener('keydown', onDragWinKey)
})

// ---------- 磁贴库独立滚动翻页 ----------
const paletteRef = ref<HTMLElement | null>(null)
function paletteScroll(dir: -1 | 1) {
  const el = paletteRef.value
  if (!el) return
  el.scrollBy({ top: dir * Math.max(120, el.clientHeight * 0.85), behavior: 'smooth' })
}

// ---------- 保存 / 执行 ----------
const previewErrors = computed(() => {
  if (!editing.value) return []
  const errs: string[] = []
  if (!editing.value.name || !String(editing.value.name).trim()) errs.push('任务名称不能为空')
  if (editing.value.trigger === 'cron') {
    const ok = /^[0-9*?\/,\-\s]{5,80}$/.test(String(editing.value.cron || '')) && String(editing.value.cron || '').trim().split(/\s+/).length === 5
    if (!ok) errs.push('cron 表达式需为 5 段（如 */5 * * * *）')
  }
  if (editing.value.trigger === 'interval' && (!Number(editing.value.interval) || Number(editing.value.interval) < 5)) {
    errs.push('间隔时间需为不小于 5 的整数（秒）')
  }
  errs.push(...validateParams(rootSteps.value, tiles.value))
  return errs.slice(0, 20)
})

async function save() {
  if (!editing.value) return
  if (previewErrors.value.length) {
    toast.error('保存失败：\n' + previewErrors.value.join('\n'))
    return
  }
  const payload = JSON.parse(JSON.stringify(editing.value))
  payload.steps = rootSteps.value
  const res = await mutate('task.save', payload)
  if (res?.ok) {
    if (res.saved) {
      const sync = JSON.parse(JSON.stringify(res.saved))
      sync.steps = sync.steps || []
      editing.value = sync
      rootSteps.value = sync.steps
      selectedId.value = res.saved.id
    }
    dirty.value = false
    toast.success('任务已保存')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function runNow() {
  if (!editing.value?.id) { toast.warning('请先保存任务再执行'); return }
  const res = await mutate('task.run', { id: editing.value.id, vars: {} })
  if (res?.ok) toast.success('任务已开始执行')
  else toast.error(res?.error || '启动失败')
}

async function stopRun() {
  if (!editing.value?.id) return
  await mutate('task.stop', { id: editing.value.id })
  toast.info('已发送停止指令')
}

async function delTask(t: any) {
  if (!confirm(`确定删除任务「${t.name}」？此操作不可恢复`)) return
  const res = await mutate('task.delete', { id: t.id })
  if (res?.ok) {
    if (selectedId.value === t.id) { editing.value = null; selectedId.value = null }
    toast.success('任务已删除')
  } else toast.error(res?.error || '删除失败')
}

async function dupTask(t: any) {
  const res = await mutate('task.duplicate', { id: t.id })
  if (res?.ok) toast.success('已复制任务')
  else toast.error(res?.error || '复制失败')
}

watch(data, (v) => {
  // 任务被他人修改/删除后，若当前编辑任务已不存在则清空编辑态
  if (editing.value?.id) {
    const exist = v?.tasks?.some((t: any) => t.id === editing.value.id)
    if (!exist) {
      editing.value = null
      selectedId.value = null
      stepSelection.ids.clear()
    }
  }
})
</script>