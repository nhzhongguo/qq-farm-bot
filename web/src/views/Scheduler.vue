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

interface TaskRun {
  id: string
  accountId: string
  taskName: string
  trigger: string
  status: 'running' | 'success' | 'failed'
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  error: string | null
}

const accountStore = useAccountStore()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const loading = ref(false)
const refreshedAt = ref(0)
const runtime = ref<SchedulerSnapshot | null>(null)
const worker = ref<SchedulerSnapshot | null>(null)
const workerError = ref('')
const taskRuns = ref<TaskRun[]>([])
const historyError = ref('')
let refreshTimer: number | undefined

const taskLabels: Record<string, string> = {
  daily_routine: '每日奖励',
  email_check: '邮箱检查',
  farm_check: '农场巡查',
  fertilizer_apply: '自动施肥',
  fertilizer_gifts: '化肥礼包',
  friend_bad_startup: '启动捣乱',
  friend_help: '好友帮助',
  friend_steal: '好友偷菜',
  task_claim: '每日任务',
}

const triggerLabels: Record<string, string> = {
  config: '配置变更',
  scheduler: '定时调度',
  startup: '账号启动',
}

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

function formatHistoryDate(timestamp: number) {
  if (!timestamp)
    return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatRunDuration(milliseconds: number | null) {
  if (milliseconds == null)
    return '执行中'
  if (milliseconds < 1000)
    return `${milliseconds} 毫秒`
  return formatDuration(milliseconds)
}

function getTaskLabel(taskName: string) {
  return taskLabels[taskName] || taskName
}

function getTriggerLabel(trigger: string) {
  return triggerLabels[trigger] || trigger
}

function getStatusLabel(status: TaskRun['status']) {
  return status === 'success' ? '成功' : status === 'failed' ? '失败' : '执行中'
}

function getStatusClass(status: TaskRun['status']) {
  return status === 'success'
    ? 'text-emerald-600 dark:text-emerald-400'
    : status === 'failed'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400'
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
  const [schedulerResult, historyResult] = await Promise.allSettled([
    api.get('/api/scheduler'),
    api.get('/api/task-runs', { params: { limit: 50 } }),
  ])
  if (schedulerResult.status === 'fulfilled') {
    const data = schedulerResult.value.data?.data || {}
    runtime.value = data.runtime || null
    worker.value = data.worker || null
    workerError.value = String(data.workerError || '')
  }
  else {
    runtime.value = null
    worker.value = null
    workerError.value = '暂时无法读取调度状态'
  }
  if (historyResult.status === 'fulfilled') {
    const runs = historyResult.value.data?.data?.runs
    taskRuns.value = Array.isArray(runs) ? runs : []
    historyError.value = ''
  }
  else {
    taskRuns.value = []
    historyError.value = '暂时无法读取执行历史'
  }
  refreshedAt.value = Date.now()
  loading.value = false
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

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <div class="i-carbon-time text-lg text-[var(--theme-primary)]" />
        <h2 class="text-base font-semibold">最近执行</h2>
      </div>

      <div v-if="historyError" class="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        {{ historyError }}
      </div>
      <div v-else-if="!loading && !taskRuns.length" class="ds-surface">
        <EmptyState icon="i-carbon-time" title="暂无执行记录" description="账号任务完成后，成功和失败结果会保留在这里。" />
      </div>
      <div v-else-if="taskRuns.length" class="ds-surface overflow-hidden">
        <div class="hidden grid-cols-[minmax(0,1.3fr)_minmax(7rem,0.8fr)_minmax(5rem,0.55fr)_minmax(9rem,0.9fr)_minmax(6rem,0.6fr)] gap-3 border-b border-[var(--color-border-default)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] md:grid">
          <span>任务</span>
          <span>触发方式</span>
          <span>状态</span>
          <span>开始时间</span>
          <span>耗时</span>
        </div>
        <div class="divide-y divide-[var(--color-border-default)]">
          <div v-for="run in taskRuns" :key="run.id" class="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(7rem,0.8fr)_minmax(5rem,0.55fr)_minmax(9rem,0.9fr)_minmax(6rem,0.6fr)] md:gap-3">
            <div class="min-w-0">
              <div class="truncate font-medium" :title="getTaskLabel(run.taskName)">{{ getTaskLabel(run.taskName) }}</div>
              <div v-if="run.error" class="mt-1 break-words text-xs text-red-600 dark:text-red-400" :title="run.error">{{ run.error }}</div>
            </div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">触发：</span>{{ getTriggerLabel(run.trigger) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">状态：</span><span class="font-medium" :class="getStatusClass(run.status)">{{ getStatusLabel(run.status) }}</span></div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">开始：</span>{{ formatHistoryDate(run.startedAt) }}</div>
            <div><span class="text-[var(--color-text-secondary)] md:hidden">耗时：</span>{{ formatRunDuration(run.durationMs) }}</div>
          </div>
        </div>
      </div>
    </section>

    <p v-if="refreshedAt" class="text-right text-xs text-[var(--color-text-secondary)]">最近刷新：{{ formatDate(refreshedAt) }} · 每 15 秒自动更新</p>
  </div>
</template>
