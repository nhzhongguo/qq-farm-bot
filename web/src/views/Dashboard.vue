<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()
const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)
const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const clearingLogs = ref(false)

const allLogs = computed(() => {
  const sLogs = statusLogs.value || []
  const aLogs = (statusAccountLogs.value || []).map((l: any) => ({
    ts: new Date(l.time).getTime(),
    time: l.time,
    tag: l.action === 'Error' ? '错误' : '系统',
    msg: l.reason ? `${l.msg} (${l.reason})` : l.msg,
    isAccountLog: true,
  }))

  return [...sLogs, ...aLogs].sort((a: any, b: any) => a.ts - b.ts).filter((l: any) => !l.isAccountLog)
})

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
  isWarn: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword || filter.isWarn),
)

const modules = [
  { label: '所有模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '任务', value: 'task' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '所有事件', value: '' },
  { label: '农场巡查', value: 'farm_cycle' },
  { label: '收获作物', value: 'harvest_crop' },
  { label: '清理枯株', value: 'remove_plant' },
  { label: '种植种子', value: 'plant_seed' },
  { label: '施加化肥', value: 'fertilize' },
  { label: '土地推送', value: 'lands_notify' },
  { label: '选择种子', value: 'seed_pick' },
  { label: '购买种子', value: 'seed_buy' },
  { label: '购买化肥', value: 'fertilizer_buy' },
  { label: '开启礼包', value: 'fertilizer_gift_open' },
  { label: '获取任务', value: 'task_scan' },
  { label: '完成任务', value: 'task_claim' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: 'illustrated_rewards' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '土地升级', value: 'upgrade_land' },
  { label: '土地解锁', value: 'unlock_land' },
  { label: '好友巡查', value: 'friend_cycle' },
  { label: '访问好友', value: 'visit_friend' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(e => e.value).map(e => [e.value, e.label]),
)

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

const logs = [
  { label: '所有等级', value: '' },
  { label: '普通', value: 'info' },
  { label: '警告', value: 'warn' },
]

const displayName = computed(() => {
  const account = accountStore.currentAccount

  // Try to use nickname from status (game server)
  const gameName = status.value?.status?.name
  if (gameName) {
    // 如果有备注，显示为“昵称（备注）”
    if (account?.name) {
      return `${gameName} (${account.name})`
    }
    return gameName
  }

  // Check login status
  if (!status.value?.connection?.connected) {
    if (account) {
      // 如果有备注和昵称，显示为“昵称（备注）”
      if (account.name && account.nick) {
        return `${account.nick} (${account.name})`
      }
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  // Fallback to account name (usually ID) or '未命名'
  if (account) {
    // 如果有备注和昵称，显示为“昵称（备注）”
    if (account.name && account.nick) {
      return `${account.nick} (${account.name})`
    }
    return account.name || account.nick || '未命名'
  }
  return '未命名'
})

// Exp Rate & Time to Level
const expRate = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  if (!uptime)
    return '0/时'
  const hours = uptime / 3600
  const rate = hours > 0 ? (gain / hours) : 0
  return `${Math.floor(rate)}/时`
})

const timeToLevel = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  const current = status.value?.levelProgress?.current || 0
  const needed = status.value?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const hours = uptime / 3600
  const ratePerHour = hours > 0 ? (gain / hours) : 0
  if (ratePerHour <= 0)
    return ''

  const expNeeded = needed - current
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

// Fertilizer & Collection
const fertilizerNormal = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1012))
const collectionNormal = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 3001))
const collectionRare = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 3002))

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  const count = Number(item.count || 0)
  return `${(count / 3600).toFixed(1)}h`
}

// Next Check Countdown
const nextFarmCheck = ref('--:--:--')
const nextFriendCheck = ref('--:--:--')
const localUptime = ref(0)
let localNextFarmRemainSec = 0
let localNextFriendRemainSec = 0

function updateCountdowns() {
  // Update uptime
  if (!status.value?.connection?.connected) {
    nextFarmCheck.value = '账号未登录'
    nextFriendCheck.value = '账号未登录'
  }
  else {
    localUptime.value++
    if (localNextFarmRemainSec > 0) {
      localNextFarmRemainSec--
      nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
    }
    else {
      nextFarmCheck.value = '巡查中...'
    }

    if (localNextFriendRemainSec > 0) {
      localNextFriendRemainSec--
      nextFriendCheck.value = formatDuration(localNextFriendRemainSec)
    }
    else {
      nextFriendCheck.value = '巡查中...'
    }
  }
}

watch(status, (newVal) => {
  if (newVal?.nextChecks) {
    // Only update local counters if they are significantly different or 0
    // Actually, we should sync from server periodically.
    // Here we just take server value when it comes.
    localNextFarmRemainSec = newVal.nextChecks.farmRemainSec || 0
    localNextFriendRemainSec = newVal.nextChecks.friendRemainSec || 0
    updateCountdowns() // Update immediately
  }
  if (newVal?.uptime !== undefined) {
    localUptime.value = newVal.uptime
  }
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (d > 0)
    return `${d}天 ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  // 2024/5/20 12:34:56 -> 12:34:56
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut-out', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-warning-alt', color: 'text-red-400' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut-out', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-warning-alt', color: 'text-red-300' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500' },
}
const DEFAULT_OP_ICON = 'i-carbon-information'

const filteredOperations = computed(() => {
  const ops = status.value?.operations || {}
  const result: Record<string, number> = {}
  for (const key of Object.keys(ops)) {
    if (key !== 'upgrade' && key !== 'levelUp') {
      result[key] = ops[key]
    }
  }
  return result
})

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || DEFAULT_OP_ICON
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function getExpPercent(p: any) {
  if (!p || !p.needed)
    return 0
  return Math.min(100, Math.max(0, (p.current / p.needed) * 100))
}

async function refreshBag(force = false) {
  if (!currentAccountId.value)
    return
  if (!currentAccount.value?.running)
    return
  if (!status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return
  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refresh(forceReloadLogs = false) {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    // 首次加载、断线兜底时走 HTTP；连接正常时优先走 WS 实时推送
    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
      await statusStore.fetchAccountLogs()
    }

    if (forceReloadLogs || hasActiveLogFilter.value || !realtimeConnected.value) {
      await statusStore.fetchLogs(currentAccountId.value, {
        module: filter.module || undefined,
        event: filter.event || undefined,
        keyword: filter.keyword || undefined,
        isWarn: filter.isWarn === 'warn' ? true : filter.isWarn === 'info' ? false : undefined,
      })
    }

    // 仅在账号已运行且连接就绪后拉背包，避免启动阶段触发500
    await refreshBag()
  }
}

function onLogFilterChange() {
  refresh(true)
}

function onLogSearchTrigger() {
  refresh(true)
}

watch(currentAccountId, async () => {
  await refresh()
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected)
    refreshBag(true)
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

watch(hasActiveLogFilter, (enabled) => {
  statusStore.setRealtimeLogsEnabled(!enabled)
  refresh()
})

function onLogScroll(e: Event) {
  const el = e.target as HTMLElement
  if (!el)
    return
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  autoScroll.value = isNearBottom
}

async function clearLogs() {
  if (!currentAccountId.value)
    return
  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '请求失败'
    toastStore.error(`清空失败: ${msg}`)
  }
  finally {
    clearingLogs.value = false
  }
}

// Auto scroll logs
watch(allLogs, () => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}, { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(!hasActiveLogFilter.value)
  await refresh()
  scrollToBottom()
})

// Auto refresh fallback every 10s (WS 断开或筛选条件启用时会回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown timer (every 1s)
useIntervalFn(updateCountdowns, 1000)
</script>

<template>
  <div class="ds-page">
    <PageHeader
      title="运营概览"
      subtitle="实时查看账号状态、资产效率与运行日志"
    >
      <template #badges>
        <span class="ds-chip" :class="status?.connection?.connected ? 'ds-chip-success' : 'ds-chip-warning'">
          <div :class="status?.connection?.connected ? 'i-carbon-checkmark-filled' : 'i-carbon-warning'" />
          {{ status?.connection?.connected ? '账号已连接' : '账号未连接' }}
        </span>
        <span class="ds-chip" :class="realtimeConnected ? 'ds-chip-brand' : ''">
          <div :class="realtimeConnected ? 'i-carbon-wifi' : 'i-carbon-wifi-off'" />
          {{ realtimeConnected ? '实时通道在线' : '实时通道断开' }}
        </span>
      </template>
      <template #actions>
        <BaseButton variant="secondary" @click="refresh(true)">
          <div class="i-carbon-renew" />
          刷新
        </BaseButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <!-- Profile + assets -->
      <section class="ds-card p-5">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-stretch">
          <div class="min-w-0 flex-1">
            <div class="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <div class="i-carbon-user-avatar" />
              当前账号
            </div>
            <div class="truncate text-2xl font-bold tracking-tight" :title="displayName">
              {{ displayName }}
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span class="ds-chip ds-chip-brand">Lv.{{ status?.status?.level || 0 }}</span>
              <span class="ds-chip">效率 {{ expRate }}</span>
              <span class="ds-chip">{{ timeToLevel }}</span>
            </div>
            <div class="mt-5">
              <div class="mb-1.5 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                <span class="inline-flex items-center gap-1"><div class="i-fas-bolt text-[var(--theme-primary)]" /> EXP</span>
                <span>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{ width: `${getExpPercent(status?.levelProgress)}%`, backgroundImage: 'var(--theme-gradient)' }"
                />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 min-w-0 flex-1 gap-2">
            <div class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-subtle)] p-3">
              <div class="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                <div class="i-fas-coins text-yellow-500" />金币
              </div>
              <div class="mt-2 text-lg text-yellow-600 font-bold dark:text-yellow-400">
                {{ status?.status?.gold || 0 }}
              </div>
            </div>
            <div class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-subtle)] p-3">
              <div class="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                <div class="i-carbon-ticket text-sky-500" />点券
              </div>
              <div class="mt-2 text-lg font-bold">
                {{ status?.status?.coupon || 0 }}
              </div>
            </div>
            <div class="border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-subtle)] p-3">
              <div class="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                <div class="i-carbon-circle-filled text-amber-500" />金豆
              </div>
              <div class="mt-2 text-lg font-bold">
                {{ status?.status?.goldBean || 0 }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Next checks -->
      <section class="ds-card p-5">
        <div class="mb-4 flex items-center gap-2 text-lg font-semibold">
          <div class="i-carbon-hourglass text-[var(--theme-primary)]" />
          下次巡查
        </div>
        <div class="space-y-3">
          <div class="flex items-center justify-between rounded-xl bg-[var(--color-bg-subtle)] px-3 py-3">
            <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <div class="i-carbon-sprout text-[var(--color-success)]" />
              农场
            </div>
            <div class="text-base font-bold font-mono">
              {{ nextFarmCheck }}
            </div>
          </div>
          <div class="flex items-center justify-between rounded-xl bg-[var(--color-bg-subtle)] px-3 py-3">
            <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <div class="i-carbon-user-multiple text-[var(--theme-primary)]" />
              好友
            </div>
            <div class="text-base font-bold font-mono">
              {{ nextFriendCheck }}
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
      <!-- Logs -->
      <section class="ds-card min-h-[28rem] flex flex-col overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-[var(--color-border-default)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2 text-lg font-semibold">
            <div class="i-carbon-cloud-logging text-[var(--theme-primary)]" />
            运行日志
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <BaseSelect v-model="filter.module" class="w-36" :options="modules" @update:model-value="onLogFilterChange" />
            <BaseSelect v-model="filter.event" class="w-40" :options="events" @update:model-value="onLogFilterChange" />
            <BaseSelect v-model="filter.isWarn" class="w-32" :options="logs" @update:model-value="onLogFilterChange" />
            <BaseInput v-model="filter.keyword" class="w-40" placeholder="关键词" @keyup.enter="onLogSearchTrigger" />
            <BaseButton variant="secondary" size="sm" @click="onLogSearchTrigger">
              筛选
            </BaseButton>
            <BaseButton variant="danger" size="sm" :loading="clearingLogs" @click="clearLogs">
              清空
            </BaseButton>
          </div>
        </div>

        <div ref="logContainer" class="custom-scrollbar flex-1 overflow-y-auto p-4 text-xs leading-6 font-mono" @scroll="onLogScroll">
          <EmptyState
            v-if="!allLogs.length"
            icon="i-carbon-document-blank"
            title="暂无日志"
            description="运行账号后，实时日志会显示在这里"
          />
          <div v-for="log in allLogs" :key="`${log.ts}-${log.tag}-${log.msg}`" class="mb-1 break-all">
            <span class="mr-2 select-none text-[var(--color-text-tertiary)]">[{{ formatLogTime(log.time) }}]</span>
            <span class="mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
            <span v-if="log.meta?.event" class="mr-2 rounded bg-[rgba(var(--theme-primary-rgb),0.1)] px-1.5 py-0.5 text-[10px] text-[var(--theme-primary)]">{{ getEventLabel(log.meta.event) }}</span>
            <span :class="getLogMsgClass(log.tag)">{{ log.msg }}</span>
          </div>
        </div>
      </section>

      <!-- Today stats + bags -->
      <div class="flex flex-col gap-4">
        <section class="ds-card p-4">
          <div class="mb-3 flex items-center gap-2 text-lg font-semibold">
            <div class="i-carbon-chart-column text-[var(--theme-primary)]" />
            今日统计
          </div>
          <EmptyState
            v-if="!status?.connection?.connected"
            icon="i-carbon-connection-signal-off"
            title="账号未登录"
            description="请先运行账号或检查网络连接"
          />
          <div v-else class="grid grid-cols-2 gap-2">
            <div
              v-for="(val, key) in filteredOperations"
              :key="key"
              class="flex items-center justify-between rounded-xl bg-[var(--color-bg-subtle)] px-3 py-2"
            >
              <div class="flex items-center gap-2">
                <div class="text-base" :class="[getOpIcon(key), getOpColor(key)]" />
                <div class="text-xs text-[var(--color-text-secondary)]">
                  {{ getOpName(key) }}
                </div>
              </div>
              <div class="text-sm font-bold">
                {{ val }}
              </div>
            </div>
          </div>
        </section>

        <section class="ds-card p-4">
          <div class="mb-3 flex items-center gap-2 text-lg font-semibold">
            <div class="i-carbon-inventory-management text-[var(--theme-primary)]" />
            关键物资
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="border border-[var(--color-border-default)] rounded-xl p-3">
              <div class="text-xs text-[var(--color-text-tertiary)]">
                普通化肥
              </div>
              <div class="mt-1 text-lg font-bold">
                {{ fertilizerNormal?.count || 0 }}
              </div>
            </div>
            <div class="border border-[var(--color-border-default)] rounded-xl p-3">
              <div class="text-xs text-[var(--color-text-tertiary)]">
                有机化肥
              </div>
              <div class="mt-1 text-lg font-bold">
                {{ fertilizerOrganic?.count || 0 }}
              </div>
            </div>
            <div class="border border-[var(--color-border-default)] rounded-xl p-3">
              <div class="text-xs text-[var(--color-text-tertiary)]">
                普通收藏
              </div>
              <div class="mt-1 text-lg font-bold">
                {{ collectionNormal?.count || 0 }}
              </div>
            </div>
            <div class="border border-[var(--color-border-default)] rounded-xl p-3">
              <div class="text-xs text-[var(--color-text-tertiary)]">
                稀有收藏
              </div>
              <div class="mt-1 text-lg font-bold">
                {{ collectionRare?.count || 0 }}
              </div>
            </div>
          </div>
          <div v-if="fertilizerNormal || fertilizerOrganic" class="mt-3 text-xs text-[var(--color-text-tertiary)]">
            普通桶 {{ formatBucketTime(fertilizerNormal) }} · 有机桶 {{ formatBucketTime(fertilizerOrganic) }}
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
