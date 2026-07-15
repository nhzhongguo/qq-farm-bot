import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  resolveThemeId,
  THEME_CATALOG,
  THEME_KEY,
  type ThemeId,
} from '@/composables/theme'

export type Theme = ThemeId

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const currentTheme = ref<Theme>(resolveThemeId(localStorage.getItem(THEME_KEY)))
  const showThemePanel = ref(false)
  const themes = THEME_CATALOG

  const isDark = computed(() => !!themes[currentTheme.value]?.isDark)
  const themeMeta = computed(() => themes[currentTheme.value] || themes[DEFAULT_THEME])

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  async function fetchTheme() {
    try {
      const res = await api.get('/api/settings')
      if (res.data.ok && res.data.data.ui?.theme) {
        // Prefer local user choice; server theme is optional future sync.
      }
    }
    catch {
      // silent when unauthenticated
    }
  }

  function applyTheme(theme: Theme | string) {
    const id = applyThemeToDocument(theme)
    currentTheme.value = id
    localStorage.setItem(THEME_KEY, id)
  }

  function toggleThemePanel() {
    showThemePanel.value = !showThemePanel.value
  }

  function toggleDark() {
    if (themes[currentTheme.value]?.isDark)
      applyTheme('light-blue')
    else
      applyTheme('dark-blue')
  }

  // Initialize once for store consumers
  applyTheme(currentTheme.value)

  return {
    sidebarOpen,
    currentTheme,
    showThemePanel,
    themes,
    isDark,
    themeMeta,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    fetchTheme,
    applyTheme,
    toggleThemePanel,
    toggleDark,
  }
})
