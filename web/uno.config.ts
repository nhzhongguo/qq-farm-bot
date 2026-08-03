import { defineConfig, presetAttributify, presetIcons, presetUno, presetWebFonts } from 'unocss'

export default defineConfig({
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        'src/**/*.{js,ts}',
      ],
    },
  },
  shortcuts: {
    'ds-btn-base': 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-180 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
    'ds-input-base': 'w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[var(--color-text-primary)] outline-none transition-all duration-180 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--theme-primary)] focus:shadow-[var(--shadow-glow)]',
    'ds-page-shell': 'ds-page',
  },
  theme: {
    colors: {
      brand: 'var(--theme-primary)',
      surface: 'var(--color-bg-surface)',
      app: 'var(--color-bg-app)',
      subtle: 'var(--color-bg-subtle)',
      fg: 'var(--color-text-primary)',
      muted: 'var(--color-text-secondary)',
      line: 'var(--color-border-default)',
    },
  },
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
      collections: {
        carbon: () => import('@iconify-json/carbon/icons.json').then(i => i.default),
        fas: () => import('@iconify-json/fa-solid/icons.json').then(i => i.default),
        'svg-spinners': () => import('@iconify-json/svg-spinners/icons.json').then(i => i.default),
      },
    }),
    presetWebFonts({
      // 离线构建：本地缓存字体，不依赖网络拉取（网络不可用时避免 build 失败）
      provider: 'none',
      fonts: {
        sans: 'DM Sans',
        mono: 'DM Mono',
      },
    }),
  ],
})
