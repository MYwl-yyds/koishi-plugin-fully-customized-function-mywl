<template>
  <div>
    <div class="fc-heading">
      <h2>执行日志</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select v-model="statusFilter" class="fc-select" style="width:auto">
          <option value="">全部状态</option>
          <option value="running">运行中</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="stopped">已停止</option>
        </select>
        <select v-model="taskFilter" class="fc-select" style="width:auto">
          <option value="">全部任务</option>
          <option v-for="t in taskOptions" :key="t" :value="t">{{ t }}</option>
        </select>
        <button class="fc-btn sm" @click="refresh">刷新</button>
        <button class="fc-btn sm danger" @click="clearLogs">清空</button>
      </div>
    </div>

    <template v-if="data">
      <div class="fc-stats" style="margin-bottom:12px">
        <div class="fc-stat"><div class="num">{{ data.stats.runningCount }}</div><div class="label">正在运行</div></div>
        <div class="fc-stat"><div class="num">{{ data.stats.successRuns }}</div><div class="label">累计成功</div></div>
        <div class="fc-stat"><div class="num">{{ data.stats.todayRuns }}</div><div class="label">今日执行</div></div>
        <div class="fc-stat"><div class="num">{{ filtered.length }}</div><div class="label">当前列表</div></div>
      </div>

      <div class="fc-card">
        <table class="fc-table">
          <thead>
            <tr>
              <th style="width:170px">时间</th>
              <th>任务</th>
              <th style="width:90px">状态</th>
              <th>结果</th>
              <th style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in filtered" :key="l.id">
              <td class="num">{{ formatTime(l.createdAt) }}</td>
              <td>{{ l.taskName }}<span v-if="l.taskId" class="fc-stat-pill" style="margin-left:6px">#{{ l.taskId }}</span></td>
              <td><span class="fc-badge" :class="l.status">{{ statusLabel(l.status) }}</span></td>
              <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ l.message }}</td>
              <td>
                <button class="fc-btn sm" @click="toggleDetail(l)">{{ expanded[l.id] ? '收起' : '详情' }}</button>
              </td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="5"><div class="fc-empty">暂无执行日志</div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 日志详情展开区 -->
      <div v-for="l in filtered" :key="'d' + l.id" v-show="expanded[l.id]">
        <div class="fc-card" style="margin-top:8px">
          <h3>「{{ l.taskName }}」执行明细</h3>
          <div class="fc-log-detail">
            <div v-for="(line, i) in parsedDetail(l)" :key="i" class="fc-log-line">
              <span class="t">{{ line.time }}</span>
              <span class="lv" :class="line.level">{{ line.level }}</span>
              <span>{{ line.text }}</span>
            </div>
            <div v-if="parsedDetail(l).length === 0" class="fc-empty">{{ l.message || '无明细' }}</div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="fc-empty" style="padding:40px">正在加载…</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGmData, formatTime, api } from '../useData'
import { toast } from '../toast'

const { data, mutate, refresh } = useGmData()

const statusFilter = ref('')
const taskFilter = ref('')
const expanded = ref<Record<number, boolean>>({})
const detailCache = ref<Record<number, string>>({})
const loadingDetail = ref(false)

const taskOptions = computed(() => {
  const set = new Set<string>()
  for (const l of data.value?.logs || []) if (l.taskName) set.add(l.taskName)
  return [...set]
})

const filtered = computed(() => {
  let list = [...(data.value?.logs || [])]
  if (statusFilter.value) list = list.filter((l) => l.status === statusFilter.value)
  if (taskFilter.value) list = list.filter((l) => l.taskName === taskFilter.value)
  return list
})

const statusLabel = (s: string) => ({ running: '运行中', success: '成功', failed: '失败', stopped: '已停止' } as Record<string, string>)[s] || s

// 明细按需从服务端拉取（快照不携带 detail，减小体积）
function parsedDetail(l: any): { time: string, level: string, text: string }[] {
  try {
    return JSON.parse(detailCache.value[l.id] || '[]')
  } catch {
    return []
  }
}

function toggleDetail(l: any) {
  expanded.value[l.id] = !expanded.value[l.id]
  if (expanded.value[l.id] && !detailCache.value[l.id]) loadDetail(l)
}

async function loadDetail(l: any) {
  loadingDetail.value = true
  const res: any = await api('mywl-auto/log-detail', { id: l.id })
  loadingDetail.value = false
  if (res?.ok) detailCache.value[l.id] = res.detail || '[]'
  else toast.error(res?.error || '加载明细失败')
}

async function clearLogs() {
  if (!confirm('确定清空全部执行日志？')) return
  const res = await mutate('log.clear')
  if (res?.ok) toast.success('日志已清空')
  else toast.error(res?.error || '清空失败')
}
</script>