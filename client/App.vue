<template>
  <k-layout>
    <div class="fc-shell">
      <nav class="fc-tabs">
        <div class="fc-tabs-inner">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="fc-tab"
            :class="{ active: current === tab.key }"
            @click="current = tab.key"
          >{{ tab.label }}</button>
        </div>
        <div class="fc-theme">
          <span class="fc-theme-label">主题</span>
          <select v-model="theme" @change="applyTheme">
            <option value="indigo">靛蓝</option>
            <option value="emerald">翡翠</option>
            <option value="rose">玫瑰</option>
            <option value="sunset">日落</option>
            <option value="ocean">海洋</option>
            <option value="dark">深色</option>
          </select>
        </div>
      </nav>

      <div class="fc-body">
        <Tasks v-if="current === 'tasks'" />
        <Logs v-else />
      </div>
    </div>

    <transition-group name="fc-toast" tag="div" class="fc-toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="fc-toast" :class="t.type">{{ t.text }}</div>
    </transition-group>
  </k-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Tasks from './pages/Tasks.vue'
import Logs from './pages/Logs.vue'
import { toasts } from './toast'

const tabs = [
  { key: 'tasks', label: '任务编排' },
  { key: 'logs', label: '执行日志' },
]

const current = ref('tasks')
const theme = ref(localStorage.getItem('fc-theme') || 'indigo')

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('fc-theme', theme.value)
}
applyTheme()
</script>