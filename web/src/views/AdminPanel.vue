<script setup lang="ts">
import type { Card, UserCard } from '@/stores/user'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const toast = useToastStore()

const activeTab = ref<'card' | 'user' | 'log' | 'audit' | 'alert' | 'announcement' | 'system'>(
  (localStorage.getItem('admin-active-tab') as 'card' | 'user' | 'log' | 'audit' | 'alert' | 'announcement' | 'system') || 'card',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

const tabs = [
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin' },
  { key: 'log', label: '日志', icon: 'i-carbon-document' },
  { key: 'audit', label: '审计', icon: 'i-carbon-task-approved' },
  { key: 'alert', label: '告警', icon: 'i-carbon-warning-alt' },
  { key: 'announcement', label: '公告', icon: 'i-carbon-bullhorn' },
  { key: 'system', label: '系统', icon: 'i-carbon-settings' },
] as const

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

// ========== 卡密管理 ==========
const cards = ref<Card[]>([])
const cardsLoading = ref(false)
const showCreateModal = ref(false)

const newCard = ref({
  description: '',
  days: 30,
  count: 1,
  type: 'time' as 'time' | 'quota',
})

const selectedCards = ref<Set<string>>(new Set())
const selectAll = ref(false)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'used' | 'unused' | 'enabled' | 'disabled'>('all')
const cardTypeFilter = ref<'all' | 'time' | 'quota'>('all')

// 卡密领取功能
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)

// 卡密消费流水
interface CardLog {
  action: 'register' | 'renew' | 'claim'
  username: string | null
  cardCode: string
  cardType: string
  days: number
  at: number
}

const cardLogs = ref<CardLog[]>([])
const cardLogsTotal = ref(0)
const cardLogsLoading = ref(false)
const cardLogFilter = ref<'all' | 'register' | 'renew' | 'claim'>('all')

const cardLogLabels: Record<string, string> = {
  register: '注册激活',
  renew: '续费使用',
  claim: '卡密领取',
}

const cardLogColors: Record<string, string> = {
  register: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  renew: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  claim: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
}

async function fetchCardLogs() {
  cardLogsLoading.value = true
  try {
    const { data } = await api.get('/api/admin/card-logs', {
      params: { limit: 200, action: cardLogFilter.value === 'all' ? undefined : cardLogFilter.value },
    })
    if (data?.ok && data.data) {
      cardLogs.value = Array.isArray(data.data.logs) ? data.data.logs : []
      cardLogsTotal.value = data.data.total || 0
    }
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || '无法读取卡密流水')
  }
  finally {
    cardLogsLoading.value = false
  }
}

async function clearCardLogs() {
  if (!window.confirm('确定清空全部卡密消费流水吗？该操作不可恢复。'))
    return
  try {
    await api.delete('/api/admin/card-logs')
    toast.success('卡密流水已清空')
    cardLogs.value = []
    cardLogsTotal.value = 0
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || '清空失败')
  }
}

const unusedTimeCardsCount = computed(() => {
  return cards.value.filter(c => c.type === 'time' && !c.usedBy && c.enabled).length
})

const filteredCards = computed(() => {
  let result = cards.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedBy && card.usedBy.toLowerCase().includes(query)),
    )
  }

  switch (filterStatus.value) {
    case 'used':
      result = result.filter(card => card.usedBy)
      break
    case 'unused':
      result = result.filter(card => !card.usedBy)
      break
    case 'enabled':
      result = result.filter(card => card.enabled)
      break
    case 'disabled':
      result = result.filter(card => !card.enabled)
      break
  }

  if (cardTypeFilter.value !== 'all') {
    result = result.filter(card => card.type === cardTypeFilter.value)
  }

  return result
})

async function fetchCards() {
  cardsLoading.value = true
  try {
    const result = await userStore.getAllCards()
    if (result.ok) {
      cards.value = result.data
    }
    else {
      toast.error(result.error || '获取卡密列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取卡密列表失败')
  }
  finally {
    cardsLoading.value = false
  }
}

async function fetchCardClaimStatus() {
  cardClaimLoading.value = true
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
    }
  }
  catch (e: any) {
    console.error('获取卡密领取状态失败:', e)
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function toggleCardClaimStatus(enabled: boolean | undefined) {
  if (enabled === undefined)
    return
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', { enabled })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
      toast.success(enabled ? '卡密领取功能已开启' : '卡密领取功能已关闭')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
    cardClaimEnabled.value = !enabled
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function createCard() {
  if (!newCard.value.description) {
    toast.warning('请输入卡密描述')
    return
  }

  const count = Math.min(Math.max(Number.parseInt(String(newCard.value.count), 10) || 1, 1), 100)

  try {
    const result = await userStore.createCard(
      newCard.value.description,
      newCard.value.days,
      count > 1 ? count : undefined,
      newCard.value.type,
    )
    if (result.ok) {
      if (result.batch) {
        toast.success(`成功创建 ${result.count} 个卡密`)
        exportCardsToFile(result.data, `卡密批量导出_${newCard.value.description}_${formatDateForFile(Date.now())}.txt`)
      }
      else {
        toast.success('卡密创建成功')
      }
      showCreateModal.value = false
      newCard.value = { description: '', days: 30, count: 1, type: 'time' }
      await fetchCards()
    }
    else {
      toast.error(result.error || '创建卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '创建卡密失败')
  }
}

async function toggleCardStatus(card: Card) {
  try {
    const result = await userStore.updateCard(card.code, { enabled: !card.enabled })
    if (result.ok) {
      toast.success(card.enabled ? '卡密已禁用' : '卡密已启用')
      await fetchCards()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteCard(card: Card) {
  if (!confirm(`确定要删除卡密 ${card.code} 吗？`))
    return

  try {
    const result = await userStore.deleteCard(card.code)
    if (result.ok) {
      toast.success('卡密删除成功')
      await fetchCards()
    }
    else {
      toast.error(result.error || '删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除卡密失败')
  }
}

async function deleteSelectedCards() {
  const selectedCodes = Array.from(selectedCards.value)
  if (selectedCodes.length === 0) {
    toast.warning('请先选择要删除的卡密')
    return
  }

  if (!confirm(`确定要删除选中的 ${selectedCodes.length} 个卡密吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteCardsBatch(selectedCodes)
    if (result.ok) {
      toast.success(`成功删除 ${result.deletedCount} 个卡密`)
      if (result.notFoundCount > 0) {
        toast.warning(`${result.notFoundCount} 个卡密未找到`)
      }
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(result.error || '批量删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '批量删除卡密失败')
  }
}

async function copyCode(code: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code)
      toast.success('卡密已复制到剪贴板')
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = code
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success('卡密已复制到剪贴板')
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

async function copySelectedCards() {
  const codes = Array.from(selectedCards.value)
  if (codes.length === 0)
    return

  try {
    const text = codes.join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

function formatDate(timestamp: number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function getCardTypeLabel(card: Card) {
  if (card.type === 'quota') {
    return '额度'
  }
  return '时间'
}

function getCardValueLabel(card: Card) {
  if (card.type === 'quota') {
    return `+${card.days}额度`
  }
  if (card.days === -1)
    return '永久'
  return `${card.days}天`
}

function exportCardsToFile(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const content = cardsToExport.map(card =>
    `卡密: ${card.code}\n描述: ${card.description}\n时长: ${getCardTypeLabel(card)}\n状态: ${card.enabled ? '启用' : '禁用'}\n${card.usedBy ? `使用者: ${card.usedBy}\n使用时间: ${formatDate(card.usedAt)}` : '未使用'}\n创建时间: ${formatDate(card.createdAt)}\n${'='.repeat(40)}`,
  ).join('\n\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到文件`)
}

function toggleSelectAll() {
  if (selectAll.value) {
    filteredCards.value.forEach(card => selectedCards.value.add(card.code))
  }
  else {
    filteredCards.value.forEach(card => selectedCards.value.delete(card.code))
  }
}

function toggleSelectCard(code: string) {
  if (selectedCards.value.has(code)) {
    selectedCards.value.delete(code)
    selectAll.value = false
  }
  else {
    selectedCards.value.add(code)
    if (filteredCards.value.every(card => selectedCards.value.has(card.code))) {
      selectAll.value = true
    }
  }
}

// ========== 用户管理 ==========
interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
  pushLimit: number
  operationRateLimit: number
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  pushLimit: number
  operationRateLimit: number
  expiresAt: string
  isPermanent: boolean
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  pushLimit: 50,
  operationRateLimit: 30,
  expiresAt: '',
  isPermanent: false,
})
const editLoading = ref(false)

const currentUsername = computed(() => userStore.username)

async function fetchUsers() {
  usersLoading.value = true
  try {
    const result = await userStore.getAllUsers()
    if (result.ok) {
      users.value = result.data
    }
    else {
      toast.error(result.error || '获取用户列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取用户列表失败')
  }
  finally {
    usersLoading.value = false
  }
}

async function toggleUserStatus(user: UserInfo) {
  try {
    const updates: Partial<UserCard> = { enabled: !user.card?.enabled }
    const result = await userStore.updateUser(user.username, updates)
    if (result.ok) {
      toast.success(user.card?.enabled ? '用户已封禁' : '用户已解封')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteUser(user: UserInfo) {
  if (!confirm(`确定要删除用户 ${user.username} 吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteUser(user.username)
    if (result.ok) {
      toast.success('用户删除成功')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '删除用户失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除用户失败')
  }
}

function openEditModal(user: UserInfo) {
  selectedUser.value = user
  editForm.value = {
    newUsername: user.username,
    password: '',
    accountLimit: user.accountLimit || 2,
    pushLimit: user.pushLimit || 50,
    operationRateLimit: user.operationRateLimit || 30,
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  showEditModal.value = true
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function handleEdit() {
  if (!selectedUser.value)
    return

  editLoading.value = true
  try {
    const expiresAtValue = editForm.value.isPermanent
      ? null
      : (editForm.value.expiresAt ? new Date(editForm.value.expiresAt).getTime() : null)

    const updateData: Record<string, any> = {
      accountLimit: editForm.value.accountLimit,
      pushLimit: editForm.value.pushLimit,
      operationRateLimit: editForm.value.operationRateLimit,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username) {
      updateData.newUsername = editForm.value.newUsername
    }

    if (editForm.value.password) {
      updateData.password = editForm.value.password
    }

    const res = await api.post(`/api/admin/users/${selectedUser.value.username}/edit`, updateData)

    if (res.data.ok) {
      toast.success('用户信息已更新')
      showEditModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(res.data.error || '更新失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '更新失败')
  }
  finally {
    editLoading.value = false
  }
}

function getDaysLabel(days: number) {
  if (days === -1)
    return '永久'
  return `${days}天`
}

function isExpired(card: UserCard | null) {
  if (!card?.expiresAt)
    return false
  return Date.now() > card.expiresAt
}

// ========== 登录日志 ==========
interface LoginLog {
  id: string
  timestamp: number
  event: 'login_success' | 'login_failed'
  username: string
  errorType: string | null
  ip: string
  userAgent: string
}

const loginLogs = ref<LoginLog[]>([])
const loginLogsLoading = ref(false)
const loginLogsTotal = ref(0)
const showClearLogsConfirm = ref(false)
const clearLogsLoading = ref(false)

async function fetchLoginLogs() {
  loginLogsLoading.value = true
  try {
    const result = await userStore.getLoginLogs(100, 0)
    if (result.ok) {
      loginLogs.value = result.data.logs
      loginLogsTotal.value = result.data.total
    }
    else {
      toast.error(result.error || '获取登录日志失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取登录日志失败')
  }
  finally {
    loginLogsLoading.value = false
  }
}

function openClearLogsConfirm() {
  if (loginLogsTotal.value === 0) {
    toast.warning('暂无日志可清空')
    return
  }
  showClearLogsConfirm.value = true
}

async function confirmClearLogs() {
  clearLogsLoading.value = true
  try {
    const result = await userStore.clearLoginLogs()
    if (result.ok) {
      toast.success('日志已清空')
      loginLogs.value = []
      loginLogsTotal.value = 0
      showClearLogsConfirm.value = false
    }
    else {
      toast.error(result.error || '清空失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '清空失败')
  }
  finally {
    clearLogsLoading.value = false
  }
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

function getEventLabel(event: string): string {
  return event === 'login_success' ? '登录成功' : '登录失败'
}

function getEventClass(event: string): string {
  return event === 'login_success'
    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

function getErrorTypeLabel(errorType: string | null): string {
  if (!errorType)
    return '-'
  const labels: Record<string, string> = {
    rate_limit: '速率限制',
    locked: '账户锁定',
    invalid_credentials: '凭证错误',
  }
  return labels[errorType] || errorType
}

function parseBrowser(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown')
    return '未知'

  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(/Edg\/([\d.]+)/)
    return `Edge ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    return `Chrome ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(/Firefox\/([\d.]+)/)
    return `Firefox ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(/Version\/([\d.]+)/)
    return `Safari ${match ? match[1] : ''}`
  }
  if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    return 'IE'
  }

  return '其他'
}

// ========== 系统配置 ==========
const systemConfigSaving = ref(false)
const systemConfigLoading = ref(false)
const runtimeDoctorLoading = ref(false)
const runtimeDoctorError = ref('')
const runtimeDoctor = ref<{
  ok: boolean
  version: string
  nodeVersion: string
  checkedAt: string
  checks: Array<{ id: string, label: string, status: 'ok' | 'error', message: string }>
} | null>(null)

const localSystemConfig = ref({
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  clientVersion: '1.7.0.7_20260313',
  platform: 'qq',
  os: 'iOS',
})

const defaultSystemConfig = ref({
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  clientVersion: '1.7.0.7_20260313',
  platform: 'qq',
  os: 'iOS',
})

const wxConfigSaving = ref(false)
const wxHealthChecking = ref(false)
const wxHealth = ref<{ status: 'idle' | 'reachable' | 'unavailable', message: string, checkedAt: number }>({
  status: 'idle',
  message: '尚未检查',
  checkedAt: 0,
})

const localWxConfig = ref({
  enabled: true,
  apiBase: 'http://127.0.0.1:8059/api',
  apiKey: '',
  proxyApiUrl: 'http://127.0.0.1:8059/api',
  appId: 'wx5306c5978fdb76e4',
  autoAddAccount: true,
  userIsolation: true,
})
const wxApiKeyConfigured = ref(false)
const wxApiKeyHint = ref('未配置')

const platformOptions = [
  { label: 'QQ', value: 'qq' },
  { label: '微信', value: 'wx' },
]

const osOptions = [
  { label: 'iOS', value: 'iOS' },
  { label: 'Android', value: 'Android' },
]

async function loadWxConfig() {
  try {
    const { data } = await api.get('/api/admin/wx-config')
    if (data?.ok && data.data) {
      const { apiKeyConfigured, apiKeyHint, ...config } = data.data
      localWxConfig.value = { ...localWxConfig.value, ...config, apiKey: '' }
      wxApiKeyConfigured.value = Boolean(apiKeyConfigured)
      wxApiKeyHint.value = String(apiKeyHint || '未配置')
    }
  }
  catch (e: any) {
    console.error('加载微信配置失败:', e)
  }
}

async function handleSaveWxConfig() {
  wxConfigSaving.value = true
  try {
    const { data } = await api.post('/api/admin/wx-config', localWxConfig.value)
    if (data?.ok) {
      wxApiKeyConfigured.value = Boolean(data.data?.apiKeyConfigured)
      wxApiKeyHint.value = String(data.data?.apiKeyHint || '未配置')
      localWxConfig.value.apiKey = ''
      showAlert('微信配置已保存，全局应用生效', 'primary')
    }
    else {
      showAlert(data?.error || '保存失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    wxConfigSaving.value = false
  }
}

async function checkWxServiceHealth() {
  wxHealthChecking.value = true
  try {
    const { data } = await api.get('/api/admin/wx-config/health')
    const statusCode = Number(data?.data?.statusCode || 0)
    wxHealth.value = {
      status: 'reachable',
      message: statusCode ? `服务可达（HTTP ${statusCode}）` : '服务可达',
      checkedAt: Date.now(),
    }
  }
  catch (error: any) {
    const payload = error?.response?.data
    wxHealth.value = {
      status: 'unavailable',
      message: String(payload?.error || '服务暂时不可用，请检查配置和本机协议服务'),
      checkedAt: Date.now(),
    }
  }
  finally {
    wxHealthChecking.value = false
  }
}

async function handleResetWxConfig() {
  localWxConfig.value = {
    enabled: true,
    apiBase: 'http://127.0.0.1:8059/api',
    apiKey: '',
    proxyApiUrl: 'http://127.0.0.1:8059/api',
    appId: 'wx5306c5978fdb76e4',
    autoAddAccount: true,
    userIsolation: true,
  }
  showAlert('微信配置已重置为默认值', 'primary')
}

async function loadSystemConfig() {
  systemConfigLoading.value = true
  try {
    const { data } = await api.get('/api/admin/system-config')
    if (data?.ok) {
      if (data.data.saved) {
        localSystemConfig.value = { ...data.data.saved }
      }
      if (data.data.default) {
        defaultSystemConfig.value = { ...data.data.default }
      }
    }
  }
  catch (e: any) {
    console.error('加载系统配置失败:', e)
  }
  finally {
    systemConfigLoading.value = false
  }
}

async function loadRuntimeDoctor() {
  runtimeDoctorLoading.value = true
  runtimeDoctorError.value = ''
  try {
    const { data } = await api.get('/api/admin/doctor')
    if (data?.ok && data.data) {
      runtimeDoctor.value = data.data
    }
    else {
      runtimeDoctorError.value = String(data?.error || '无法读取运行环境状态')
    }
  }
  catch (error: any) {
    runtimeDoctorError.value = String(error?.response?.data?.error || '无法读取运行环境状态')
  }
  finally {
    runtimeDoctorLoading.value = false
  }
}

async function handleSaveSystemConfig() {
  systemConfigSaving.value = true
  try {
    const { data } = await api.post('/api/admin/system-config', localSystemConfig.value)
    if (data?.ok) {
      showAlert('系统配置已保存并立即生效，无需重启项目', 'primary')
    }
    else {
      showAlert(data?.error || '保存失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

async function handleResetSystemConfig() {
  systemConfigSaving.value = true
  try {
    const { data } = await api.post('/api/admin/system-config/reset')
    if (data?.ok) {
      localSystemConfig.value = { ...data.data.saved }
      showAlert('系统配置已重置为默认值', 'primary')
    }
    else {
      showAlert(data?.error || '重置失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(`重置失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

onMounted(() => {
  fetchCards()
  fetchUsers()
  fetchLoginLogs()
  loadSystemConfig()
  loadRuntimeDoctor()
  loadWxConfig()
  fetchCardClaimStatus()
})

// ========== 审计日志 ==========
interface AuditEntry {
  id: string
  timestamp: number
  actor: string
  action: string
  target: string
  details: Record<string, any> | null
  ip: string
  severity: 'info' | 'warning' | 'danger'
}

const auditEntries = ref<AuditEntry[]>([])
const auditLoading = ref(false)
const auditError = ref('')
const auditFilterActor = ref('')
const auditFilterAction = ref('')

// 告警规则状态提前声明，供 watch 引用
const alertRules = ref<AlertRule[]>([])
const alertTriggers = ref<AlertTrigger[]>([])
const alertLoading = ref(false)
const alertError = ref('')
const auditFilterSeverity = ref('')

async function fetchAuditLogs() {
  auditLoading.value = true
  auditError.value = ''
  try {
    const params: Record<string, string> = { limit: '100' }
    if (auditFilterActor.value)
      params.actor = auditFilterActor.value
    if (auditFilterAction.value)
      params.action = auditFilterAction.value
    if (auditFilterSeverity.value)
      params.severity = auditFilterSeverity.value
    const { data } = await api.get('/api/admin/audit-log', { params })
    if (data?.ok && data.data) {
      auditEntries.value = Array.isArray(data.data.entries) ? data.data.entries : []
    }
    else {
      auditError.value = String(data?.error || '无法读取审计日志')
    }
  }
  catch (error: any) {
    auditError.value = String(error?.response?.data?.error || '无法读取审计日志')
  }
  finally {
    auditLoading.value = false
  }
}

function formatAuditTime(ts: number) {
  if (!ts)
    return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function severityClass(sev: string) {
  if (sev === 'danger')
    return 'text-red-600 dark:text-red-400'
  if (sev === 'warning')
    return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-600 dark:text-gray-400'
}

function severityLabel(sev: string) {
  if (sev === 'danger')
    return '危险'
  if (sev === 'warning')
    return '警告'
  return '常规'
}

watch(activeTab, (tab) => {
  if (tab === 'card' && !cardLogs.value.length) {
    fetchCardLogs()
  }
  if (tab === 'audit' && !auditEntries.value.length) {
    fetchAuditLogs()
  }
  if (tab === 'alert' && !alertRules.value.length) {
    fetchAlertRules()
  }
  if (tab === 'announcement') {
    fetchAnnouncement()
  }
})

// ========== 告警规则 ==========
interface AlertRule {
  id: string
  name: string
  description: string
  condition: string
  threshold: number
  channel: string
  endpoint: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface AlertTrigger {
  id: string
  ruleId: string
  ruleName: string
  condition: string
  threshold: number
  actualValue: number
  username: string
  triggeredAt: number
  channel: string
}

const showAlertRuleModal = ref(false)
const newAlertRule = ref({
  name: '',
  description: '',
  condition: 'consecutive_failures',
  threshold: 3,
  channel: 'log',
  endpoint: '',
  token: '',
})

const conditionLabels: Record<string, string> = {
  consecutive_failures: '连续失败次数',
  offline_duration: '离线时长（秒）',
  task_error_count: '任务错误总数',
}

const channelLabels: Record<string, string> = {
  webhook: 'Webhook',
  log: '系统日志',
  qmsg: 'Qmsg',
  serverchan: 'Server酱',
  pushplus: 'PushPlus',
  pushplushxtrip: 'PushPlus(葫芦侠)',
  dingtalk: '钉钉',
  wecom: '企业微信',
  bark: 'Bark',
  gocqhttp: 'GoCQHTTP',
  onebot: 'OneBot',
  atri: 'Atri',
  pushdeer: 'PushDeer',
  igot: 'iGot',
  telegram: 'Telegram',
  feishu: '飞书',
  ifttt: 'IFTTT',
  wecombot: '企业微信机器人',
  discord: 'Discord',
  wxpusher: 'WxPusher',
}

// 需要 Token 的渠道（webhook 用 endpoint，log 不需要）
const CHANNELS_NEEDING_TOKEN = new Set([
  'qmsg',
  'serverchan',
  'pushplus',
  'pushplushxtrip',
  'dingtalk',
  'wecom',
  'bark',
  'gocqhttp',
  'onebot',
  'atri',
  'pushdeer',
  'igot',
  'telegram',
  'feishu',
  'ifttt',
  'wecombot',
  'discord',
  'wxpusher',
])

const alertTest = ref({
  channel: 'log',
  endpoint: '',
  token: '',
})
const alertTestLoading = ref(false)
const alertTestResult = ref('')

async function sendAlertTest() {
  if (alertTest.value.channel === 'log') {
    alertTestResult.value = '系统日志渠道无需推送测试'
    return
  }
  alertTestLoading.value = true
  alertTestResult.value = ''
  try {
    const { data } = await api.post('/api/admin/alert-rules/test', alertTest.value)
    if (data?.ok) {
      alertTestResult.value = `测试推送成功：${data.data?.msg || '已发送'}`
      toast.success('测试告警已发送')
    }
    else {
      alertTestResult.value = `测试推送失败：${data?.error || '未知错误'}`
      toast.error(alertTestResult.value)
    }
  }
  catch (error: any) {
    alertTestResult.value = `测试推送失败：${error?.response?.data?.error || error?.message || '未知错误'}`
    toast.error(alertTestResult.value)
  }
  finally {
    alertTestLoading.value = false
  }
}

async function fetchAlertRules() {
  alertLoading.value = true
  alertError.value = ''
  try {
    const { data } = await api.get('/api/admin/alert-rules')
    if (data?.ok && data.data) {
      alertRules.value = Array.isArray(data.data.rules) ? data.data.rules : []
      alertTriggers.value = Array.isArray(data.data.triggers) ? data.data.triggers : []
    }
    else {
      alertError.value = String(data?.error || '无法读取告警规则')
    }
  }
  catch (error: any) {
    alertError.value = String(error?.response?.data?.error || '无法读取告警规则')
  }
  finally {
    alertLoading.value = false
  }
}

async function createAlertRule() {
  if (!newAlertRule.value.name.trim()) {
    toast.error('请输入规则名称')
    return
  }
  try {
    await api.post('/api/admin/alert-rules', newAlertRule.value)
    toast.success('规则已创建')
    showAlertRuleModal.value = false
    newAlertRule.value = {
      name: '',
      description: '',
      condition: 'consecutive_failures',
      threshold: 3,
      channel: 'log',
      endpoint: '',
      token: '',
    }
    await fetchAlertRules()
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || '创建失败')
  }
}

async function toggleAlertRule(id: string, enabled: boolean) {
  try {
    await api.post(`/api/admin/alert-rules/${id}/toggle`, { enabled })
    await fetchAlertRules()
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || '操作失败')
  }
}

async function deleteAlertRule(id: string) {
  try {
    await api.delete(`/api/admin/alert-rules/${id}`)
    toast.success('规则已删除')
    await fetchAlertRules()
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || '删除失败')
  }
}

function formatAlertTime(ts: number) {
  if (!ts)
    return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// ========== 公告管理 ==========
const announcementContent = ref('')
const announcementShowOnce = ref(false)
const announcementLoading = ref(false)
const announcementSaving = ref(false)
const announcementError = ref('')
const announcementSavedAt = ref(0)

async function fetchAnnouncement() {
  announcementLoading.value = true
  announcementError.value = ''
  try {
    const { data } = await api.get('/api/announcement')
    if (data?.ok && data.data) {
      announcementContent.value = data.data.content || ''
      announcementShowOnce.value = !!data.data.showOnce
      announcementSavedAt.value = data.data.updatedAt || 0
    }
    else {
      announcementError.value = String(data?.error || '无法读取公告')
    }
  }
  catch (error: any) {
    announcementError.value = String(error?.response?.data?.error || '无法读取公告')
  }
  finally {
    announcementLoading.value = false
  }
}

async function saveAnnouncement() {
  if (!announcementContent.value.trim()) {
    toast.error('公告内容不能为空')
    return
  }
  announcementSaving.value = true
  announcementError.value = ''
  try {
    const { data } = await api.post('/api/admin/announcement', {
      content: announcementContent.value,
      showOnce: announcementShowOnce.value,
    })
    if (data?.ok) {
      announcementSavedAt.value = data.data?.updatedAt || Date.now()
      toast.success('公告已保存')
    }
    else {
      announcementError.value = String(data?.error || '保存失败')
      toast.error(announcementError.value)
    }
  }
  catch (error: any) {
    announcementError.value = String(error?.response?.data?.error || '保存失败')
    toast.error(announcementError.value)
  }
  finally {
    announcementSaving.value = false
  }
}

function clearAnnouncement() {
  announcementContent.value = ''
  announcementShowOnce.value = false
  announcementSavedAt.value = 0
  toast.success('已清空输入，保存后公告将停用')
}

/** Simple Markdown to HTML */
function renderMarkdown(text: string) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong></strong>')
    .replace(/\n/g, '<br>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="" target="_blank" rel="noopener" class="text-blue-500 underline"></a>')
}
</script>

<template>
  <div class="admin-panel">
    <PageHeader title="管理后台" subtitle="卡密、用户、日志与系统配置" />

    <div class="border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
      <div class="border-b border-gray-200 dark:border-gray-700">
        <nav class="scrollbar-none flex gap-1 overflow-x-auto p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            :class="activeTab === tab.key
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
            :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="ds-page">
        <!-- 卡密管理 -->
        <div v-if="activeTab === 'card'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              卡密管理
            </h3>
            <div class="flex gap-2">
              <BaseButton variant="secondary" size="sm" @click="fetchCards">
                刷新
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
                创建卡密
              </BaseButton>
            </div>
          </div>

          <!-- 卡密领取功能开关 -->
          <div class="flex items-center justify-between border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h4 class="text-sm text-gray-900 font-medium dark:text-white">
                卡密领取功能
              </h4>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                开启后，用户注册时可免费领取一张时间卡密
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-500">
                库存: <span class="font-medium" :class="unusedTimeCardsCount > 0 ? 'text-green-600' : 'text-red-600'">{{ unusedTimeCardsCount }}</span> 张
              </span>
              <BaseSwitch
                v-model="cardClaimEnabled"
                :disabled="cardClaimLoading"
                @update:model-value="toggleCardClaimStatus"
              />
            </div>
          </div>

          <div class="flex gap-2">
            <button
              class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'all'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'all' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'all'"
            >
              全部
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'time'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'time' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'time'"
            >
              时间卡密
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'quota'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'quota' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'quota'"
            >
              配额卡密
            </button>
          </div>

          <div class="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow dark:bg-gray-800">
            <input
              v-model="searchQuery"
              placeholder="搜索卡密、描述或使用者..."
              class="h-8 w-64 border border-gray-300 rounded-lg bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
            >
            <select
              v-model="filterStatus"
              class="h-8 border border-gray-300 rounded-lg bg-white px-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">
                全部状态
              </option>
              <option value="unused">
                未使用
              </option>
              <option value="used">
                已使用
              </option>
              <option value="enabled">
                已启用
              </option>
              <option value="disabled">
                已禁用
              </option>
            </select>
          </div>

          <div v-if="selectedCards.size > 0" class="flex items-center gap-3 rounded-lg p-3" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1);">
            <span style="color: var(--theme-primary);">
              已选择 {{ selectedCards.size }} 个卡密
            </span>
            <BaseButton variant="secondary" size="sm" @click="copySelectedCards">
              一键复制
            </BaseButton>
            <BaseButton variant="danger" size="sm" @click="deleteSelectedCards">
              批量删除
            </BaseButton>
            <button
              class="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
              @click="selectedCards.clear(); selectAll = false"
            >
              清除选择
            </button>
          </div>

          <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left">
                      <input
                        v-model="selectAll"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectAll"
                      >
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      卡密
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      描述
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      类型
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      数值
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      使用者
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      生成时间
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      使用时间
                    </th>
                    <th class="px-4 py-2 text-right text-xs text-gray-500 font-medium dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr v-for="card in filteredCards" :key="card.code" class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td class="px-3 py-2">
                      <input
                        :checked="selectedCards.has(card.code)"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectCard(card.code)"
                      >
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <code class="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{{ card.code }}</code>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                      {{ card.description }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <span
                        class="inline-flex rounded-full px-2 py-0.5 text-xs"
                        :class="card.type === 'quota' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'"
                      >
                        {{ getCardTypeLabel(card) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                      {{ getCardValueLabel(card) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <span
                        class="inline-flex rounded-full px-2 py-0.5 text-xs"
                        :class="card.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'"
                      >
                        {{ card.enabled ? '启用' : '禁用' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.usedBy || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.createdAt ? new Date(card.createdAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.usedAt ? new Date(card.usedAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-right text-sm">
                      <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="copyCode(card.code)">
                        复制
                      </button>
                      <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="toggleCardStatus(card)">
                        {{ card.enabled ? '禁用' : '启用' }}
                      </button>
                      <button class="text-red-600 dark:text-red-400 hover:text-red-900" @click="deleteCard(card)">
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="filteredCards.length === 0">
                    <td colspan="10" class="px-4 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无卡密
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showCreateModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showCreateModal = false"
          >
            <div class="max-w-md w-full rounded-lg bg-white p-5 dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                创建卡密
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    描述
                  </label>
                  <BaseInput
                    v-model="newCard.description"
                    placeholder="例如：月卡-2024"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    卡密类型
                  </label>
                  <div class="flex gap-4">
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="time"
                        class="text-blue-600 focus:ring-blue-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">时间卡（增加使用时长）</span>
                    </label>
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="quota"
                        class="text-orange-600 focus:ring-orange-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">额度卡（增加账号额度）</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    {{ newCard.type === 'quota' ? '额度数量' : '天数' }}
                  </label>
                  <BaseInput
                    v-model.number="newCard.days"
                    type="number"
                    :placeholder="newCard.type === 'quota' ? '可添加的账号数量' : '天数'"
                  />
                  <p v-if="newCard.type === 'time'" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    输入-1表示永久，其他数字表示天数
                  </p>
                  <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户使用后可增加的账号额度数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    数量
                  </label>
                  <BaseInput
                    v-model.number="newCard.count"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    批量创建数量（1-100），批量创建后会自动导出文件
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showCreateModal = false">
                  取消
                </BaseButton>
                <BaseButton variant="primary" size="sm" @click="createCard">
                  创建
                </BaseButton>
              </div>
            </div>
          </div>

          <!-- 卡密消费流水 -->
          <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                  <div class="i-carbon-data-view-alt" />
                  卡密消费流水
                </h4>
                <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                  记录卡密的注册激活、续费使用与领取记录，共 {{ cardLogsTotal }} 条
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <div class="flex overflow-hidden border border-gray-200 rounded-lg dark:border-gray-600">
                  <button
                    v-for="option in (['all', 'register', 'renew', 'claim'] as const)"
                    :key="option"
                    class="px-3 py-1.5 text-xs font-medium transition-colors"
                    :class="cardLogFilter === option
                      ? 'text-white'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
                    :style="cardLogFilter === option ? { backgroundColor: 'var(--theme-primary)' } : {}"
                    @click="cardLogFilter = option; fetchCardLogs()"
                  >
                    {{ option === 'all' ? '全部' : cardLogLabels[option] }}
                  </button>
                </div>
                <BaseButton variant="secondary" size="sm" :loading="cardLogsLoading" @click="fetchCardLogs">
                  刷新
                </BaseButton>
                <BaseButton variant="danger" size="sm" @click="clearCardLogs">
                  清空
                </BaseButton>
              </div>
            </div>

            <div class="mt-3 overflow-hidden border border-gray-200 rounded-lg dark:border-gray-700">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead class="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        类型
                      </th>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        卡密
                      </th>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        用户
                      </th>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        卡类型
                      </th>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        数值
                      </th>
                      <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                        时间
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="log in cardLogs" :key="`${log.at}-${log.cardCode}-${log.action}`" class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td class="whitespace-nowrap px-4 py-2">
                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs" :class="cardLogColors[log.action]">
                          {{ cardLogLabels[log.action] || log.action }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-2">
                        <code class="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{{ log.cardCode }}</code>
                      </td>
                      <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                        {{ log.username || '（未登录领取）' }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {{ log.cardType === 'quota' ? '额度卡' : '时间卡' }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                        {{ log.days === -1 ? '永久' : `${log.days} ${log.cardType === 'quota' ? '额度' : '天'}` }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {{ log.at ? new Date(log.at).toLocaleString('zh-CN', { hour12: false }) : '-' }}
                      </td>
                    </tr>
                    <tr v-if="cardLogsLoading">
                      <td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        加载中...
                      </td>
                    </tr>
                    <tr v-else-if="cardLogs.length === 0">
                      <td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        暂无卡密消费流水
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab === 'user'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              用户管理
            </h3>
            <BaseButton variant="primary" size="sm" @click="fetchUsers">
              刷新
            </BaseButton>
          </div>

          <div v-if="usersLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="overflow-hidden border border-gray-200 rounded-lg dark:border-gray-700">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      用户名
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      角色
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      额度
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      时长
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      过期时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-for="user in users" :key="user.username">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ user.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        {{ user.role === 'admin' ? '管理员' : '用户' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'"
                      >
                        {{ user.role === 'admin' ? '无限制' : `${user.accountLimit || 2}个` }}
                      </span>
                      <span v-if="user.role !== 'admin'" class="ml-1 text-[10px] text-gray-400">
                        (推送{{ user.pushLimit || 50 }}/操作{{ user.operationRateLimit || 30 }})
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ user.card ? getDaysLabel(user.card.days) : '无' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm" :class="isExpired(user.card) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">
                      {{ formatDate(user.card?.expiresAt || null) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        v-if="user.card"
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200')"
                      >
                        {{ user.card.enabled === false ? '封禁' : (isExpired(user.card) ? '已过期' : '正常') }}
                      </span>
                      <span v-else class="text-gray-500 dark:text-gray-400">-</span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                      <button
                        class="mr-3 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                        @click="openEditModal(user)"
                      >
                        编辑
                      </button>
                      <button
                        v-if="user.card"
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="toggleUserStatus(user)"
                      >
                        {{ user.card.enabled === false ? '解封' : '封禁' }}
                      </button>
                      <button
                        v-if="user.username !== currentUsername"
                        class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        @click="deleteUser(user)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="users.length === 0">
                    <td colspan="8" class="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无用户
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showEditModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showEditModal = false"
          >
            <div class="max-w-md w-full rounded-lg bg-white p-5 dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                编辑用户：{{ selectedUser?.username }}
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    用户名
                  </label>
                  <BaseInput
                    v-model="editForm.newUsername"
                    placeholder="输入新用户名（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户名只能包含字母、数字和下划线，长度3-32位
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    新密码
                  </label>
                  <BaseInput
                    v-model="editForm.password"
                    type="password"
                    placeholder="输入新密码（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    密码长度至少6位，需包含大写字母、小写字母、数字、特殊符号中的至少两种
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    账号额度
                  </label>
                  <BaseInput
                    v-model.number="editForm.accountLimit"
                    type="number"
                    min="1"
                    placeholder="可添加的账号数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户最多可添加的农场账号数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    过期时间
                  </label>
                  <div class="flex items-center gap-3">
                    <input
                      v-model="editForm.isPermanent"
                      type="checkbox"
                      class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                    >
                    <span class="text-sm text-gray-600 dark:text-gray-400">永久有效</span>
                  </div>
                  <input
                    v-if="!editForm.isPermanent"
                    v-model="editForm.expiresAt"
                    type="datetime-local"
                    class="mt-2 w-full border border-gray-200 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showEditModal = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :disabled="editLoading"
                  @click="handleEdit"
                >
                  {{ editLoading ? '保存中...' : '保存' }}
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 登录日志 -->
        <div v-else-if="activeTab === 'log'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              登录日志
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton
                variant="danger"
                size="sm"
                @click="openClearLogsConfirm"
              >
                清空日志
              </BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="loginLogsLoading"
                @click="fetchLoginLogs"
              >
                刷新
              </BaseButton>
            </div>
          </div>

          <div class="overflow-hidden border border-gray-200 rounded-lg bg-white dark:border-gray-700 dark:bg-gray-800">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      事件
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      用户名
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      错误类型
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      IP地址
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      浏览器
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-if="loginLogsLoading">
                    <td colspan="6" class="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                      加载中...
                    </td>
                  </tr>
                  <tr v-else-if="loginLogs.length === 0">
                    <td colspan="6" class="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                      暂无登录日志
                    </td>
                  </tr>
                  <tr v-for="log in loginLogs" :key="log.id">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ formatLogTime(log.timestamp) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="getEventClass(log.event)"
                      >
                        {{ getEventLabel(log.event) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ log.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ getErrorTypeLabel(log.errorType) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-600 font-mono dark:text-gray-300">
                      {{ log.ip }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                      {{ parseBrowser(log.userAgent) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="loginLogsTotal > 0" class="border-t border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              共 {{ loginLogsTotal }} 条记录
            </div>
          </div>

          <!-- 清空日志确认弹窗 -->
          <div
            v-if="showClearLogsConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showClearLogsConfirm = false"
          >
            <div class="max-w-md w-full rounded-lg bg-white p-5 dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                确认清空日志
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                确定要清空所有登录日志吗？此操作不可恢复。
              </p>
              <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
                当前共有 {{ loginLogsTotal }} 条记录
              </p>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showClearLogsConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="clearLogsLoading"
                  @click="confirmClearLogs"
                >
                  确认清空
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 审计日志 -->
        <div v-else-if="activeTab === 'audit'" class="space-y-4">
          <div class="ds-surface p-4">
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="text-base font-semibold">
                操作审计
              </h3>
              <div class="ml-auto flex flex-wrap items-center gap-2">
                <BaseInput
                  v-model="auditFilterActor"
                  placeholder="操作者"
                  class="w-32"
                  @keyup.enter="fetchAuditLogs"
                />
                <BaseInput
                  v-model="auditFilterAction"
                  placeholder="操作类型"
                  class="w-36"
                  @keyup.enter="fetchAuditLogs"
                />
                <BaseSelect
                  v-model="auditFilterSeverity"
                  class="w-28"
                >
                  <option value="">
                    全部级别
                  </option>
                  <option value="info">
                    常规
                  </option>
                  <option value="warning">
                    警告
                  </option>
                  <option value="danger">
                    危险
                  </option>
                </BaseSelect>
                <BaseButton size="sm" :loading="auditLoading" @click="fetchAuditLogs">
                  刷新
                </BaseButton>
              </div>
            </div>
          </div>

          <div v-if="auditError" class="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
            {{ auditError }}
          </div>
          <div v-else-if="!auditLoading && !auditEntries.length" class="ds-surface p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无审计记录
          </div>
          <div v-else-if="auditEntries.length" class="ds-surface overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium">
                      时间
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      操作者
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      操作
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      目标
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      级别
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      IP
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr v-for="entry in auditEntries" :key="entry.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td class="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ formatAuditTime(entry.timestamp) }}
                    </td>
                    <td class="px-4 py-3 font-medium">
                      {{ entry.actor }}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ entry.action }}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ entry.target }}
                    </td>
                    <td class="px-4 py-3">
                      <span :class="severityClass(entry.severity)">{{ severityLabel(entry.severity) }}</span>
                    </td>
                    <td class="px-4 py-3 text-gray-500 dark:text-gray-500">
                      {{ entry.ip || '-' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 告警规则 -->
        <div v-else-if="activeTab === 'alert'" class="space-y-4">
          <div class="ds-surface p-4">
            <div class="flex items-center gap-3">
              <h3 class="text-base font-semibold">
                告警规则
              </h3>
              <div class="ml-auto">
                <BaseButton size="sm" @click="showAlertRuleModal = true">
                  新建规则
                </BaseButton>
              </div>
            </div>
          </div>

          <div v-if="alertError" class="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
            {{ alertError }}
          </div>

          <div v-if="alertRules.length" class="ds-surface overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium">
                      名称
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      条件
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      阈值
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      通道
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      状态
                    </th>
                    <th class="px-4 py-3 text-left font-medium">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr v-for="rule in alertRules" :key="rule.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td class="px-4 py-3 font-medium">
                      {{ rule.name }}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ conditionLabels[rule.condition] || rule.condition }}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ rule.threshold }}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {{ channelLabels[rule.channel] || rule.channel }}
                    </td>
                    <td class="px-4 py-3">
                      <BaseSwitch
                        :model-value="rule.enabled"
                        @update:model-value="(val: boolean | undefined) => toggleAlertRule(rule.id, val === true)"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <BaseButton size="sm" variant="danger" @click="deleteAlertRule(rule.id)">
                        删除
                      </BaseButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="alertTriggers.length" class="ds-surface p-4">
            <h4 class="mb-3 text-sm font-medium">
              最近触发记录
            </h4>
            <div class="space-y-2">
              <div v-for="trigger in alertTriggers" :key="trigger.id" class="flex items-center justify-between border-b pb-2 text-sm dark:border-gray-700">
                <div>
                  <span class="font-medium">{{ trigger.ruleName }}</span>
                  <span class="ml-2 text-gray-500">触发值: {{ trigger.actualValue }} / 阈值: {{ trigger.threshold }}</span>
                </div>
                <span class="text-gray-500">{{ formatAlertTime(trigger.triggeredAt) }}</span>
              </div>
            </div>
          </div>

          <!-- 测试推送 -->
          <div class="ds-surface p-4">
            <h4 class="mb-3 text-sm font-medium">
              测试推送
            </h4>
            <div class="grid gap-3 sm:grid-cols-3">
              <BaseSelect v-model="alertTest.channel" label="渠道">
                <option value="log">
                  系统日志
                </option>
                <option v-for="(label, key) in channelLabels" :key="key" :value="key">
                  {{ label }}
                </option>
              </BaseSelect>
              <BaseInput
                v-if="alertTest.channel === 'webhook'"
                v-model="alertTest.endpoint"
                label="Webhook URL"
                placeholder="https://example.com/hook"
                class="sm:col-span-2"
              />
              <BaseInput
                v-else-if="CHANNELS_NEEDING_TOKEN.has(alertTest.channel)"
                v-model="alertTest.token"
                label="推送 Token"
                placeholder="该渠道的推送 Token"
                class="sm:col-span-2"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <BaseButton size="sm" :loading="alertTestLoading" :disabled="alertTest.channel === 'log'" @click="sendAlertTest">
                发送测试消息
              </BaseButton>
              <span v-if="alertTestResult" class="text-sm text-gray-600 dark:text-gray-400">
                {{ alertTestResult }}
              </span>
            </div>
          </div>
        </div>

        <!-- 公告管理 -->
        <div v-else-if="activeTab === 'announcement'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              公告管理
            </h3>
            <BaseButton variant="secondary" size="sm" :loading="announcementLoading" @click="fetchAnnouncement">
              刷新
            </BaseButton>
          </div>

          <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                  <div class="i-carbon-bullhorn" />
                  登录公告
                </h4>
                <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                  编辑后保存，用户在登录后查看首页弹窗公告。留空并保存即停用公告。
                </p>
              </div>
              <span
                v-if="announcementSavedAt"
                class="shrink-0 text-xs text-gray-400 dark:text-gray-500"
              >
                上次保存：{{ new Date(announcementSavedAt).toLocaleString('zh-CN', { hour12: false }) }}
              </span>
            </div>

            <div class="mt-4">
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                公告内容
              </label>
              <textarea
                v-model="announcementContent"
                rows="6"
                class="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[var(--theme-primary)]/30"
                placeholder="例如：欢迎使用 QQ 农场自动化助手，最新版本 v2.5.0 已发布，新增公告管理、告警推送等功能…"
              />
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-4">
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  v-model="announcementShowOnce"
                  type="checkbox"
                  class="h-4 w-4 border-gray-300 rounded text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
                >
                仅展示一次（用户标记已读后不再弹出）
              </label>
              <span class="text-xs text-gray-400 dark:text-gray-500">
                当前状态：{{ announcementShowOnce ? '单次展示' : '每次登录展示' }}
              </span>
            </div>

            <p v-if="announcementError" class="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {{ announcementError }}
            </p>

            <div class="mt-4 flex flex-wrap gap-3">
              <BaseButton variant="primary" :loading="announcementSaving" :disabled="!announcementContent.trim()" @click="saveAnnouncement">
                保存公告
              </BaseButton>
              <BaseButton variant="secondary" @click="clearAnnouncement">
                清空内容
              </BaseButton>
            </div>
          </div>

          <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
              <div class="i-carbon-view" />
              预览效果
            </h4>
            <p class="mb-3 mt-1 text-xs text-[var(--color-text-secondary)]">
              以下为登录后公告弹窗的展示样式。
            </p>
            <div v-if="announcementContent.trim()" class="border border-gray-200 rounded-lg bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
              <div class="prose prose-sm max-w-none text-gray-800 dark:text-gray-200">
                <div v-html="renderMarkdown(announcementContent)" />
              </div>
              <p class="mt-3 text-xs text-gray-400 dark:text-gray-500">
                —— {{ announcementShowOnce ? '仅展示一次，阅读后自动隐藏' : '每次登录展示' }}
              </p>
            </div>
            <p v-else class="text-sm text-gray-400 dark:text-gray-500">
              公告内容为空，登录后不会弹出公告。
            </p>
          </div>
        </div>

        <!-- 系统配置 -->
        <div v-else-if="activeTab === 'system'" class="space-y-4">
          <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            系统配置
          </h3>

          <div class="ds-page">
            <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                    <div class="i-carbon-health-cross" />
                    运行环境检查
                  </h4>
                  <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                    检查本机数据目录、版本信息和必要资源，不会修改配置。
                  </p>
                </div>
                <BaseButton variant="secondary" size="sm" :loading="runtimeDoctorLoading" @click="loadRuntimeDoctor">
                  <div v-if="!runtimeDoctorLoading" class="i-carbon-renew" />
                  刷新检查
                </BaseButton>
              </div>

              <div v-if="runtimeDoctor" class="grid mt-4 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div
                  v-for="check in runtimeDoctor.checks"
                  :key="check.id"
                  class="flex items-start gap-2 border px-3 py-2 text-sm"
                  :class="check.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
                    : 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100'"
                >
                  <div :class="check.status === 'ok' ? 'i-carbon-checkmark-filled text-emerald-600' : 'i-carbon-warning-filled text-rose-600'" />
                  <div class="min-w-0">
                    <div class="font-medium">
                      {{ check.label }}
                    </div>
                    <div class="mt-0.5 text-xs opacity-80">
                      {{ check.message }}
                    </div>
                  </div>
                </div>
              </div>
              <p v-else-if="!runtimeDoctorLoading" class="mt-4 text-sm text-[var(--color-text-secondary)]">
                尚未获取运行环境检查结果。
              </p>
              <p v-if="runtimeDoctorError" class="mt-3 text-sm text-[var(--color-danger)]">
                {{ runtimeDoctorError }}
              </p>
              <p v-if="runtimeDoctor" class="mt-3 text-xs text-[var(--color-text-secondary)]">
                版本 {{ runtimeDoctor.version }} · Node {{ runtimeDoctor.nodeVersion }}
              </p>
            </div>

            <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                <div class="i-carbon-settings" />
                系统配置
              </h4>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <BaseInput
                  v-model="localSystemConfig.serverUrl"
                  label="服务器地址"
                  type="text"
                  placeholder="wss://..."
                  class="col-span-2"
                />
                <BaseInput
                  v-model="localSystemConfig.clientVersion"
                  label="客户端版本"
                  type="text"
                  placeholder="1.7.0.7_20260313"
                  class="col-span-2"
                />
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
                  <div class="flex gap-2">
                    <button
                      v-for="option in platformOptions"
                      :key="option.value"
                      class="rounded-lg px-3 py-1.5 text-sm transition-all"
                      :class="localSystemConfig.platform === option.value
                        ? 'text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                      :style="localSystemConfig.platform === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                      @click="localSystemConfig.platform = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
                  <div class="flex gap-2">
                    <button
                      v-for="option in osOptions"
                      :key="option.value"
                      class="rounded-lg px-3 py-1.5 text-sm transition-all"
                      :class="localSystemConfig.os === option.value
                        ? 'text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                      :style="localSystemConfig.os === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                      @click="localSystemConfig.os = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="mt-3 flex justify-end gap-2">
                <BaseButton
                  variant="outline"
                  size="sm"
                  :loading="wxHealthChecking"
                  @click="checkWxServiceHealth"
                >
                  检查服务
                </BaseButton>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="systemConfigSaving"
                  @click="handleResetSystemConfig"
                >
                  重置
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="systemConfigSaving"
                  @click="handleSaveSystemConfig"
                >
                  保存
                </BaseButton>
              </div>
              <p
                v-if="wxHealth.status !== 'idle'"
                class="mt-3 text-xs"
                :class="wxHealth.status === 'reachable' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'"
              >
                {{ wxHealth.message }}
              </p>
            </div>

            <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                <div class="i-carbon-logo-wechat" />
                微信配置
              </h4>

              <div class="mb-3 rounded p-2 text-xs" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1); color: var(--theme-primary);">
                <div>• 启用微信登录：关闭后普通用户无法使用微信扫码登录</div>
                <div>• 自动添加账号：扫码成功后自动添加账号，关闭则只返回Code</div>
                <div>• 用户隔离：开启后普通用户只能看到自己的账号</div>
              </div>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <div class="col-span-2">
                  <BaseSwitch
                    v-model="localWxConfig.enabled"
                    label="启用微信登录"
                  />
                </div>
                <BaseInput
                  v-model="localWxConfig.apiBase"
                  label="API地址"
                  type="text"
                  placeholder="http://127.0.0.1:8059/api"
                  class="col-span-2"
                />
                <BaseInput
                  v-model="localWxConfig.apiKey"
                  label="API密钥"
                  type="password"
                  :placeholder="wxApiKeyConfigured ? '留空以保留当前密钥' : '可选，用于代理模式'"
                  class="col-span-2"
                />
                <p class="col-span-2 text-xs text-[var(--color-text-secondary)] -mt-2">
                  当前密钥状态：{{ wxApiKeyHint }}
                </p>
                <BaseInput
                  v-model="localWxConfig.proxyApiUrl"
                  label="代理API地址"
                  type="text"
                  placeholder="http://127.0.0.1:8059/api"
                  class="col-span-2"
                />
                <BaseSwitch
                  v-model="localWxConfig.autoAddAccount"
                  label="自动添加账号"
                />
                <BaseSwitch
                  v-model="localWxConfig.userIsolation"
                  label="用户隔离"
                />
              </div>

              <div class="mt-3 flex justify-end gap-2">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="wxConfigSaving"
                  @click="handleResetWxConfig"
                >
                  重置
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="wxConfigSaving"
                  @click="handleSaveWxConfig"
                >
                  保存
                </BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />

    <!-- 新建告警规则弹窗 -->
    <div v-if="showAlertRuleModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showAlertRuleModal = false">
      <div class="ds-surface max-w-md w-full p-6">
        <h3 class="mb-4 text-lg font-bold">
          新建告警规则
        </h3>
        <div class="space-y-3">
          <BaseInput
            v-model="newAlertRule.name"
            label="规则名称"
            placeholder="如：连续失败3次告警"
          />
          <BaseInput
            v-model="newAlertRule.description"
            label="描述"
            placeholder="可选"
          />
          <BaseSelect
            v-model="newAlertRule.condition"
            label="条件类型"
          >
            <option value="consecutive_failures">
              连续失败次数
            </option>
            <option value="offline_duration">
              离线时长（秒）
            </option>
            <option value="task_error_count">
              任务错误总数
            </option>
          </BaseSelect>
          <BaseInput
            v-model.number="newAlertRule.threshold"
            type="number"
            label="阈值"
            placeholder="如：3"
          />
          <BaseSelect
            v-model="newAlertRule.channel"
            label="告警通道"
          >
            <option value="log">
              系统日志
            </option>
            <option v-for="(label, key) in channelLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </BaseSelect>
          <BaseInput
            v-if="newAlertRule.channel === 'webhook'"
            v-model="newAlertRule.endpoint"
            label="Webhook URL"
            placeholder="https://example.com/hook"
          />
          <BaseInput
            v-if="CHANNELS_NEEDING_TOKEN.has(newAlertRule.channel)"
            v-model="newAlertRule.token"
            label="推送 Token"
            placeholder="该渠道的推送 Token"
          />
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <BaseButton variant="secondary" size="sm" @click="showAlertRuleModal = false">
            取消
          </BaseButton>
          <BaseButton variant="primary" size="sm" @click="createAlertRule">
            创建
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="postcss">
</style>
