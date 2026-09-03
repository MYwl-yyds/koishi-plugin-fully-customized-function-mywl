import { Context } from '@koishijs/client'
import './styles.css'
import App from './App.vue'

export default (ctx: Context) => {
  ctx.page({
    name: '全自定义功能',
    path: '/mywl-auto',
    // 仅权限等级 >= 3（管理员）可见；启用 auth 插件后非登录/非管理员不可访问
    authority: 3,
    fields: ['mywl-auto'] as any,
    component: App,
  })
}