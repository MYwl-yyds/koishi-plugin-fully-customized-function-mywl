import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'
export interface ToastItem { id: number, type: ToastType, text: string }

export const toasts = reactive<ToastItem[]>([])

let seed = 0
function push(type: ToastType, text: string) {
  const id = ++seed
  toasts.push({ id, type, text })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, 3500)
}

export const toast = {
  success: (t: string) => push('success', t),
  error: (t: string) => push('error', t),
  info: (t: string) => push('info', t),
  warning: (t: string) => push('warning', t),
}