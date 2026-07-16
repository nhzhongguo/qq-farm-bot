import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { applyThemeToDocument, resolveThemeId, THEME_KEY } from '@/composables/theme'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import App from './App.vue'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './styles/tokens.css'
import './style.css'

// Apply theme before first paint to avoid flash
applyThemeToDocument(resolveThemeId(localStorage.getItem(THEME_KEY)))

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

const toast = useToastStore()

app.config.errorHandler = (err: any, _instance, info) => {
  console.error('全局 Vue 错误:', err, info)
  const message = err.message || String(err)
  if (message.includes('ResizeObserver loop'))
    return
  toast.error('应用发生错误，请刷新页面后重试')
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason && typeof reason === 'object' && 'isAxiosError' in reason)
    return

  console.error('Unhandled Rejection:', reason)
  toast.error('操作未能完成，请稍后重试')
})

window.onerror = (message, _source, _lineno, _colno, error) => {
  console.error('Global Error:', message, error)
  if (String(message).includes('Script error'))
    return
  toast.error('系统发生错误，请刷新页面后重试')
}

const appStore = useAppStore()
appStore.fetchTheme()

app.mount('#app')
