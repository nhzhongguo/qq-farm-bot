import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface WxLoginConfig {
  enabled: boolean
  configured: boolean
  mode: 'local' | 'proxy'
  autoAddAccount: boolean
  userIsolation: boolean
}

type WxLoginStatus = 'idle' | 'qr_loading' | 'qr_ready' | 'scanning' | 'confirming' | 'success' | 'error'

const defaultConfig: WxLoginConfig = {
  enabled: true,
  configured: false,
  mode: 'local',
  autoAddAccount: true,
  userIsolation: true,
}

function getErrorMessage(error: any, fallback: string): string {
  return String(error?.response?.data?.error || error?.response?.data?.message || error?.message || fallback)
}

export const useWxLoginStore = defineStore('wx-login', () => {
  const rawConfig = ref<WxLoginConfig>({ ...defaultConfig })
  const config = computed<WxLoginConfig>(() => ({ ...defaultConfig, ...rawConfig.value }))

  const isLoading = ref(false)
  const qrCode = ref<string | null>(null)
  const sessionId = ref('')
  const status = ref<WxLoginStatus>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')

  let generation = 0
  let checkInFlight = false

  function clearLoginState() {
    isLoading.value = false
    checkInFlight = false
    qrCode.value = null
    sessionId.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
  }

  function cancelRemoteSession(id: string) {
    if (id)
      void api.delete(`/api/wx-login/${encodeURIComponent(id)}`).catch(() => {})
  }

  function resetState() {
    const previousSessionId = sessionId.value
    generation += 1
    clearLoginState()
    cancelRemoteSession(previousSessionId)
  }

  async function loadConfigFromServer() {
    try {
      const response = await api.get('/api/user/wxlogin-config')
      rawConfig.value = response.data?.ok && response.data?.config
        ? { ...defaultConfig, ...response.data.config }
        : { ...defaultConfig }
    }
    catch {
      rawConfig.value = { ...defaultConfig }
    }
  }

  async function loadConfig() {
    await loadConfigFromServer()
  }

  async function getQRCode(): Promise<boolean> {
    const previousSessionId = sessionId.value
    const requestGeneration = generation + 1
    generation = requestGeneration
    clearLoginState()
    cancelRemoteSession(previousSessionId)
    isLoading.value = true
    status.value = 'qr_loading'
    statusMessage.value = '正在获取二维码...'

    try {
      const response = await api.post('/api/wx-login/qr', {}, { timeout: 15000 })
      const data = response.data?.data || {}
      const nextSessionId = String(data.sessionId || '')
      const nextQrCode = String(data.qrCode || '')
      if (requestGeneration !== generation) {
        cancelRemoteSession(nextSessionId)
        return false
      }
      if (!response.data?.ok || !nextSessionId || !nextQrCode)
        throw new Error(response.data?.error || '微信协议服务未返回有效二维码')

      sessionId.value = nextSessionId
      qrCode.value = nextQrCode
      status.value = 'qr_ready'
      statusMessage.value = '请使用微信扫码登录'
      return true
    }
    catch (error: any) {
      if (requestGeneration !== generation)
        return false
      status.value = 'error'
      statusMessage.value = '微信二维码获取失败'
      errorMessage.value = getErrorMessage(error, '微信协议服务未配置或未启动')
      return false
    }
    finally {
      if (requestGeneration === generation)
        isLoading.value = false
    }
  }

  async function checkLogin(): Promise<{ success: boolean, nickname?: string }> {
    if (!sessionId.value || checkInFlight || !['qr_ready', 'confirming'].includes(status.value))
      return { success: false }

    const requestGeneration = generation
    const currentSessionId = sessionId.value
    const resumableStatus: WxLoginStatus = status.value === 'confirming' ? 'confirming' : 'qr_ready'
    checkInFlight = true
    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    try {
      const response = await api.post('/api/wx-login/check', { sessionId: currentSessionId }, { timeout: 15000 })
      if (requestGeneration !== generation || currentSessionId !== sessionId.value)
        return { success: false }

      const data = response.data?.data || {}
      const nextStatus = String(data.status || '')
      if (nextStatus === 'waiting' || nextStatus === 'confirming') {
        status.value = nextStatus === 'confirming' ? 'confirming' : 'qr_ready'
        statusMessage.value = nextStatus === 'confirming' ? '已扫码，请在手机确认登录' : '等待扫码中'
        return { success: false }
      }
      if (nextStatus !== 'success')
        throw new Error(response.data?.error || '微信登录状态异常')

      status.value = 'success'
      statusMessage.value = data.nickname ? `登录成功：${data.nickname}` : '登录成功，正在获取农场 Code...'
      return {
        success: true,
        nickname: String(data.nickname || ''),
      }
    }
    catch (error: any) {
      if (requestGeneration !== generation || currentSessionId !== sessionId.value)
        return { success: false }
      const responseCode = String(error.response?.data?.code || '')
      if (error.response?.status === 429 && responseCode === 'CHECK_CAPACITY_REACHED') {
        status.value = resumableStatus
        statusMessage.value = '微信登录服务繁忙，正在重试...'
        errorMessage.value = ''
      }
      else {
        status.value = 'error'
        statusMessage.value = '微信登录失败'
        errorMessage.value = getErrorMessage(error, '微信登录状态检查失败')
      }
      return { success: false }
    }
    finally {
      if (requestGeneration === generation)
        checkInFlight = false
    }
  }

  async function getFarmCode(): Promise<{ success: boolean, code?: string }> {
    const currentSessionId = sessionId.value
    if (!currentSessionId)
      return { success: false }

    const requestGeneration = generation
    isLoading.value = true
    statusMessage.value = '正在获取 QQ 农场 Code...'

    try {
      const response = await api.post('/api/wx-login/code', { sessionId: currentSessionId }, { timeout: 15000 })
      if (requestGeneration !== generation || currentSessionId !== sessionId.value)
        return { success: false }

      const code = String(response.data?.data?.code || '').trim()
      if (!response.data?.ok || !code)
        throw new Error(response.data?.error || '微信协议服务未返回农场 Code')

      return { success: true, code }
    }
    catch (error: any) {
      if (requestGeneration !== generation)
        return { success: false }
      status.value = 'error'
      statusMessage.value = '农场 Code 获取失败'
      errorMessage.value = getErrorMessage(error, '农场 Code 获取失败')
      return { success: false }
    }
    finally {
      if (requestGeneration === generation)
        isLoading.value = false
    }
  }

  void loadConfig()

  return {
    config,
    isLoading,
    qrCode,
    sessionId,
    status,
    statusMessage,
    errorMessage,
    resetState,
    getQRCode,
    checkLogin,
    getFarmCode,
    loadConfigFromServer,
  }
})
