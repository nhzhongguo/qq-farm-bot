import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export type QQLoginStatus = 'idle' | 'loading' | 'waiting' | 'checking' | 'success' | 'expired' | 'error'

export interface QQLoginResult {
  success: boolean
  code?: string
  uin?: string
  nickname?: string
  avatar?: string
}

function isValidFarmCode(value: unknown): boolean {
  const code = String(value ?? '').trim()
  return code.length >= 16
    && code.length <= 512
    && !/\s/.test(code)
    && !Array.from(code).some((character) => {
      const characterCode = character.charCodeAt(0)
      return characterCode <= 31 || characterCode === 127
    })
    && !/^-?\d{1,10}$/.test(code)
}

export const useQqLoginStore = defineStore('qq-login', () => {
  const isLoading = ref(false)
  const loginCode = ref('')
  const qrCode = ref('')
  const loginUrl = ref('')
  const status = ref<QQLoginStatus>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')

  let generation = 0
  let checkInFlight = false

  function clearState() {
    isLoading.value = false
    loginCode.value = ''
    qrCode.value = ''
    loginUrl.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
    checkInFlight = false
  }

  function resetState() {
    generation += 1
    clearState()
  }

  async function getQRCode(): Promise<boolean> {
    const requestGeneration = generation + 1
    generation = requestGeneration
    clearState()
    isLoading.value = true
    status.value = 'loading'
    statusMessage.value = '正在获取 QQ 二维码...'

    try {
      const response = await api.post('/api/qr/create')
      const data = response.data?.data || {}
      const nextLoginCode = String(data.code || '').trim()
      const image = String(data.image || data.qrcode || '').trim()

      if (requestGeneration !== generation)
        return false
      if (!response.data?.ok || !nextLoginCode || !image)
        throw new Error(response.data?.error || 'QQ 登录服务未返回有效二维码')

      loginCode.value = nextLoginCode
      qrCode.value = image.startsWith('data:') ? image : `data:image/png;base64,${image}`
      loginUrl.value = String(data.url || '')
      status.value = 'waiting'
      statusMessage.value = '请使用手机 QQ 扫码'
      return true
    }
    catch (error: any) {
      if (requestGeneration !== generation)
        return false
      status.value = 'error'
      statusMessage.value = '二维码获取失败'
      errorMessage.value = error.response?.data?.error || error.message || 'QQ 扫码服务暂时不可用'
      return false
    }
    finally {
      if (requestGeneration === generation)
        isLoading.value = false
    }
  }

  async function checkLogin(): Promise<QQLoginResult> {
    if (!loginCode.value || checkInFlight || !['waiting', 'checking'].includes(status.value))
      return { success: false }

    const currentLoginCode = loginCode.value
    const requestGeneration = generation
    checkInFlight = true
    status.value = 'checking'
    statusMessage.value = '正在确认扫码状态...'

    try {
      const response = await api.post('/api/qr/check', { code: currentLoginCode })
      if (requestGeneration !== generation || currentLoginCode !== loginCode.value)
        return { success: false }

      const data = response.data?.data || {}
      const nextStatus = String(data.status || '')

      if (nextStatus === 'Wait') {
        status.value = 'waiting'
        statusMessage.value = '等待扫码'
        return { success: false }
      }
      if (nextStatus === 'Used') {
        status.value = 'expired'
        statusMessage.value = '二维码已失效，请刷新'
        return { success: false }
      }
      if (nextStatus === 'Error') {
        status.value = 'error'
        statusMessage.value = 'QQ 登录失败'
        errorMessage.value = String(data.error || 'QQ 登录状态检查失败')
        return { success: false }
      }
      if (nextStatus !== 'OK')
        throw new Error('QQ 登录服务返回了未知状态')

      const code = String(data.code || '').trim()
      if (!isValidFarmCode(code))
        throw new Error('扫码成功，但未能换取有效的农场登录 Code')

      status.value = 'success'
      statusMessage.value = data.nickname ? `扫码成功：${data.nickname}` : '扫码成功，正在添加账号...'
      return {
        success: true,
        code,
        uin: String(data.uin || ''),
        nickname: String(data.nickname || ''),
        avatar: String(data.avatar || ''),
      }
    }
    catch (error: any) {
      if (requestGeneration !== generation || currentLoginCode !== loginCode.value)
        return { success: false }
      status.value = 'error'
      statusMessage.value = 'QQ 登录失败'
      errorMessage.value = error.response?.data?.error || error.message || 'QQ 登录状态检查失败'
      return { success: false }
    }
    finally {
      if (requestGeneration === generation)
        checkInFlight = false
    }
  }

  return {
    isLoading,
    loginCode,
    qrCode,
    loginUrl,
    status,
    statusMessage,
    errorMessage,
    resetState,
    getQRCode,
    checkLogin,
  }
})
