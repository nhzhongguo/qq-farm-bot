<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

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
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const loading = ref(false)
const range = ref(30)
const points = ref<TrendPoint[]>([])

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
    const { data } = await api.get('/api/stats/trend', {
      params: { days: range.value },
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (data?.ok && data.data) {
      points.value = Array.isArray(data.data.points) ? data.data.points : []
    }
    else {
      points.value = []
      if (data?.error)
        toast.error(String(data.error))
    }
  }
  catch (error: any) {
    points.value = []
    toast.error(error?.response?.data?.error || '无法读取收益趋势')
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

    <div v-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看收益统计
    </div>

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div class="i-carbon-data-set text-lg text-[var(--theme-primary)]" />
          <span class="text-gray-800 font-medium dark:text-gray-200">{{ currentAccount?.name }}</span>
        </div>
        <div class="flex overflow-hidden border border-gray-200 rounded-lg dark:border-gray-600">
          <button
            v-for="option in rangeOptions"
            :key="option.value"
            class="px-4 py-1.5 text-sm font-medium transition-colors"
            :class="range === option.value
              ? 'text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
            :style="range === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="range = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center py-16">
        <div class="i-svg-spinners-90-ring-with-bg text-4xl text-[var(--theme-primary)]" />
      </div>

      <div v-else-if="!hasData" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
        <div class="mb-2 text-3xl">
          <div class="i-carbon-chart-line inline-block" />
        </div>
        暂无统计历史。机器人运行并保存统计后，这里将展示金币、经验与操作数趋势。
      </div>

      <div v-else class="space-y-4">
        <!-- 汇总卡片 -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="border border-amber-200 rounded-lg bg-white p-4 dark:border-amber-900 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <div class="i-carbon-currency" />
              当前金币
            </div>
            <div class="mt-1 text-2xl text-gray-900 font-bold dark:text-white">
              {{ formatAxis(points[points.length - 1]?.gold || 0) }}
            </div>
            <div class="mt-1 text-xs text-gray-400">
              周期内累计 +{{ formatAxis(points.reduce((s, p) => s + (p.goldGained || 0), 0)) }}
            </div>
          </div>
          <div class="border border-purple-200 rounded-lg bg-white p-4 dark:border-purple-900 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400">
              <div class="i-carbon-growth" />
              当前经验
            </div>
            <div class="mt-1 text-2xl text-gray-900 font-bold dark:text-white">
              {{ formatAxis(points[points.length - 1]?.exp || 0) }}
            </div>
            <div class="mt-1 text-xs text-gray-400">
              周期内累计 +{{ formatAxis(points.reduce((s, p) => s + (p.expGained || 0), 0)) }}
            </div>
          </div>
          <div class="border border-green-200 rounded-lg bg-white p-4 dark:border-green-900 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <div class="i-carbon-catalog" />
              周期操作数
            </div>
            <div class="mt-1 text-2xl text-gray-900 font-bold dark:text-white">
              {{ formatAxis(totalOperations.reduce((s, n) => s + n, 0)) }}
            </div>
            <div class="mt-1 text-xs text-gray-400">
              日均 {{ formatAxis(Math.round(totalOperations.reduce((s, n) => s + n, 0) / Math.max(points.length, 1))) }}
            </div>
          </div>
        </div>

        <!-- 金币趋势 -->
        <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-500 align-middle" />
              金币趋势
            </h3>
            <span class="text-xs text-gray-400">累计余额与每日增量</span>
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
          <div class="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
          </div>
        </div>

        <!-- 经验趋势 -->
        <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-purple-500 align-middle" />
              经验趋势
            </h3>
            <span class="text-xs text-gray-400">累计经验与每日增量</span>
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
          <div class="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
          </div>
        </div>

        <!-- 每日操作数 -->
        <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
              <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-500 align-middle" />
              每日操作数
            </h3>
            <span class="text-xs text-gray-400">收获/种植/偷菜/任务等操作合计</span>
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
          <div class="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>{{ points[0]?.date || '' }}</span>
            <span>{{ points[points.length - 1]?.date || '' }}</span>
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
