<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'

interface SchedulerTask {
  name: string
  kind: 'timeout' | 'interval' | string
  delayMs: number
  createdAt: number
  nextRunAt: number
  lastRunAt: number
  runCount: number
  running: boolean
  preventOverlap: boolean
}

interface SchedulerScope {
  namespace: string
  createdAt: number
  taskCount: number
  tasks: SchedulerTask[]
}

interface SchedulerSnapshot {
  schedulerCount: number
  schedulers: SchedulerScope[]
}

const accountStore = useAccountStore()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const loading = ref(false)
const refreshedAt = ref(0)
const runtime = ref<SchedulerSnapshot | null>(null)
const worker = ref<SchedulerSnapshot | null>(null)
const workerError = ref('')
let refreshTimer: number | undefined

const runtimeScopes = computed(() => runtime.value?.schedulers || [])
const workerScopes = computed(() => worker.value?.schedulers || [])
const runtimeTaskCount = computed(() => runtimeScopes.value.reduce((total, scope) => total + scope.taskCount, 0))
const workerTaskCount = computed(() => workerScopes.value.reduce((total, scope) => total + scope.taskCount, 0))
const activeTaskCount = computed(() => [...runtimeScopes.value, ...workerScopes.value]
  .flatMap(scope => scope.tasks)
  .filter(task => task.running)
  .length)

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000))
  if (seconds < 60)
    return `${seconds} 秒`
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} 分钟`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`
}

function formatDate(timestamp: number) {
  if (!timestamp)
    return '尚未执行'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatNextRun(task: SchedulerTask) {
  if (!task.nextRunAt)
    return '等待调度'
  const delta = task.nextRunAt - Date.now()
  if (delta <= 0)
    return task.running ? '执行中' : '即将执行'
  return `${formatDuration(delta)} 后`
}

async function loadScheduler() {
  loading.value = true
  try {
    const response = await api.get('/api/scheduler')
    const data = response.data?.data || {}
    runtime.value = data.runtime || null
    worker.value = data.worker || null
    workerError.value = String(data.workerError || '')
    refreshedAt.value = Date.now()
  }
  catch {
    runtime.value = null
    worker.value = null
    workerError.value = '暂时无法读取调度状态'
  }
  finally {
    loading.value = false
  }
}

watch(currentAccountId, () => {
  loadScheduler()
})

onMounted(() => {
  loadScheduler()
  refreshTimer = window.setInterval(loadScheduler, 15000)
})

onUnmounted(() => {
  if (refreshTimer)
    window.clearInterval(refreshTimer)
})
</script>

<template>
  <div class="ds-page space-y-5">
    <PageHeader title="调度中心" subtitle="查看自动化任务的运行状态，不会修改账号或策略">
      <template #actions>
        <BaseButton :loading="loading" variant="secondary" aria-label="刷新调度状态" @click="loadScheduler">
          <div v-if="!loading" class="i-carbon-renew text-base" />
          刷新
        </BaseButton>
      </template>
    </PageHeader>

    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="ds-surface p-4">
        <div class="text-sm text-[var(--color-text-secondary)]">当前账号</div>
        <div class="mt-2 truncate text-lg font-semibold">{{ currentAccount?.nick || currentAccount?.name || '未选择账号' }}</div>
      </div>
      <div class="ds-surface p-4">
        <div class="text-sm text-[var(--color-text-secondary)]">运行时任务</div>
        <div class="mt-2 text-lg font-semibold">{{ runtimeTaskCount }}</div>
      </div>
      <div class="ds-surface p-4">
        <div class="text-sm text-[var(--color-text-secondary)]">账号任务</div>
        <div class="mt-2 text-lg font-semibold">{{ workerTaskCount }}</div>
      </div>
      <div class="ds-surface p-4">
        <div class="text-sm text-[var(--color-text-secondary)]">正在执行</div>
        <div class="mt-2 text-lg font-semibold" :class="activeTaskCount ? 'text-emerald-600 dark:text-emerald-400' : ''">{{ activeTaskCount }}</div>
      </div>
    </section>

    <div v-if="workerError" class="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      {{ workerError }}
    </div>

    <div v-if="!loading && !runtimeScopes.length && !workerScopes.length" class="ds-surface">
      <EmptyState icon="i-carbon-time" title="暂无可展示的调度任务" description="启动一个账号后，这里会显示巡查、奖励和好友任务的计划状态。" />
    </div>

    <section v-if="runtimeScopes.length" class="space-y-3">
      <div class="flex items-center gap-2">
        <div class="i-carbon-server-proxy text-lg text-[var(--theme-primary)]" />
        <h2 class="text-base font-semibold">面板运行时</h2>
      </div>
      <div v-for="scope in runtimeScopes" :key="`runtime-${scope.namespace}`" class="ds-surface overflow-hidden">
        <div class="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
          <span class="font-medium">{{ scope.namespace }}</span>
          <span class="text-sm text-[var(--color-text-secondary)]">{{ scope.taskCount }} 项任务</span>
        </div>
        <div class="divide-y divide-[var(--color-border-default)]">
          <div v-for="task in scope.tasks" :key="task.name" class="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
            <div class="min-w-0"><div class="truncate font-medium">{{ task.name }}</div><div class="text-xs text-[var(--color-text-secondary)]">{{ task.kind === 'interval' ? '周期任务' : '一次任务' }} · 间隔 {{ formatDuration(task.delayMs) }}</div></div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">状态：</span><span :class="task.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text-secondary)]'">{{ task.running ? '执行中' : '等待中' }}</span></div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">下次：</span>{{ formatNextRun(task) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">上次：</span>{{ formatDate(task.lastRunAt) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">次数：</span>{{ task.runCount }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="workerScopes.length" class="space-y-3">
      <div class="flex items-center gap-2">
        <div class="i-carbon-task text-lg text-emerald-600 dark:text-emerald-400" />
        <h2 class="text-base font-semibold">账号自动化</h2>
      </div>
      <div v-for="scope in workerScopes" :key="`worker-${scope.namespace}`" class="ds-surface overflow-hidden">
        <div class="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
          <span class="font-medium">{{ scope.namespace }}</span>
          <span class="text-sm text-[var(--color-text-secondary)]">{{ scope.taskCount }} 项任务</span>
        </div>
        <div class="divide-y divide-[var(--color-border-default)]">
          <div v-for="task in scope.tasks" :key="task.name" class="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
            <div class="min-w-0"><div class="truncate font-medium">{{ task.name }}</div><div class="text-xs text-[var(--color-text-secondary)]">{{ task.kind === 'interval' ? '周期任务' : '一次任务' }} · 间隔 {{ formatDuration(task.delayMs) }}</div></div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">状态：</span><span :class="task.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text-secondary)]'">{{ task.running ? '执行中' : '等待中' }}</span></div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">下次：</span>{{ formatNextRun(task) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">上次：</span>{{ formatDate(task.lastRunAt) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">次数：</span>{{ task.runCount }}</div>
          </div>
        </div>
      </div>
    </section>

    <p v-if="refreshedAt" class="text-right text-xs text-[var(--color-text-secondary)]">最近刷新：{{ formatDate(refreshedAt) }} · 每 15 秒自动更新</p>
  </div>
</template>
