<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { cachedGet } from '@/utils/request'

type ReportType = 'daily' | 'weekly' | 'compare'

interface ReportSummary {
  [key: string]: number | undefined
}

interface TrendPoint {
  date: string
  goldGained: number
  expGained: number
}

interface IssueItem {
  taskName: string
  startedAt: number
  error: string
}

interface ReportData {
  accountId: string
  period: 'daily' | 'weekly'
  range: { start: string, end: string }
  summary: ReportSummary
  operations: Record<string, number>
  trend: TrendPoint[]
  issues: IssueItem[]
}

interface CompareAccount {
  accountId: string
  summary: ReportSummary
}

interface CompareData {
  period: 'compare'
  range: { start: string, end: string, days: number }
  accounts: CompareAccount[]
}

type ReportPayload = ReportData | CompareData

const accountStore = useAccountStore()
const toast = useToastStore()
const { accounts, currentAccountId } = storeToRefs(accountStore)

const reportType = ref<ReportType>('daily')
const dailyDate = ref('')
const weekStart = ref('')
const weekEnd = ref('')
const compareDays = ref(7)
const compareAccountIds = ref<string[]>([])

const loading = ref(false)
const payload = ref<ReportPayload | null>(null)
const errorMsg = ref('')

const typeOptions: Array<{ value: ReportType, label: string }> = [
  { value: 'daily', label: '日报' },
  { value: 'weekly', label: '周报' },
  { value: 'compare', label: '多账号对比' },
]

const daysOptions = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
]

function toDateKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function initDates() {
  const today = new Date()
  if (!dailyDate.value)
    dailyDate.value = toDateKey(today)
  if (!weekEnd.value)
    weekEnd.value = toDateKey(today)
  if (!weekStart.value)
    weekStart.value = toDateKey(addDays(today, -6))
}

function accountName(id: string) {
  return accounts.value.find(a => String(a.id) === id)?.name || id
}

const isCompare = computed(() => reportType.value === 'compare')

const currentParams = computed(() => {
  if (reportType.value === 'compare') {
    const ids = compareAccountIds.value.length ? compareAccountIds.value : (currentAccountId.value ? [currentAccountId.value] : [])
    return { type: 'compare', days: compareDays.value, accountIds: ids.join(',') }
  }
  if (reportType.value === 'weekly') {
    return { type: 'weekly', startDate: weekStart.value || undefined, endDate: weekEnd.value || undefined }
  }
  return { type: 'daily', date: dailyDate.value || undefined }
})

async function loadReport() {
  if (!currentAccountId.value && !isCompare.value) {
    payload.value = null
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const report = await cachedGet<ReportPayload>('/api/report', currentParams.value as Record<string, unknown>, { ttl: 60000 })
    if (report) {
      payload.value = report
    }
    payload.value = report || null
  }
  catch (error: any) {
    payload.value = null
    errorMsg.value = error?.response?.data?.error || error?.message || '无法生成报表'
  }
  finally {
    loading.value = false
  }
}

async function downloadJson() {
  if (!payload.value)
    return
  const blob = new Blob([JSON.stringify(payload.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const suffix = isCompare.value ? 'compare' : (payload.value as ReportData).accountId
  link.download = `report-${reportType.value}-${suffix}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function openHtml() {
  try {
    const { data } = await api.get('/api/report/html', {
      params: currentParams.value,
      responseType: 'text',
    })
    const blob = new Blob([String(data)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || 'HTML 报表生成失败')
  }
}

const isComparePayload = (p: ReportPayload | null): p is CompareData => Boolean(p && p.period === 'compare')

const summaryRows = computed(() => {
  const p = payload.value
  if (!p || isComparePayload(p))
    return []
  const s = p.summary
  const order = ['goldGained', 'expGained', 'taskTotal', 'taskSuccess', 'taskFailed', 'issueCount', 'harvest', 'steal', 'taskClaim']
  const keys = order.filter(k => s[k] !== undefined)
  const rest = Object.keys(s).filter(k => !order.includes(k) && s[k] !== undefined).sort()
  const labels: Record<string, string> = {
    goldGained: '金币增量',
    expGained: '经验增量',
    taskTotal: '任务总数',
    taskSuccess: '任务成功',
    taskFailed: '任务失败',
    issueCount: '异常数',
    harvest: '收获',
    steal: '偷菜',
    taskClaim: '任务领取',
  }
  return [...keys, ...rest].map(k => ({ key: k, label: labels[k] || k, value: s[k] }))
})

const operationRows = computed(() => {
  const p = payload.value
  if (!p || isComparePayload(p))
    return []
  const ops = (p as ReportData).operations || {}
  return Object.entries(ops)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
})

const compareMetrics = computed(() => {
  const p = payload.value
  if (!isComparePayload(p))
    return { metrics: [] as string[], rows: [] as Array<{ accountId: string, name: string, values: Record<string, number | undefined> }> }
  const order = ['goldGained', 'expGained', 'taskTotal', 'taskSuccess', 'taskFailed', 'issueCount', 'harvest', 'steal', 'taskClaim']
  const labels: Record<string, string> = {
    goldGained: '金币增量',
    expGained: '经验增量',
    taskTotal: '任务总数',
    taskSuccess: '任务成功',
    taskFailed: '任务失败',
    issueCount: '异常数',
    harvest: '收获',
    steal: '偷菜',
    taskClaim: '任务领取',
  }
  const allKeys = new Set<string>()
  for (const acc of p.accounts) {
    for (const key of Object.keys(acc.summary)) {
      if (acc.summary[key] !== undefined)
        allKeys.add(key)
    }
  }
  const metrics = [...order.filter(k => allKeys.has(k)), ...[...allKeys].filter(k => !order.includes(k)).sort()]
  const rows = p.accounts.map(acc => ({
    accountId: acc.accountId,
    name: accountName(acc.accountId),
    values: acc.summary,
  }))
  return { metrics, labels, rows }
})

watch([currentAccountId, reportType], () => {
  if (currentAccountId.value || isCompare.value)
    loadReport()
})

onMounted(async () => {
  initDates()
  if (accounts.value.length === 0)
    await accountStore.fetchAccounts()
  if (currentAccountId.value)
    loadReport()
})
</script>

<template>
  <div class="ds-page">
    <PageHeader title="运营报表" subtitle="日报 / 周报 / 多账号对比，支持下载 JSON 与打印 HTML" />

    <EmptyState
      v-if="!currentAccountId && !isCompare"
      icon="i-carbon-user-avatar"
      title="请选择账号"
      description="选择账号后即可生成运营报表"
    />

    <div v-else>
      <!-- 报表类型切换 -->
      <div class="mb-4 flex flex-wrap gap-2">
        <BaseButton
          v-for="opt in typeOptions"
          :key="opt.value"
          :variant="reportType === opt.value ? 'primary' : 'secondary'"
          size="sm"
          @click="reportType = opt.value"
        >
          {{ opt.label }}
        </BaseButton>
      </div>

      <!-- 筛选区 -->
      <div class="mb-4 flex flex-wrap items-end gap-3 border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
        <BaseInput v-if="reportType === 'daily'" v-model="dailyDate" label="日期" type="date" />
        <template v-else-if="reportType === 'weekly'">
          <BaseInput v-model="weekStart" label="开始日期" type="date" />
          <BaseInput v-model="weekEnd" label="结束日期" type="date" />
        </template>
        <template v-else>
          <BaseSelect v-model="compareDays" label="对比窗口" :options="daysOptions" />
          <div class="flex flex-col gap-1.5">
            <span class="text-sm text-[var(--color-text-secondary)] font-medium">对比账号</span>
            <div class="max-w-md flex flex-wrap gap-2">
              <label
                v-for="acc in accounts"
                :key="acc.id"
                class="flex cursor-pointer items-center gap-1.5 border border-[var(--color-border-default)] rounded-lg px-2.5 py-1.5 text-sm"
                :class="compareAccountIds.includes(String(acc.id)) ? 'border-[var(--theme-primary)] bg-[rgba(var(--theme-primary-rgb),0.1)]' : 'bg-[var(--color-bg-subtle)]'"
              >
                <input
                  v-model="compareAccountIds"
                  type="checkbox"
                  :value="String(acc.id)"
                  class="accent-[var(--theme-primary)]"
                >
                <span>{{ acc.name }}</span>
              </label>
            </div>
          </div>
        </template>

        <BaseButton variant="primary" :loading="loading" @click="loadReport">
          生成报表
        </BaseButton>
        <BaseButton variant="secondary" :disabled="!payload" @click="downloadJson">
          下载 JSON
        </BaseButton>
        <BaseButton variant="outline" :disabled="!payload" @click="openHtml">
          打印 / HTML
        </BaseButton>
      </div>

      <!-- 错误态 -->
      <div v-if="errorMsg" class="mb-4 border border-[var(--color-danger)]/30 rounded-xl bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]">
        {{ errorMsg }}
      </div>

      <!-- 报表展示 -->
      <div v-if="loading" class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <div class="i-svg-spinners-ring-resize animate-spin text-lg text-[var(--theme-primary)]" />
        正在生成报表…
      </div>

      <EmptyState
        v-else-if="!payload"
        icon="i-carbon-report"
        title="暂无报表数据"
        description="点击「生成报表」查看运营数据"
      />

      <!-- 单账号报表 -->
      <div v-else-if="!isComparePayload(payload)" class="space-y-4">
        <div class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-[var(--color-text-primary)] font-semibold">
              {{ payload.period === 'weekly' ? '周报' : '日报' }}：{{ accountName(payload.accountId) }}
            </h3>
            <span class="text-sm text-[var(--color-text-secondary)]">
              {{ payload.range.start }} ~ {{ payload.range.end }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="row in summaryRows" :key="row.key" class="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2">
              <div class="text-xs text-[var(--color-text-secondary)]">
                {{ row.label }}
              </div>
              <div class="mt-0.5 text-lg text-[var(--color-text-primary)] font-semibold">
                {{ row.value ?? 0 }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="operationRows.length" class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
          <h4 class="mb-3 text-[var(--color-text-primary)] font-semibold">
            操作明细
          </h4>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="[op, count] in operationRows"
              :key="op"
              class="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-1.5 text-sm"
            >
              <span class="text-[var(--color-text-secondary)]">{{ op }}</span>
              <span class="ml-2 text-[var(--color-text-primary)] font-semibold">{{ count }}</span>
            </span>
          </div>
        </div>

        <div v-if="payload.issues.length" class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
          <h4 class="mb-3 text-[var(--color-text-primary)] font-semibold">
            异常明细（{{ payload.issues.length }}）
          </h4>
          <ul class="text-sm space-y-2">
            <li v-for="(issue, idx) in payload.issues" :key="idx" class="flex flex-col gap-0.5 rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2">
              <span class="text-[var(--color-text-primary)] font-medium">{{ issue.taskName }}</span>
              <span class="text-xs text-[var(--color-text-tertiary)]">
                {{ new Date(issue.startedAt).toLocaleString('zh-CN') }}
              </span>
              <span class="text-xs text-[var(--color-danger)]">{{ issue.error }}</span>
            </li>
          </ul>
        </div>

        <div v-if="payload.trend.length" class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
          <h4 class="mb-3 text-[var(--color-text-primary)] font-semibold">
            每日收益明细
          </h4>
          <div class="overflow-x-auto">
            <table class="min-w-[420px] w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-[var(--color-text-secondary)]">
                  <th class="pb-2 pr-4 font-medium">
                    日期
                  </th>
                  <th class="pb-2 pr-4 font-medium">
                    金币增量
                  </th>
                  <th class="pb-2 font-medium">
                    经验增量
                  </th>
                </tr>
              </thead>
              <tbody class="text-[var(--color-text-primary)]">
                <tr v-for="point in payload.trend" :key="point.date" class="border-t border-[var(--color-border-default)]">
                  <td class="py-2 pr-4">
                    {{ point.date }}
                  </td>
                  <td class="py-2 pr-4">
                    {{ point.goldGained }}
                  </td>
                  <td class="py-2">
                    {{ point.expGained }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 多账号对比 -->
      <div v-else class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-card)] p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-[var(--color-text-primary)] font-semibold">
            多账号对比（{{ payload.range.start }} ~ {{ payload.range.end }}）
          </h3>
          <span class="text-sm text-[var(--color-text-secondary)]">共 {{ payload.accounts.length }} 个账号</span>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-[480px] w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-[var(--color-text-secondary)]">
                <th class="pb-2 pr-4 font-medium">
                  指标
                </th>
                <th v-for="acc in payload.accounts" :key="acc.accountId" class="pb-2 pr-4 font-medium">
                  {{ accountName(acc.accountId) }}
                </th>
              </tr>
            </thead>
            <tbody class="text-[var(--color-text-primary)]">
              <tr v-for="metric in compareMetrics.metrics" :key="metric" class="border-t border-[var(--color-border-default)]">
                <td class="py-2 pr-4 text-[var(--color-text-secondary)]">
                  {{ (compareMetrics.labels || {})[metric] || metric }}
                </td>
                <td v-for="acc in payload.accounts" :key="acc.accountId" class="py-2 pr-4">
                  {{ acc.summary[metric] ?? 0 }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
