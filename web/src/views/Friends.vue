<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const {
  friends,
  loading,
  friendLands,
  friendLandsLoading,
  blacklist,
  interactRecords,
  interactLoading,
  interactError,
  knownFriendGids,
  knownFriendGidSyncCooldownSec,
  knownFriendSettingsLoading,
  knownFriendSettingsSaving,
} = storeToRefs(friendStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)

const isQqAccount = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return false
  const platform = String(acc.platform || 'qq').toLowerCase()
  return platform === 'qq'
})

const gidSearchKeyword = ref('')
const showGidListModal = ref(false)

const knownFriendGidCount = computed(() => knownFriendGids.value.length)
const knownFriendGidSet = computed(() => new Set(knownFriendGids.value.map(Number)))
const friendGidSet = computed(() => new Set(friends.value.map(f => Number(f.gid))))
const blacklistGidSet = computed(() => new Set(blacklist.value.map(item => Number(item.gid))))

const filteredKnownFriendGids = computed(() => {
  const keyword = gidSearchKeyword.value.trim().toLowerCase()
  const list = knownFriendGids.value.map(gid => ({
    gid: Number(gid),
    synced: friendGidSet.value.has(Number(gid)),
  }))
  if (!keyword)
    return list
  return list.filter(item => String(item.gid).includes(keyword))
})

const syncedGidCount = computed(() => filteredKnownFriendGids.value.filter(item => item.synced).length)
const unsyncedGidCount = computed(() => filteredKnownFriendGids.value.filter(item => !item.synced).length)

async function handleRemoveGidFromList(gid: number) {
  if (!currentAccountId.value)
    return
  await friendStore.removeKnownFriendGid(currentAccountId.value, gid)
}

async function handleRemoveUnsyncedGids() {
  if (!currentAccountId.value)
    return
  const unsyncedGids = filteredKnownFriendGids.value.filter(item => !item.synced).map(item => item.gid)
  if (unsyncedGids.length === 0) {
    toast.info('没有需要删除的未同步 GID')
    return
  }
  const result = await friendStore.removeUnsyncedKnownFriendGids(currentAccountId.value, unsyncedGids)
  if (result.ok && result.removedCount > 0) {
    toast.success(`已删除 ${result.removedCount} 个未同步的 GID`)
  }
}

function openGidListModal() {
  gidSearchKeyword.value = ''
  showGidListModal.value = true
}

const TABS = [
  { key: 'friends', label: '好友列表', icon: 'i-carbon-user-multiple' },
  { key: 'blacklist', label: '好友黑名单', icon: 'i-carbon-list' },
  { key: 'visitors', label: '最近访客', icon: 'i-carbon-user-activity' },
] as const

type TabKey = typeof TABS[number]['key']

const activeTab = ref<TabKey>('friends')

const showConfirm = ref(false)
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<(() => Promise<void>) | null>(null)
const avatarErrorKeys = ref<Set<string>>(new Set())
const searchKeyword = ref('')
const batchLoading = ref(false)
const newKnownFriendGid = ref('')
const localKnownFriendGidSyncCooldownSec = ref(300)
const showBatchAddGidModal = ref(false)
const batchGidInput = ref('')

const interactFilter = ref('all')
const interactFilters = [
  { key: 'all', label: '全部' },
  { key: 'steal', label: '偷菜' },
  { key: 'help', label: '帮忙' },
  { key: 'bad', label: '捣乱' },
]

function confirmAction(msg: string, action: () => Promise<void>) {
  confirmMessage.value = msg
  pendingAction.value = action
  showConfirm.value = true
}

async function onConfirm() {
  if (pendingAction.value) {
    try {
      confirmLoading.value = true
      await pendingAction.value()
      pendingAction.value = null
      showConfirm.value = false
    }
    finally {
      confirmLoading.value = false
    }
  }
  else {
    showConfirm.value = false
  }
}

const expandedFriends = ref<Set<string>>(new Set())
const currentPage = ref(1)
const pageSize = 25

const sortedFriends = computed(() => {
  return [...friends.value].sort((a: any, b: any) => {
    const levelA = Number(a?.level || 0)
    const levelB = Number(b?.level || 0)
    return levelB - levelA
  })
})

const filteredFriends = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  const list = sortedFriends.value
  if (!keyword)
    return list

  return list.filter((friend: any) => {
    const name = String(friend?.name || '').toLowerCase()
    const gid = String(friend?.gid || '')
    const uin = String(friend?.uin || '')
    return name.includes(keyword) || gid.includes(keyword) || uin.includes(keyword)
  })
})

const totalPages = computed(() => Math.ceil(filteredFriends.value.length / pageSize) || 1)

const paginatedFriends = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return filteredFriends.value.slice(start, end)
})

function goToPage(page: number) {
  currentPage.value = Math.max(1, Math.min(page, totalPages.value))
}

watch(searchKeyword, () => {
  currentPage.value = 1
})

const filteredInteractRecords = computed(() => {
  if (interactFilter.value === 'all')
    return interactRecords.value

  const actionTypeMap: Record<string, number> = {
    steal: 1,
    help: 2,
    bad: 3,
  }
  const targetActionType = actionTypeMap[interactFilter.value] || 0
  return interactRecords.value.filter((record: any) => Number(record?.actionType) === targetActionType)
})

const visibleInteractRecords = computed(() => filteredInteractRecords.value.slice(0, 50))

async function loadData() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }

    if (acc.running && status.value?.connection?.connected) {
      avatarErrorKeys.value.clear()
      friendStore.fetchFriends(currentAccountId.value)
      friendStore.fetchBlacklist(currentAccountId.value)
      friendStore.fetchInteractRecords(currentAccountId.value)
      if (isQqAccount.value) {
        friendStore.fetchKnownFriendSettings(currentAccountId.value)
      }
    }
  }
}

useIntervalFn(() => {
  for (const gid in friendLands.value) {
    if (friendLands.value[gid]) {
      friendLands.value[gid] = friendLands.value[gid].map((l: any) =>
        l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
      )
    }
  }
}, 1000)

onMounted(() => {
  loadData()
})

watch(currentAccountId, () => {
  expandedFriends.value.clear()
  loadData()
})

async function handleRefreshFriends() {
  if (!currentAccountId.value)
    return
  try {
    await api.post('/api/friends/clear-cache', {}, {
      headers: { 'x-account-id': currentAccountId.value },
    })
  }
  catch {
    // ignore
  }
  await friendStore.fetchFriends(currentAccountId.value, true)
}

function toggleFriend(friendId: string) {
  if (expandedFriends.value.has(friendId)) {
    expandedFriends.value.delete(friendId)
  }
  else {
    expandedFriends.value.clear()
    expandedFriends.value.add(friendId)
    if (currentAccountId.value && currentAccount.value?.running && status.value?.connection?.connected) {
      friendStore.fetchFriendLands(currentAccountId.value, friendId)
    }
  }
}

async function handleOp(friendId: string, type: string, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return

  confirmAction('确定执行此操作吗?', async () => {
    await friendStore.operate(currentAccountId.value!, friendId, type)
  })
}

async function handleToggleBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, Number(friend.gid))
}

function getFriendStatusText(friend: any) {
  const p = friend.plant || {}
  const info = []
  if (p.stealNum)
    info.push(`偷${p.stealNum}`)
  if (p.dryNum)
    info.push(`水${p.dryNum}`)
  if (p.weedNum)
    info.push(`草${p.weedNum}`)
  if (p.insectNum)
    info.push(`虫${p.insectNum}`)
  return info.length ? info.join(' ') : '无操作'
}

function getFriendLevel(friend: any) {
  const level = Number.parseInt(String(friend?.level ?? ''), 10)
  if (!Number.isFinite(level) || level <= 0)
    return 0
  return level
}

function getFriendGold(friend: any) {
  const gold = Number.parseInt(String(friend?.gold ?? ''), 10)
  if (!Number.isFinite(gold) || gold < 0)
    return 0
  return gold
}

function formatFriendGold(value: unknown) {
  const gold = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(gold) || gold < 0)
    return '0'
  return gold.toLocaleString('zh-CN')
}

function getFriendAvatar(friend: any) {
  const direct = String(friend?.avatarUrl || friend?.avatar_url || '').trim()
  if (direct)
    return direct
  const uin = String(friend?.uin || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  const key = String(friend?.gid || friend?.uin || '').trim()
  return key || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}

async function handleRemoveFromBlacklist(gid: number) {
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, gid)
}

async function handleBatchOp(opType: 'help' | 'steal' | 'bad') {
  if (!currentAccountId.value || batchLoading.value)
    return

  const opNames: Record<string, string> = {
    help: '一键帮助',
    steal: '一键偷取',
    bad: '一键捣乱',
  }

  const action = async () => {
    batchLoading.value = true
    try {
      const res = await friendStore.batchOperate(currentAccountId.value!, opType)
      if (res.ok) {
        toast.success(`${opNames[opType]}完成`)
        await friendStore.fetchFriends(currentAccountId.value!)
      }
      else {
        toast.error(res.error || `${opNames[opType]}失败`)
      }
    }
    catch (e: any) {
      toast.error(e?.message || `${opNames[opType]}失败`)
    }
    finally {
      batchLoading.value = false
    }
  }

  confirmAction(`确定执行${opNames[opType]}吗？`, action)
}

async function refreshInteractRecords() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchInteractRecords(currentAccountId.value)
}

function getInteractAvatar(record: any) {
  return String(record?.avatarUrl || '').trim()
}

function getInteractAvatarKey(record: any) {
  const key = String(record?.visitorGid || record?.key || record?.nick || '').trim()
  return key ? `interact:${key}` : ''
}

function canShowInteractAvatar(record: any) {
  const key = getInteractAvatarKey(record)
  if (!key)
    return false
  return !!getInteractAvatar(record) && !avatarErrorKeys.value.has(key)
}

function handleInteractAvatarError(record: any) {
  const key = getInteractAvatarKey(record)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}

function getInteractBadgeClass(actionType: number) {
  if (Number(actionType) === 1)
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (Number(actionType) === 2)
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  if (Number(actionType) === 3)
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function formatInteractTime(timestamp: number) {
  const ts = Number(timestamp) || 0
  if (!ts)
    return '--'

  const date = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute

  if (diff >= 0 && diff < minute)
    return '刚刚'
  if (diff >= minute && diff < hour)
    return `${Math.floor(diff / minute)} 分钟前`

  const sameDay = now.getFullYear() === date.getFullYear()
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate()

  if (sameDay) {
    return `今天 ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  if (now.getFullYear() === date.getFullYear()) {
    return `${date.getMonth() + 1}-${date.getDate()} ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function normalizeKnownFriendGidSyncCooldownSec(value: number) {
  const v = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(v) || v <= 0)
    return 600
  return Math.max(30, Math.min(86400, v))
}

async function handleAddKnownFriendGid() {
  if (!currentAccountId.value)
    return
  const gid = Number.parseInt(String(newKnownFriendGid.value || ''), 10)
  if (!Number.isFinite(gid) || gid <= 0) {
    toast.error('请输入有效的 GID')
    return
  }
  const cooldownSec = normalizeKnownFriendGidSyncCooldownSec(localKnownFriendGidSyncCooldownSec.value)
  await friendStore.addKnownFriendGid(currentAccountId.value, gid, cooldownSec)
  newKnownFriendGid.value = ''
  await refreshFriendsAfterKnownGidChange()
  toast.success(`已加入同步列表: ${gid}`)
}

async function handleRemoveKnownFriendGid(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(friend?.gid) || 0
  const name = String(friend?.name || `GID ${gid}`).trim()
  confirmAction(
    `确定将 ${name} 移出同步列表吗？后续如果最近访客再次命中，这个 GID 仍可被自动同步回来。`,
    async () => {
      await friendStore.removeKnownFriendGid(currentAccountId.value!, gid)
      await refreshFriendsAfterKnownGidChange()
      toast.success(`已移出同步列表: ${name}`)
    },
  )
}

async function refreshFriendsAfterKnownGidChange() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchFriends(currentAccountId.value, true)
}

async function handleSaveKnownFriendSettings() {
  if (!currentAccountId.value)
    return
  const cooldownSec = normalizeKnownFriendGidSyncCooldownSec(localKnownFriendGidSyncCooldownSec.value)
  await friendStore.saveKnownFriendSettings(currentAccountId.value, {
    knownFriendGidSyncCooldownSec: cooldownSec,
  })
  toast.success('设置已保存')
}

watch(knownFriendGidSyncCooldownSec, (val) => {
  localKnownFriendGidSyncCooldownSec.value = val
})

function parseBatchGids(input: string): number[] {
  const text = String(input || '').trim()
  if (!text)
    return []
  const gids: number[] = []
  const parts = text.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const num = Number.parseInt(part, 10)
    if (Number.isFinite(num) && num > 0 && !gids.includes(num)) {
      gids.push(num)
    }
  }
  return gids
}

async function handleBatchAddKnownFriendGids() {
  if (!currentAccountId.value)
    return
  const gids = parseBatchGids(batchGidInput.value)
  if (gids.length === 0) {
    toast.error('请输入有效的 GID 列表')
    return
  }
  const result = await friendStore.batchAddKnownFriendGids(currentAccountId.value, gids)
  if (result.ok) {
    batchGidInput.value = ''
    showBatchAddGidModal.value = false
    await refreshFriendsAfterKnownGidChange()
    toast.success(`已批量添加 ${result.addedCount} 个 GID`)
  }
}
</script>

<template>
  <div class="ds-page">
    <PageHeader title="好友互动" subtitle="帮助、偷取、黑名单与访客管理">
      <template #badges>
        <span class="ds-chip ds-chip-brand">
          <div class="i-carbon-user-multiple" />
          社交工作台
        </span>
        <span
          v-if="activeTab === 'friends' && friends.length"
          class="ds-chip"
        >
          {{ filteredFriends.length }}/{{ friends.length }} 好友
        </span>
        <span
          v-else-if="activeTab === 'blacklist'"
          class="ds-chip"
        >
          黑名单 {{ blacklist.length }}
        </span>
        <span
          v-else-if="activeTab === 'visitors' && interactRecords.length"
          class="ds-chip"
        >
          访客 {{ filteredInteractRecords.length }}/{{ interactRecords.length }}
        </span>
      </template>
      <template #actions>
        <div v-if="activeTab === 'friends'" class="w-full sm:w-64">
          <BaseInput
            v-model="searchKeyword"
            placeholder="搜索好友..."
            clearable
          />
        </div>
        <BaseButton
          v-if="activeTab === 'friends'"
          variant="secondary"
          size="sm"
          :loading="loading"
          :disabled="!currentAccountId"
          @click="handleRefreshFriends"
        >
          <div class="i-carbon-renew" />
          刷新
        </BaseButton>
        <BaseButton
          v-else-if="activeTab === 'visitors'"
          variant="secondary"
          size="sm"
          :loading="interactLoading"
          :disabled="!currentAccountId"
          @click="refreshInteractRecords"
        >
          <div class="i-carbon-renew" />
          刷新访客
        </BaseButton>
      </template>
    </PageHeader>

    <div class="flex gap-1 overflow-x-auto border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-subtle)] p-1">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="min-w-[7rem] flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition"
        :class="activeTab === tab.key
          ? 'bg-[var(--color-bg-surface)] text-[var(--theme-primary)] shadow-sm'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'"
        @click="activeTab = tab.key"
      >
        <div class="flex items-center justify-center gap-2">
          <div :class="tab.icon" />
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.key === 'blacklist' && blacklist.length > 0"
            class="rounded-full bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-danger)]"
          >
            {{ blacklist.length }}
          </span>
        </div>
      </button>
    </div>

    <div v-if="loading || statusLoading || interactLoading" class="ds-card flex justify-center py-16">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-[var(--theme-primary)]" />
    </div>

    <EmptyState
      v-else-if="!currentAccountId"
      icon="i-carbon-user"
      title="未选择农场账号"
      description="请先添加并选择一个农场账号后再进行好友互动"
    />

    <EmptyState
      v-else-if="!status?.connection?.connected"
      icon="i-carbon-connection-signal-off"
      title="账号未登录"
      description="请先运行账号或检查网络连接"
    />

    <template v-else>
      <div v-if="activeTab === 'friends'" class="space-y-4">
        <section
          v-if="currentAccountId && isQqAccount"
          class="ds-card p-4 sm:p-5"
        >
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="i-carbon-user-profile text-lg text-[var(--color-warning)]" />
                <h3 class="text-base text-[var(--color-text-primary)] font-semibold sm:text-lg">
                  QQ 好友自动同步
                </h3>
                <button
                  class="cursor-pointer rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs text-[var(--color-warning)] font-medium transition hover:opacity-90"
                  @click="openGidListModal"
                >
                  {{ knownFriendGidCount }} 个 GID
                </button>
              </div>
              <p class="mt-1 text-sm text-[var(--color-text-secondary)]">
                QQ 新好友接口依赖已知 GID。系统会自动从最近访客补充，进入好友农场明确失败时自动移除失效 GID。
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="knownFriendSettingsLoading"
                @click="currentAccountId && friendStore.fetchKnownFriendSettings(currentAccountId)"
              >
                刷新
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="knownFriendSettingsSaving"
                @click="handleSaveKnownFriendSettings"
              >
                保存设置
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                @click="showBatchAddGidModal = true"
              >
                批量新增 GID
              </BaseButton>
            </div>
          </div>

          <div class="grid mt-4 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
            <BaseInput
              v-model="newKnownFriendGid"
              type="number"
              label="新增 GID"
              placeholder="输入好友 GID"
            />
            <BaseInput
              v-model="localKnownFriendGidSyncCooldownSec"
              type="number"
              label="访客检测入库冷却(秒)"
              placeholder="600"
            />
            <div class="flex items-end">
              <BaseButton
                variant="primary"
                class="w-full lg:w-auto"
                :loading="knownFriendSettingsSaving"
                :disabled="!newKnownFriendGid"
                @click="handleAddKnownFriendGid"
              >
                新增 GID
              </BaseButton>
            </div>
          </div>
        </section>

        <EmptyState
          v-if="friends.length === 0"
          icon="i-carbon-user-multiple"
          title="暂无好友"
          description="暂无好友数据，或列表加载失败。可尝试刷新。"
        >
          <template #actions>
            <BaseButton variant="secondary" size="sm" :loading="loading" @click="handleRefreshFriends">
              刷新列表
            </BaseButton>
          </template>
        </EmptyState>

        <template v-else>
          <div class="ds-card flex flex-wrap items-center gap-2 p-3 sm:p-4">
            <span class="flex items-center text-sm text-[var(--color-text-secondary)]">批量操作</span>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="batchLoading"
              :disabled="batchLoading"
              @click="handleBatchOp('help')"
            >
              一键帮助
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="batchLoading"
              :disabled="batchLoading"
              @click="handleBatchOp('steal')"
            >
              一键偷取
            </BaseButton>
            <BaseButton
              variant="danger"
              size="sm"
              :loading="batchLoading"
              :disabled="batchLoading"
              @click="handleBatchOp('bad')"
            >
              一键捣乱
            </BaseButton>
            <div class="flex-1" />
            <BaseButton
              variant="ghost"
              size="sm"
              :loading="loading"
              @click="handleRefreshFriends"
            >
              <div class="i-carbon-renew" />
              刷新列表
            </BaseButton>
          </div>

          <div class="space-y-3">
            <div
              v-for="friend in paginatedFriends"
              :key="friend.gid"
              class="ds-card overflow-hidden"
            >
              <div
                class="flex cursor-pointer items-center gap-3 p-4 transition hover:bg-[var(--color-bg-subtle)]"
                @click="toggleFriend(friend.gid)"
              >
                <div class="h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-bg-subtle)] ring-1 ring-[var(--color-border-default)]">
                  <img
                    v-if="canShowFriendAvatar(friend)"
                    :src="getFriendAvatar(friend)"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="handleFriendAvatarError(friend)"
                  >
                  <div v-else class="i-carbon-user text-xl text-[var(--color-text-tertiary)]" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <span class="max-w-full truncate text-base text-[var(--color-text-primary)] font-semibold">
                      {{ friend.name || `GID:${friend.gid}` }}
                    </span>
                    <span v-if="getFriendLevel(friend)" class="ds-chip ds-chip-brand">
                      Lv.{{ getFriendLevel(friend) }}
                    </span>
                    <span v-if="friend.gid" class="text-xs text-[var(--color-text-tertiary)]">
                      GID {{ friend.gid }}
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                    <span class="inline-flex items-center gap-1">
                      <div class="i-fas-coins text-yellow-500" />
                      {{ formatFriendGold(getFriendGold(friend)) }}
                    </span>
                    <span>{{ getFriendStatusText(friend) }}</span>
                  </div>
                </div>
                <div
                  class="i-carbon-chevron-down shrink-0 text-[var(--color-text-tertiary)] transition"
                  :class="expandedFriends.has(friend.gid) ? 'rotate-180' : ''"
                />
              </div>

              <div class="border-t border-[var(--color-border-default)] bg-[var(--color-bg-subtle)]/60 p-3">
                <div class="flex flex-wrap gap-2">
                  <button
                    class="rounded-lg bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'help', $event)"
                  >
                    帮助
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-sm text-[var(--color-info)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'steal', $event)"
                  >
                    偷取
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'water', $event)"
                  >
                    浇水
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'weed', $event)"
                  >
                    除草
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'bug', $event)"
                  >
                    除虫
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)] font-medium transition hover:opacity-90"
                    @click="handleOp(friend.gid, 'bad', $event)"
                  >
                    捣乱
                  </button>
                  <button
                    class="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] font-medium transition hover:opacity-90"
                    @click="handleToggleBlacklist(friend, $event)"
                  >
                    {{ blacklistGidSet.has(Number(friend.gid)) ? '移出黑名单' : '加入黑名单' }}
                  </button>
                  <button
                    v-if="isQqAccount && knownFriendGidSet.has(Number(friend.gid))"
                    class="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)] font-medium transition hover:opacity-90"
                    @click="handleRemoveKnownFriendGid(friend, $event)"
                  >
                    移出同步列表
                  </button>
                </div>
              </div>

              <div v-if="expandedFriends.has(friend.gid)" class="border-t border-[var(--color-border-default)] p-4">
                <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
                  <div class="i-svg-spinners-90-ring-with-bg text-2xl text-[var(--theme-primary)]" />
                </div>
                <div v-else-if="!friendLands[friend.gid] || friendLands[friend.gid]?.length === 0" class="py-4 text-center text-sm text-[var(--color-text-secondary)]">
                  无土地数据
                </div>
                <div v-else class="grid grid-cols-2 gap-2 lg:grid-cols-8 md:grid-cols-5 sm:grid-cols-4">
                  <LandCard
                    v-for="land in friendLands[friend.gid]"
                    :key="land.id"
                    :land="land"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-if="filteredFriends.length > pageSize" class="flex flex-wrap items-center justify-center gap-2 pt-1">
            <BaseButton variant="secondary" size="sm" :disabled="currentPage === 1" @click="goToPage(1)">
              首页
            </BaseButton>
            <BaseButton variant="secondary" size="sm" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
              上一页
            </BaseButton>
            <div class="flex items-center gap-1">
              <template v-for="p in totalPages" :key="p">
                <button
                  v-if="p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)"
                  class="h-8 w-8 rounded-lg text-sm font-medium transition"
                  :class="p === currentPage
                    ? 'text-white shadow-sm'
                    : 'border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]'"
                  :style="p === currentPage ? { backgroundImage: 'var(--theme-gradient)', backgroundColor: 'var(--theme-primary)' } : {}"
                  @click="goToPage(p)"
                >
                  {{ p }}
                </button>
                <span
                  v-else-if="p === currentPage - 2 || p === currentPage + 2"
                  class="px-1 text-[var(--color-text-tertiary)]"
                >...</span>
              </template>
            </div>
            <BaseButton variant="secondary" size="sm" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">
              下一页
            </BaseButton>
            <BaseButton variant="secondary" size="sm" :disabled="currentPage === totalPages" @click="goToPage(totalPages)">
              末页
            </BaseButton>
          </div>
        </template>
      </div>

      <div v-else-if="activeTab === 'blacklist'" class="space-y-4">
        <section class="ds-card p-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            加入黑名单的好友在自动偷菜和帮助时会被跳过。
          </p>
        </section>

        <EmptyState
          v-if="blacklist.length === 0"
          icon="i-carbon-list"
          title="暂无黑名单好友"
          description="将好友加入黑名单后会显示在这里"
        />

        <div v-else class="space-y-2">
          <div
            v-for="item in blacklist"
            :key="item.gid"
            class="ds-card flex items-center justify-between gap-3 p-4"
          >
            <div class="min-w-0 flex items-center gap-3">
              <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-bg-subtle)] ring-1 ring-[var(--color-border-default)]">
                <img
                  v-if="item.avatarUrl"
                  :src="item.avatarUrl"
                  class="h-full w-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                >
                <div v-else class="i-carbon-user text-[var(--color-text-tertiary)]" />
              </div>
              <div class="min-w-0">
                <div class="truncate text-[var(--color-text-primary)] font-medium">
                  {{ item.name || `GID:${item.gid}` }}
                </div>
                <div class="text-sm text-[var(--color-text-tertiary)]">
                  {{ item.gid }}
                </div>
              </div>
            </div>
            <BaseButton
              variant="danger"
              size="sm"
              @click="handleRemoveFromBlacklist(item.gid)"
            >
              移出黑名单
            </BaseButton>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'visitors'" class="space-y-4">
        <div class="ds-card flex flex-wrap items-center gap-2 p-3 sm:p-4">
          <button
            v-for="item in interactFilters"
            :key="item.key"
            class="rounded-full px-3 py-1.5 text-xs font-medium transition"
            :class="interactFilter === item.key
              ? 'text-white shadow-sm'
              : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'"
            :style="interactFilter === item.key ? { backgroundImage: 'var(--theme-gradient)', backgroundColor: 'var(--theme-primary)' } : {}"
            @click="interactFilter = item.key"
          >
            {{ item.label }}
          </button>
          <div class="flex-1" />
          <span v-if="interactRecords.length" class="text-sm text-[var(--color-text-secondary)]">
            共 {{ filteredInteractRecords.length }}/{{ interactRecords.length }} 条
          </span>
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="interactLoading"
            @click="refreshInteractRecords"
          >
            <div class="i-carbon-renew" />
            刷新记录
          </BaseButton>
        </div>

        <EmptyState
          v-if="interactError"
          icon="i-carbon-warning"
          title="访客记录加载失败"
          :description="String(interactError)"
        >
          <template #actions>
            <BaseButton variant="secondary" size="sm" @click="refreshInteractRecords">
              重试
            </BaseButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="visibleInteractRecords.length === 0"
          icon="i-carbon-pedestrian"
          title="暂无访客记录"
          description="最近暂无好友来访互动，或当前筛选无结果"
        />

        <div v-else class="space-y-2">
          <div
            v-for="record in visibleInteractRecords"
            :key="record.key || `${record.visitorGid}-${record.serverTimeMs}`"
            class="ds-card flex items-start gap-3 p-4"
          >
            <div class="h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-bg-subtle)] ring-1 ring-[var(--color-border-default)]">
              <img
                v-if="canShowInteractAvatar(record)"
                :src="getInteractAvatar(record)"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="handleInteractAvatarError(record)"
              >
              <div v-else class="i-carbon-user-avatar text-xl text-[var(--color-text-tertiary)]" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <span class="max-w-full truncate text-base text-[var(--color-text-primary)] font-medium">
                  {{ record.nick || `GID:${record.visitorGid}` }}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="getInteractBadgeClass(record.actionType)"
                >
                  {{ record.actionLabel }}
                </span>
                <span v-if="record.level" class="ds-chip">
                  Lv.{{ record.level }}
                </span>
                <span v-if="record.visitorGid" class="text-xs text-[var(--color-text-tertiary)]">
                  GID {{ record.visitorGid }}
                </span>
              </div>
              <div class="text-sm text-[var(--color-text-secondary)]">
                {{ record.actionDetail || record.actionLabel }}
              </div>
            </div>
            <div class="shrink-0 text-right text-xs text-[var(--color-text-tertiary)]">
              {{ formatInteractTime(record.serverTimeMs) }}
            </div>
          </div>

          <div v-if="filteredInteractRecords.length > visibleInteractRecords.length" class="text-center text-xs text-[var(--color-text-tertiary)]">
            仅展示最近 {{ visibleInteractRecords.length }} 条
          </div>
        </div>
      </div>
    </template>

    <ConfirmModal
      :show="showConfirm"
      :loading="confirmLoading"
      title="确认操作"
      :message="confirmMessage"
      @confirm="onConfirm"
      @cancel="!confirmLoading && (showConfirm = false)"
    />

    <Teleport to="body">
      <div
        v-if="showBatchAddGidModal"
        class="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-bg-overlay)] p-4 backdrop-blur-sm"
        @click.self="showBatchAddGidModal = false"
      >
        <div class="ds-surface-solid max-w-lg w-full p-6 shadow-lg">
          <h3 class="mb-2 text-lg text-[var(--color-text-primary)] font-semibold">
            批量新增 GID
          </h3>
          <p class="mb-3 text-sm text-[var(--color-text-secondary)]">
            支持一行一个或用逗号/空格分隔，自动去重
          </p>
          <textarea
            v-model="batchGidInput"
            rows="8"
            placeholder="每行一个 GID，或用逗号、空格分隔&#10;例如：&#10;12345678&#10;87654321&#10;或&#10;12345678, 87654321, 11111111"
            class="mb-4 ds-input-base w-full resize-y p-3 text-sm font-mono"
          />
          <div class="flex justify-end gap-3">
            <BaseButton variant="secondary" @click="showBatchAddGidModal = false">
              取消
            </BaseButton>
            <BaseButton
              variant="primary"
              :loading="knownFriendSettingsSaving"
              :disabled="!batchGidInput.trim()"
              @click="handleBatchAddKnownFriendGids"
            >
              确认添加
            </BaseButton>
          </div>
        </div>
      </div>

      <div
        v-if="showGidListModal"
        class="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-bg-overlay)] p-4 backdrop-blur-sm"
        @click.self="showGidListModal = false"
      >
        <div class="ds-surface-solid max-h-[80vh] max-w-2xl w-full flex flex-col overflow-hidden shadow-lg">
          <div class="flex shrink-0 items-center justify-between border-b border-[var(--color-border-default)] p-4">
            <div>
              <h3 class="text-lg text-[var(--color-text-primary)] font-semibold">
                已导入的 GID 列表
              </h3>
              <p class="mt-1 text-sm text-[var(--color-text-secondary)]">
                共 {{ knownFriendGidCount }} 个 GID，
                <span class="text-[var(--color-warning)]">已同步 {{ syncedGidCount }} 个</span>，
                <span class="text-[var(--color-danger)]">未同步 {{ unsyncedGidCount }} 个</span>
              </p>
            </div>
            <button
              class="rounded-lg p-2 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-subtle)]"
              @click="showGidListModal = false"
            >
              <div class="i-carbon-close text-xl" />
            </button>
          </div>

          <div class="shrink-0 border-b border-[var(--color-border-default)] p-4">
            <div class="flex flex-col gap-2 sm:flex-row">
              <BaseInput
                v-model="gidSearchKeyword"
                class="flex-1"
                placeholder="搜索 GID..."
                clearable
              />
              <BaseButton
                variant="danger"
                size="sm"
                :loading="knownFriendSettingsSaving"
                :disabled="unsyncedGidCount === 0"
                @click="handleRemoveUnsyncedGids"
              >
                删除未同步 ({{ unsyncedGidCount }})
              </BaseButton>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            <EmptyState
              v-if="filteredKnownFriendGids.length === 0"
              icon="i-carbon-search"
              title="暂无数据"
              description="没有匹配的 GID"
            />
            <div v-else class="grid gap-2 lg:grid-cols-3 sm:grid-cols-2">
              <div
                v-for="item in filteredKnownFriendGids"
                :key="item.gid"
                class="flex items-center justify-between border rounded-xl p-2.5 transition"
                :class="item.synced
                  ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)]'
                  : 'border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)]'"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="text-sm font-mono"
                    :class="item.synced ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'"
                  >
                    {{ item.gid }}
                  </span>
                  <span
                    class="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                    :class="item.synced
                      ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
                      : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'"
                  >
                    {{ item.synced ? '已同步' : '未同步' }}
                  </span>
                </div>
                <button
                  class="rounded-lg p-1.5 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-danger)]"
                  :disabled="knownFriendSettingsSaving"
                  @click="handleRemoveGidFromList(item.gid)"
                >
                  <div class="i-carbon-trash-can text-sm" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
