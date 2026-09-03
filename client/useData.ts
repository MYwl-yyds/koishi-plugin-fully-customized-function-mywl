import { ref } from 'vue'
import { store, send } from '@koishijs/client'

// 原始 send 调用（供按需接口，如日志明细）
export const api = send as any

// 共享数据获取与变更封装
export function useGmData() {
  const data = ref<any>(store['mywl-auto'] ?? null)

  // 刷新请求合并去重：短时间内的重复 refresh 复用同一个在途请求，避免并发冗余请求
  let inflightRefresh: Promise<any> | null = null
  function refresh(): Promise<any> {
    if (!inflightRefresh) {
      inflightRefresh = api('mywl-auto/refresh')
        .then((snap: any) => { data.value = snap; return snap })
        .finally(() => { inflightRefresh = null })
    }
    return inflightRefresh
  }

  async function mutate(action: string, payload: any = {}) {
    const res: any = await api('mywl-auto/mutate', { action, data: payload })
    if (res?.ok && res.snapshot) data.value = res.snapshot
    return res
  }

  return { data, refresh, mutate }
}

export function formatTime(v: string | Date | number | undefined): string {
  if (!v) return '-'
  const d = new Date(String(v).replace(' ', 'T') + (String(v).length < 20 ? 'Z' : ''))
  if (isNaN(d.getTime())) return String(v)
  return d.toLocaleString()
}