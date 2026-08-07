<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { cachedGet } from '@/utils/request'

interface TrendPoint {
  date: string
  gold: number
  exp: number
  goldGained: number
  expGained: number
  operations: Record<string, number>
  savedAt: number
}

const accountStore = useAccountStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const loading = ref(false)
const loadError = ref('')
const range = ref(30)
const points = ref<TrendPoint[]>([])
const showRaw = ref(false)

const rangeOptions = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
]

const totalOperations = computed(() => points.value.map(p =>
  Object.values(p.operations || {}).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0),
))

const hasData = computed(() => points.value.length > 0)

async function loadTrend() {
  if (!currentAccountId.value)
    return
  loading.value = true
  try {
    const trend = await cachedGet<{ points: TrendPoint[] }>('/api/stats/trend', { days: range.value }, { ttl: 30000 })
    points.value = Array.isArray(trend.points) ? trend.points : []
  }
  catch (error: any) {
    points.value = []
    loadError.value = error?.response?.data?.error || error?.message || '无法读取收益趋势'
  }
  finally {
    loading.value = false
  }
}

onMounted(loadTrend)
watch([currentAccountId, range], loadTrend)

// ========== SVG 折线图 ==========
function buildPolyline(values: number[], width = 560, height = 160, pad = 8) {
  const n = values.length
  if (n === 0)
    return { points: '', area: '', max: 0, min: 0, step: 0 }
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const step = n > 1 ? innerW / (n - 1) : 0
  const coords = values.map((v, i) => {
    const x = n > 1 ? pad + i * step : width / 2
    const y = pad + innerH - ((v - min) / span) * innerH
    return { x, y }
  })
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const first = coords[0]
  const last = coords[coords.length - 1]
  const area = coords.length && first && last
    ? `${line} L${last.x.toFixed(1)},${height - pad} L${first.x.toFixed(1)},${height - pad} Z`
    : ''
  return { points: line, area, max, min, step }
}

function formatAxis(value: number) {
  if (value >= 1000000)
    return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000)
    return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}
</script>

<template>
  <div class="ds-page">
    <PageHeader title="收益统计" subtitle="金币、经验与操作数的历史趋势" />

    <EmptyState
      v-if="!currentAccountId"
      icon="i-carbon-user-avatar"
      title="请选择账号"
      description="选择账号后即可查看收益统计"
    />

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <div class="i-carbon-data-set text-lg text-[var(--theme-primary)]" />
          <span class="text-[var(--color-text-primary)] font-medium">{{ currentAccount?.name }}</span>
        </div>
        <div class="flex overflow-hidden border border-[var(--color-border-default)] rounded-lg">
          <button
            v-for="option in rangeOptions"
            :key="option.value"
            class="px-4 py-1.5 text-sm font-medium transition-colors"
            :class="range === option.value
              ? 'text-white'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]'"
            :style="range === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="range = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <EmptyState v-if="loading" loading title="正在加载收益统计..." />

      <EmptyState
        v-else-if="loadError"
        error
        title="收益统计加载失败"
        :description="loadError"
        retry-text="重新加载"
        @retry="loadTrend"
      />

      <EmptyState
        v-else-if="!hasData"
        icon="i-carbon-chart-line"
        title="暂无统计历史"
        description="机器人运行并保存统计后，这里将展示金币、经验与操作数趋势"
      />

      <div v-else class="space-y-4">
        <!-- 汇总卡片 -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="ds-card p-4" style="border-color: color-mix(in srgb, var(--color-chart-gold) 38%, var(--color-border-default))">
            <div class="flex items-center gap-2 text-sm text-[var(--color-chart-gold)]">
              <div class="i-carbon-currency" />
              当前金币
            </div>
            <div class="mt-1 text-2xl text-[var(--color-text-primary)] font-bold">
              {{ formatAxis(points[points.length - 1]?.gold || 0) }}
            </div>
            <div class="mt-1 text-xs text-[var(--color-text-tertiary)]">
              周期内累计 +{{ formatAxis(points.reduce((s, p) => s + (p.goldGained || 0), 0)) }}
            </div>
          </div>
          <div class="ds-card p-4" style="border-color: color-mix(in srgb, var(--color-chart-purple) 38%, var(--color-border-default))">
            <div class="flex items-center gap-2 text-sm text-[var(--color-chart-purple)]">
              <div class="i-carbon-growth" />
              当前经验
            </div>
            <div class="mt-1 text-2xl text-[var(--color-text-primary)] font-bold">
              {{ formatAxis(points[points.length - 1]?.exp || 0) }}
            </div>
            <div class="mt-1 text-xs text-[var(--color-text-tertiary)]">
              周期内累计 +{{ formatAxis(points.reduce((s, p) => s + (p.expGained || 0), 0)) }}
            </div>
          </div>
          <div class="ds-card p-4" style="border-color: color-mix(in srgb, var(--color-chart-green) 38%, var(--color-border-default))">
            <div class="flex items-center gap-2 text-sm text-[var(--color-chart-green)]">
              <div class="i-carbon-catalog" />
              周期操作数
            </div>
            <div class="mt-1 text-2xl text-[var(--color-text-primary)] font-bold">
              {{ formatAxis(totalOperations.reduce((s, n) => s + n, 0)) }}
            </div>
            <div class="mt-1 text-xs text-[var(--color-text-tertiary)]">
              日均 {{ formatAxis(Math.round(totalOperations.reduce((s, n) => s + n, 0) / Math.max(points.length, 1))) }}
            </div>
          </div>
        </div>

        <!-- 金币趋势 -->
        <div class="ds-card p-4">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-[var(--color-text-primary)] font-semibold">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-chart-gold)] align-middle" />
              金币趋势
            </h3>
            <span class="text-xs text-[var(--color-text-tertiary)]">累计余额与每日增量</span>
          </div>
          <div class="flex flex-wrap items-start gap-1">
            <svg viewBox="0 0 560 160" class="chart-svg max-w-full min-w-0 w-full flex-1" preserveAspectRatio="none">
              <defs>
                <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--color-chart-gold)" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="var(--color-chart-gold)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <g v-if="points.length">
                <path :d="buildPolyline(points.map(p => p.gold)).area" fill="url(#goldArea)" />
                <polyline
                  :points="buildPolyline(points.map(p => p.gold)).points"
                  fill="none"
                  stroke="var(--color-chart-gold)"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </g>
            </svg>
          </div>
          <div class="mt-1 flex justify-between text-[10px] text-[var(--color-text-tertiary)]">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
          </div>
        </div>

        <!-- 经验趋势 -->
        <div class="ds-card p-4">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-[var(--color-text-primary)] font-semibold">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-chart-purple)] align-middle" />
              经验趋势
            </h3>
            <span class="text-xs text-[var(--color-text-tertiary)]">累计经验与每日增量</span>
          </div>
          <svg viewBox="0 0 560 160" class="chart-svg w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="expArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--color-chart-purple)" stop-opacity="0.25" />
                <stop offset="100%" stop-color="var(--color-chart-purple)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <g v-if="points.length">
              <path :d="buildPolyline(points.map(p => p.exp)).area" fill="url(#expArea)" />
              <polyline
                :points="buildPolyline(points.map(p => p.exp)).points"
                fill="none"
                stroke="var(--color-chart-purple)"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            </g>
          </svg>
          <div class="mt-1 flex justify-between text-[10px] text-[var(--color-text-tertiary)]">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
          </div>
        </div>

        <!-- 每日操作数 -->
        <div class="ds-card p-4">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-[var(--color-text-primary)] font-semibold">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-chart-green)] align-middle" />
              每日操作数
            </h3>
            <span class="text-xs text-[var(--color-text-tertiary)]">收获/种植/偷菜/任务等操作合计</span>
          </div>
          <svg viewBox="0 0 560 160" class="chart-svg w-full" preserveAspectRatio="none">
            <g v-if="totalOperations.length">
              <rect
                v-for="(value, index) in totalOperations"
                :key="index"
                :x="index * (560 / Math.max(totalOperations.length, 1)) + 2"
                :y="160 - Math.max(value, 1) / Math.max(...totalOperations, 1) * 150"
                :width="Math.max(560 / Math.max(totalOperations.length, 1) - 4, 1)"
                :height="Math.max(value, 1) / Math.max(...totalOperations, 1) * 150"
                fill="color-mix(in srgb, var(--color-chart-green) 55%, transparent)"
                rx="1"
              />
            </g>
          </svg>
          <div class="mt-1 flex justify-between text-[10px] text-[var(--color-text-tertiary)]">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
          </div>
        </div>

        <!-- 数值明细：窄屏 / 无渲染时的文本兜底 -->
        <div class="ds-card p-4">
          <div class="mb-2 flex items-center justify-between gap-3">
            <h3 class="text-sm text-[var(--color-text-primary)] font-semibold">
              数值明细
            </h3>
            <button
              type="button"
              class="ds-chip"
              :aria-expanded="showRaw"
              @click="showRaw = !showRaw"
            >
              {{ showRaw ? '收起明细' : '查看数值明细' }}
            </button>
          </div>
          <div v-if="showRaw" class="overflow-x-auto">
            <table class="w-full text-xs text-[var(--color-text-secondary)] tabular-nums">
              <thead class="text-[var(--color-text-tertiary)]">
                <tr>
                  <th class="py-1 pr-3 text-left font-medium">
                    日期
                  </th>
                  <th class="py-1 pr-3 text-right font-medium">
                    金币（当日增量）
                  </th>
                  <th class="py-1 pr-3 text-right font-medium">
                    经验（当日增量）
                  </th>
                  <th class="py-1 text-right font-medium">
                    操作数
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in points" :key="p.date || i" class="border-t border-[var(--color-border-default)]">
                  <td class="py-1.5 pr-3">
                    {{ p.date }}
                  </td>
                  <td class="py-1.5 pr-3 text-right">
                    {{ formatAxis(p.gold) }}<span class="text-[var(--color-text-tertiary)]">（+{{ formatAxis(p.goldGained || 0) }}）</span>
                  </td>
                  <td class="py-1.5 pr-3 text-right">
                    {{ formatAxis(p.exp) }}<span class="text-[var(--color-text-tertiary)]">（+{{ formatAxis(p.expGained || 0) }}）</span>
                  </td>
                  <td class="py-1.5 text-right">
                    {{ formatAxis(Object.values(p.operations || {}).reduce((s, n) => s + (Number(n) || 0), 0)) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-svg {
  height: 180px;
}

@media (max-width: 640px) {
  .chart-svg {
    height: 120px;
  }
}
</style>
