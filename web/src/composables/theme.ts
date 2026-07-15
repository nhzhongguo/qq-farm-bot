export type ThemeId
  = | 'light-blue'
    | 'light-green'
    | 'light-pink'
    | 'dark-blue'
    | 'dark-purple'
    | 'dark-teal'
    | 'dark-orange'
    | 'dark-red'

export interface ThemeDefinition {
  name: string
  isDark: boolean
  bg: string
  surface: string
  subtle: string
  elevated: string
  text: string
  textSecondary: string
  textTertiary: string
  border: string
  primary: string
  secondary: string
  primaryRgb: string
  gradient: string
  icon: string
}

export const THEME_KEY = 'ui_theme'
export const DEFAULT_THEME: ThemeId = 'light-blue'

export const THEME_CATALOG: Record<ThemeId, ThemeDefinition> = {
  'light-blue': {
    name: '极光蓝',
    isDark: false,
    bg: '#f4f7fb',
    surface: '#ffffff',
    subtle: '#eef2f7',
    elevated: '#ffffff',
    text: '#0f172a',
    textSecondary: '#475569',
    textTertiary: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.28)',
    primary: '#3b82f6',
    secondary: '#2563eb',
    primaryRgb: '59, 130, 246',
    gradient: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
    icon: 'i-carbon-sun',
  },
  'light-green': {
    name: '清新绿',
    isDark: false,
    bg: '#f3fbf6',
    surface: '#ffffff',
    subtle: '#e8f7ee',
    elevated: '#ffffff',
    text: '#052e16',
    textSecondary: '#166534',
    textTertiary: '#4ade80',
    border: 'rgba(34, 197, 94, 0.18)',
    primary: '#16a34a',
    secondary: '#15803d',
    primaryRgb: '22, 163, 74',
    gradient: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
    icon: 'i-carbon-sprout',
  },
  'light-pink': {
    name: '樱花粉',
    isDark: false,
    bg: '#fff5f9',
    surface: '#ffffff',
    subtle: '#ffe9f2',
    elevated: '#ffffff',
    text: '#831843',
    textSecondary: '#9d174d',
    textTertiary: '#f9a8d4',
    border: 'rgba(236, 72, 153, 0.18)',
    primary: '#ec4899',
    secondary: '#db2777',
    primaryRgb: '236, 72, 153',
    gradient: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
    icon: 'i-carbon-favorite',
  },
  'dark-blue': {
    name: '深空蓝',
    isDark: true,
    bg: '#0b1220',
    surface: '#111827',
    subtle: '#172033',
    elevated: '#1a2436',
    text: '#e5eefc',
    textSecondary: '#9fb0c7',
    textTertiary: '#6b7c94',
    border: 'rgba(148, 163, 184, 0.18)',
    primary: '#60a5fa',
    secondary: '#3b82f6',
    primaryRgb: '96, 165, 250',
    gradient: 'linear-gradient(135deg, #93c5fd 0%, #3b82f6 100%)',
    icon: 'i-carbon-moon',
  },
  'dark-purple': {
    name: '紫罗兰',
    isDark: true,
    bg: '#120f24',
    surface: '#1a1433',
    subtle: '#221b42',
    elevated: '#2a2154',
    text: '#f3e8ff',
    textSecondary: '#d8b4fe',
    textTertiary: '#a78bfa',
    border: 'rgba(168, 85, 247, 0.22)',
    primary: '#a855f7',
    secondary: '#9333ea',
    primaryRgb: '168, 85, 247',
    gradient: 'linear-gradient(135deg, #c084fc 0%, #9333ea 100%)',
    icon: 'i-carbon-star',
  },
  'dark-teal': {
    name: '青空夜',
    isDark: true,
    bg: '#071a1a',
    surface: '#0f2423',
    subtle: '#14312f',
    elevated: '#18403d',
    text: '#ccfbf1',
    textSecondary: '#99f6e4',
    textTertiary: '#5eead4',
    border: 'rgba(45, 212, 191, 0.2)',
    primary: '#14b8a6',
    secondary: '#0d9488',
    primaryRgb: '20, 184, 166',
    gradient: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
    icon: 'i-carbon-tree',
  },
  'dark-orange': {
    name: '暖阳橙',
    isDark: true,
    bg: '#1c1410',
    surface: '#261c16',
    subtle: '#32241c',
    elevated: '#3d2c21',
    text: '#ffedd5',
    textSecondary: '#fdba74',
    textTertiary: '#fb923c',
    border: 'rgba(251, 146, 60, 0.22)',
    primary: '#f59e0b',
    secondary: '#d97706',
    primaryRgb: '245, 158, 11',
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
    icon: 'i-carbon-sun',
  },
  'dark-red': {
    name: '绯红夜',
    isDark: true,
    bg: '#160b10',
    surface: '#1f1016',
    subtle: '#2a141d',
    elevated: '#351925',
    text: '#ffe4e6',
    textSecondary: '#fda4af',
    textTertiary: '#fb7185',
    border: 'rgba(244, 63, 94, 0.22)',
    primary: '#f43f5e',
    secondary: '#e11d48',
    primaryRgb: '244, 63, 94',
    gradient: 'linear-gradient(135deg, #fb7185 0%, #e11d48 100%)',
    icon: 'i-carbon-fire',
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in THEME_CATALOG
}

export function resolveThemeId(value?: string | null): ThemeId {
  if (isThemeId(value))
    return value
  return DEFAULT_THEME
}

export function applyThemeToDocument(themeId: ThemeId | string | null | undefined) {
  if (typeof document === 'undefined')
    return resolveThemeId(themeId)

  const id = resolveThemeId(themeId)
  const theme = THEME_CATALOG[id]
  const root = document.documentElement

  root.style.setProperty('--theme-bg', theme.bg)
  root.style.setProperty('--theme-text', theme.text)
  root.style.setProperty('--theme-primary', theme.primary)
  root.style.setProperty('--theme-secondary', theme.secondary)
  root.style.setProperty('--theme-gradient', theme.gradient)
  root.style.setProperty('--theme-primary-rgb', theme.primaryRgb)
  root.style.setProperty('--theme-surface', theme.surface)
  root.style.setProperty('--theme-border', theme.border)

  root.style.setProperty('--color-bg-app', theme.bg)
  root.style.setProperty('--color-bg-surface', theme.surface)
  root.style.setProperty('--color-bg-subtle', theme.subtle)
  root.style.setProperty('--color-bg-elevated', theme.elevated)
  root.style.setProperty('--color-text-primary', theme.text)
  root.style.setProperty('--color-text-secondary', theme.textSecondary)
  root.style.setProperty('--color-text-tertiary', theme.textTertiary)
  root.style.setProperty('--color-border-default', theme.border)
  root.style.setProperty('--color-ring', `rgba(${theme.primaryRgb}, 0.28)`)

  root.style.setProperty('--color-brand-500', theme.primary)
  root.style.setProperty('--color-brand-600', theme.secondary)

  if (theme.isDark)
    root.classList.add('dark')
  else
    root.classList.remove('dark')

  return id
}
