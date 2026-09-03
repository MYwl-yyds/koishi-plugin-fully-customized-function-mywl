<template>
  <Teleport to="body">
    <div v-if="visible" class="fc-modal-mask" @mousedown.self="emit('close')">
      <div class="fc-modal">
        <div class="fc-modal-head">
          <b>树形预览</b><span class="fc-modal-sub">{{ task?.name || '未命名' }}</span>
          <div style="flex:1"></div>
          <input v-model="keyword" class="fc-input fc-modal-search" placeholder="搜索名称 / 类型 / 字段…" />
          <button class="fc-btn sm" @click="exportJson">导出</button>
          <button class="fc-btn sm" @click="importJson">导入</button>
          <input ref="fileInput" type="file" accept="application/json,.json" style="display:none" @change="onImportFile" />
          <button class="fc-btn sm danger" @click="emit('close')">关闭</button>
        </div>
        <div class="fc-modal-body">
          <div v-if="flatRows.length === 0" class="fc-empty">无可显示步骤</div>
          <div
            v-for="row in flatRows"
            :key="row.step.id"
            class="fc-tree-row"
            :style="{ paddingLeft: (row.depth * 22 + 8) + 'px' }"
            @click="rowClick(row)"
          >
            <span class="fc-tree-rail" :style="{ background: depthColor(row.depth) }"></span>
            <button v-if="row.hasZone" class="fc-tree-chev" @click.stop="toggleRow(row)">
              {{ row.expanded ? '▼' : '▶' }}
            </button>
            <span v-else class="fc-tree-chev placeholder">•</span>
            <span class="fc-tree-name" :class="{ off: !row.step.enabled }">{{ row.label }}</span>
            <span v-if="row.summary" class="fc-rule-summary">{{ row.summary }}</span>
            <span v-if="row.hasZone && !row.available" class="fc-tree-count">({{ row.count }} 子项)</span>
            <span v-if="row.hasZone && row.available" class="fc-tree-count">{{ row.count }} 子项</span>
            <span v-if="!row.step.enabled" class="fc-badge stopped" style="margin-left:6px">停用</span>
          </div>
        </div>
        <div class="fc-modal-foot">
          <div class="fc-hint" style="margin:0">
            共 {{ totalSteps }} 步：<b>数据源</b>右上角可导出 / 导入 JSON 结构（备份与迁移层级）。导入后将替换当前任务步骤。
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { TileDef, Step, COMPARE_OPS } from './steps'

const props = defineProps<{
  visible: boolean
  task: any
  tiles: TileDef[]
}>()
const emit = defineEmits<{ (e: 'close'): void, (e: 'import', steps: Step[]): void }>()

const keyword = ref('')
const expanded = ref<Record<string, boolean>>({})
const fileInput = ref<HTMLInputElement | null>(null)

const tileMap = computed<Record<string, TileDef>>(() => Object.fromEntries(props.tiles.map((t) => [t.id, t])))
const DEPTH_COLORS = ['#4f7cff', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f43f5e']
function depthColor(d: number): string {
  return DEPTH_COLORS[d % DEPTH_COLORS.length]
}

interface Row { step: Step, depth: number, label: string, hasZone: boolean, expanded: boolean, available: boolean, count: number, summary: string }

function zoneCount(s: Step): number {
  if (s.tile === 'sys.if') return (s.children?.length || 0) + (s.elseChildren?.length || 0) + (s.conditionSteps?.length || 0)
  return s.children?.length || 0
}
function hasZone(s: Step): boolean {
  return s.tile === 'sys.if' || s.tile === 'sys.loop_count' || s.tile === 'sys.loop_while'
}
function zoneLabel(s: Step): string {
  if (s.tile === 'sys.if') return ['条件规则', '成立', '否则'].join(' / ')
  if (s.tile === 'sys.loop_count' || s.tile === 'sys.loop_while') return '循环体'
  return ''
}
function summaryOf(s: Step): string {
  if (s.tile === 'sys.var_set') return `= ${String(s.params?.value ?? '')}`
  if (s.tile === 'sys.wait') return `${String(s.params?.ms ?? '')}ms`
  if (s.tile === 'sys.loop_count') return `${s.params?.count ?? 0} 次`
  if (s.params && ('compareOp' in s.params)) {
    const op = String(s.params.compareOp || '==')
    const v = String(s.params.resultVar || 'lastResult')
    const f = String(s.params.compareField || '').trim()
    const src = `${v}${f ? '.' + f : ''}`
    if (op === 'isEmpty') return `if ${src} 为空`
    if (op === 'notEmpty') return `if ${src} 不为空`
    const label = COMPARE_OPS.find((o) => o.value === op)?.label.split(' ')[0] || op
    return `${src} ${label} ${String(s.params.compareValue ?? '')}`
  }
  return ''
}

const totalSteps = computed(() => {
  let n = 0
  const walk = (list: Step[]) => { for (const s of list || []) { n++; walk(s.children); walk(s.elseChildren); walk(s.conditionSteps) } }
  walk(props.task?.steps || [])
  return n
})

const flatRows = computed<Row[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const out: Row[] = []
  const walk = (list: Step[], depth: number) => {
    for (const s of list || []) {
      const tile = tileMap.value[s.tile]
      const label = tile?.label || s.tile
      const api = tile?.api || ''
      const summary = summaryOf(s)
      const hit = !kw || label.toLowerCase().includes(kw) || api.toLowerCase().includes(kw)
        || summary.toLowerCase().includes(kw) || (tile?.category || '').toLowerCase().includes(kw)
      const isOpen = !!expanded.value[s.id]
      if (!kw || hit) {
        out.push({
          step: s, depth, label, hasZone: hasZone(s), expanded: isOpen, available: !kw,
          count: zoneCount(s), summary,
        })
      }
      // 无搜索词时仅在展开态下深入；有搜索词时忽略折叠全部过滤
      if ((isOpen || kw) && hasZone(s)) {
        walk(s.children || [], depth + 1)
        walk(s.elseChildren || [], depth + 1)
        walk(s.conditionSteps || [], depth + 1)
      }
    }
  }
  walk(props.task?.steps || [], 0)
  return out
})

function toggleRow(row: Row) {
  expanded.value[row.step.id] = !expanded.value[row.step.id]
}
function rowClick(row: Row) {
  if (row.hasZone) toggleRow(row)
}

// ---------- 导入 / 导出 ----------
function exportJson() {
  const data = {
    name: props.task?.name || '',
    trigger: props.task?.trigger || 'manual',
    cron: props.task?.cron || '',
    interval: props.task?.interval || 60,
    event: props.task?.event || '',
    description: props.task?.description || '',
    steps: props.task?.steps || [],
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `task-${(props.task?.name || 'export')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
function importJson() {
  fileInput.value?.click()
}
function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      if (!Array.isArray(parsed.steps)) throw new Error('缺少 steps 数组')
      const steps = parsed.steps as Step[]
      expanded.value = {}
      emit('import', steps)
      alert('导入成功，请检查并保存')
    } catch (err) {
      alert('导入失败：' + (err as Error).message)
    }
  }
  reader.readAsText(file)
  input.value = ''
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
})
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) emit('close')
}
</script>