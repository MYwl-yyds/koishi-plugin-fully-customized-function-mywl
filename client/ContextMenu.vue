<template>
  <Teleport to="body">
    <transition name="fc-menu">
      <div v-if="ctxMenu.open" class="fc-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @mousedown.stop>
        <div class="fc-ctx-title">{{ currentTile?.label || '步骤' }}</div>
        <button v-for="item in items" :key="item.key" class="fc-ctx-item" :class="{ danger: item.danger }" @click="run(item)">
          {{ item.label }}
        </button>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { TileDef, rootSteps, stepById, ctxMenu, closeCtxMenu, toggleCollapse, forceOpenStep, duplicateStepById, removeMany, setManyEnabled } from './steps'

const props = defineProps<{
  tiles: TileDef[]
  taskId?: string
}>()

// 点击空白处 / 滚动 / Esc 关闭菜单
function onGlobal(e: Event) {
  if (ctxMenu.open) closeCtxMenu()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ctxMenu.open) closeCtxMenu()
}
onMounted(() => {
  document.addEventListener('mousedown', onGlobal)
  document.addEventListener('wheel', onGlobal)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobal)
  document.removeEventListener('wheel', onGlobal)
  document.removeEventListener('keydown', onKey)
})

const tileMap = computed<Record<string, TileDef>>(() => Object.fromEntries(props.tiles.map((t) => [t.id, t])))

const cur = computed(() => (ctxMenu.stepId ? stepById(rootSteps.value, ctxMenu.stepId) : null))
const currentTile = computed(() => (cur.value ? tileMap.value[cur.value.tile] : undefined))

const items = computed(() => {
  const s = cur.value
  if (!s) return []
  const hasZone = s.tile === 'sys.if' || s.tile === 'sys.loop_count' || s.tile === 'sys.loop_while'
  const list: { key: string, label: string, danger?: boolean }[] = []
  list.push({ key: 'toggle', label: s.enabled ? '禁用' : '启用' })
  if (hasZone) list.push({ key: 'collapse', label: '展开 / 折叠子项' })
  list.push({ key: 'edit', label: '编辑参数' })
  if (hasZone) list.push({ key: 'addChild', label: '添加子项…' })
  list.push({ key: 'duplicate', label: '复制' })
  list.push({ key: 'delete', label: '删除', danger: true })
  return list
})

function run(item: { key: string }) {
  const id = ctxMenu.stepId
  const s = cur.value
  if (!id || !s) return
  switch (item.key) {
    case 'toggle':
      setManyEnabled([id], !s.enabled)
      break
    case 'collapse':
      toggleCollapse(props.taskId || 'draft', id)
      break
    case 'edit':
      forceOpenStep(props.taskId || 'draft', id)
      break
    case 'addChild':
      forceOpenStep(props.taskId || 'draft', id)
      nextTick(() => {
        const el = document.querySelector<HTMLSelectElement>(`.fc-step[data-id="${id}"] .fc-zone-select`)
        el?.focus()
        el?.click()
      })
      break
    case 'duplicate':
      duplicateStepById(id)
      break
    case 'delete': {
      if (confirm(`确定删除「${currentTile.value?.label || s.tile}」？`)) {
        removeMany([id])
      }
      closeCtxMenu()
      return
    }
  }
  closeCtxMenu()
}
</script>