<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const userStore = useUserStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const showPasswordStrength = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({
  success: true,
  title: '',
  message: '',
  cardCode: '',
  days: 0,
})

const passwordStrength = computed(() => {
  const pwd = password.value
  if (!pwd)
    return { score: 0, level: '', valid: false, color: 'var(--color-text-tertiary)' }

  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++

  let typeCount = 0
  if (/[a-z]/.test(pwd)) typeCount++
  if (/[A-Z]/.test(pwd)) typeCount++
  if (/\d/.test(pwd)) typeCount++
  if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(pwd)) typeCount++

  if (typeCount >= 2) score += 2
  if (typeCount >= 3) score++
  if (typeCount >= 4) score++

  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p)))
    score = Math.max(0, score - 2)

  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? 'var(--color-danger)' : score <= 4 ? 'var(--color-warning)' : score <= 6 ? 'var(--color-success)' : 'var(--theme-primary)'
  const valid = pwd.length >= 6 && typeCount >= 2
  return { score, level, color, valid }
})

const usernameValid = computed(() => {
  const name = username.value
  if (!name) return { valid: false, message: '' }
  if (name.length < 3) return { valid: false, message: '用户名至少3位' }
  if (name.length > 32) return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name)) return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

watch(password, () => {
  if (!isLogin.value && password.value)
    showPasswordStrength.value = true
})

function validateForm(): boolean {
  if (!username.value) { error.value = '请输入用户名'; return false }
  if (!usernameValid.value.valid) { error.value = usernameValid.value.message; return false }
  if (!password.value) { error.value = '请输入密码'; return false }
  if (!isLogin.value) {
    if (password.value.length < 6) { error.value = '密码长度至少6位'; return false }
    if (!passwordStrength.value.valid) {
      error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
      return false
    }
    if (!cardCode.value) { error.value = '请输入卡密'; return false }
  }
  return true
}

async function handleSubmit() {
  if (!validateForm()) return
  loading.value = true
  error.value = ''
  success.value = ''
  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (result.data?.mustChangePassword) {
          success.value = '登录成功！请修改默认密码以确保账户安全'
          localStorage.setItem('settings-active-tab', 'user')
        }
        setTimeout(() => {
          window.location.href = result.data?.mustChangePassword ? '/settings' : '/'
        }, 500)
      }
      else if (result.errorType === 'rate_limit') {
        error.value = result.error || '请求过于频繁，请稍后重试'
        if (result.remainingMs) rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
      }
      else if (result.errorType === 'locked') {
        error.value = result.error || '账户已被锁定'
        if (result.remainingMs) lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
      }
      else {
        error.value = result.error || '登录失败'
      }
    }
    else {
      const result = await userStore.register(username.value, password.value, cardCode.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        isLogin.value = true
        cardCode.value = ''
        password.value = ''
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = data.error || '请求过于频繁'
      if (data.remainingMs) rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
    }
    else if (data?.errorType === 'locked') {
      error.value = data.error || '账户已被锁定'
      if (data.remainingMs) lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
    }
    else {
      error.value = data?.error || e.message || '操作异常'
    }
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
  showPasswordStrength.value = false
  lockoutRemaining.value = 0
  rateLimitRemaining.value = 0
}

async function checkCardClaimStatus() {
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok)
      cardClaimEnabled.value = res.data.enabled === true
  }
  catch (e) {
    console.error('检查卡密领取状态失败:', e)
  }
}

async function claimFreeCard() {
  if (cardClaimLoading.value) return
  cardClaimLoading.value = true
  error.value = ''
  try {
    const res = await api.post('/api/card-claim/claim')
    if (res.data.ok) {
      cardCode.value = res.data.cardCode
      claimModalContent.value = {
        success: true,
        title: '领取成功',
        message: `成功领取 ${res.data.days} 天卡密！`,
        cardCode: res.data.cardCode,
        days: res.data.days,
      }
    }
    else {
      claimModalContent.value = {
        success: false,
        title: '领取失败',
        message: res.data.error || '领取失败，请稍后重试',
        cardCode: '',
        days: 0,
      }
    }
    showClaimModal.value = true
  }
  catch (e: any) {
    const data = e.response?.data
    claimModalContent.value = {
      success: false,
      title: '领取失败',
      message: data?.error || e.message || '领取失败',
      cardCode: '',
      days: 0,
    }
    showClaimModal.value = true
  }
  finally {
    cardClaimLoading.value = false
  }
}

function closeClaimModal() {
  showClaimModal.value = false
}

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok)
      gameVersion.value = res.data.clientVersion
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

onMounted(() => {
  checkCardClaimStatus()
  fetchGameVersion()
})
</script>
<template>
  <div class="login-shell ds-app-bg relative min-h-screen w-screen overflow-auto">
    <div class="pointer-events-none absolute inset-0">
      <div class="orb orb-a" />
      <div class="orb orb-b" />
      <div class="grid-mask" />
    </div>

    <div class="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
      <section class="hidden lg:block">
        <div class="ds-chip ds-chip-brand mb-5">
          <div class="i-carbon-sprout" />
          QQ农场智能助手
        </div>
        <h1 class="max-w-xl text-4xl font-bold tracking-tight text-[var(--color-text-primary)] xl:text-5xl">
          多账号自动化运营台
          <span class="block bg-clip-text text-transparent" style="background-image: var(--theme-gradient)">更稳、更清晰、更高级</span>
        </h1>
        <p class="mt-4 max-w-lg text-base leading-relaxed text-[var(--color-text-secondary)]">
          统一管理农场账号、实时状态、策略自动化与后台发卡。登录后即可进入商业级控制面板。
        </p>
        <div class="mt-8 grid max-w-lg grid-cols-3 gap-3">
          <div class="ds-card p-4">
            <div class="text-xs text-[var(--color-text-tertiary)]">实时状态</div>
            <div class="mt-1 text-lg font-semibold">Socket 同步</div>
          </div>
          <div class="ds-card p-4">
            <div class="text-xs text-[var(--color-text-tertiary)]">安全边界</div>
            <div class="mt-1 text-lg font-semibold">限流鉴权</div>
          </div>
          <div class="ds-card p-4">
            <div class="text-xs text-[var(--color-text-tertiary)]">运营效率</div>
            <div class="mt-1 text-lg font-semibold">多账号</div>
          </div>
        </div>
      </section>

      <section class="mx-auto w-full max-w-md">
        <form class="ds-surface p-6 sm:p-8" @submit.prevent="handleSubmit">
          <div class="mb-6 flex items-center justify-between gap-3">
            <div>
              <div class="text-sm text-[var(--color-text-tertiary)]">欢迎回来</div>
              <h2 class="mt-1 text-2xl font-bold tracking-tight">
                {{ isLogin ? '登录控制台' : '注册新账户' }}
              </h2>
            </div>
            <div class="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-md" style="background-image: var(--theme-gradient)">
              <div class="i-carbon-sprout text-2xl" />
            </div>
          </div>

          <div class="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-bg-subtle)] p-1">
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-sm font-semibold transition"
              :class="isLogin ? 'bg-[var(--color-bg-surface)] text-[var(--theme-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'"
              @click="isLogin || toggleMode()"
            >
              登录
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-sm font-semibold transition"
              :class="!isLogin ? 'bg-[var(--color-bg-surface)] text-[var(--theme-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'"
              @click="!isLogin || toggleMode()"
            >
              注册
            </button>
          </div>

          <div class="space-y-4">
            <BaseInput v-model="username" label="用户名" placeholder="请输入用户名" />
            <BaseInput v-model="password" type="password" label="密码" placeholder="请输入密码" />

            <div v-if="!isLogin && showPasswordStrength" class="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] p-3">
              <div class="mb-2 flex items-center justify-between text-xs">
                <span class="text-[var(--color-text-secondary)]">密码强度</span>
                <span class="font-semibold" :style="{ color: passwordStrength.color }">{{ passwordStrength.level || '—' }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-surface)]">
                <div class="h-full rounded-full transition-all" :style="{ width: `${Math.min(100, (passwordStrength.score || 0) * 14)}%`, background: passwordStrength.color }" />
              </div>
            </div>

            <div v-if="!isLogin" class="space-y-2">
              <BaseInput v-model="cardCode" label="卡密" placeholder="请输入卡密" />
              <BaseButton
                v-if="cardClaimEnabled"
                type="button"
                variant="outline"
                block
                :loading="cardClaimLoading"
                @click="claimFreeCard"
              >
                免费领取体验卡密
              </BaseButton>
            </div>
          </div>

          <div
            v-if="error"
            class="mt-4 rounded-xl border px-3 py-2 text-sm"
            style="border-color: color-mix(in srgb, var(--color-danger) 30%, transparent); background: var(--color-danger-soft); color: var(--color-danger)"
          >
            {{ error }}
            <span v-if="rateLimitRemaining">（约 {{ rateLimitRemaining }} 秒后重试）</span>
            <span v-if="lockoutRemaining">（约 {{ lockoutRemaining }} 分钟后解锁）</span>
          </div>
          <div
            v-if="success"
            class="mt-4 rounded-xl border px-3 py-2 text-sm"
            style="border-color: color-mix(in srgb, var(--color-success) 30%, transparent); background: var(--color-success-soft); color: var(--color-success)"
          >
            {{ success }}
          </div>

          <BaseButton class="mt-6" type="submit" block size="lg" :loading="loading">
            {{ isLogin ? '进入控制台' : '创建账户' }}
          </BaseButton>

          <div class="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span>App {{ appVersion }}</span>
            <span v-if="gameVersion">Game {{ gameVersion }}</span>
          </div>
        </form>
      </section>
    </div>

    <div v-if="showClaimModal" class="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-bg-overlay)] p-4 backdrop-blur-sm" @click="closeClaimModal">
      <div class="ds-surface-solid w-full max-w-sm p-6" @click.stop>
        <div class="mb-3 text-lg font-bold" :class="claimModalContent.success ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
          {{ claimModalContent.title }}
        </div>
        <p class="text-sm text-[var(--color-text-secondary)]">
          {{ claimModalContent.message }}
        </p>
        <div v-if="claimModalContent.cardCode" class="mt-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-3 py-2 font-mono text-sm">
          {{ claimModalContent.cardCode }}
        </div>
        <BaseButton class="mt-5" block @click="closeClaimModal">
          知道了
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-shell {
  background:
    radial-gradient(1000px 520px at 10% -10%, rgba(var(--theme-primary-rgb), 0.18), transparent 55%),
    radial-gradient(800px 480px at 90% 10%, rgba(var(--theme-primary-rgb), 0.12), transparent 50%),
    var(--color-bg-app);
}
.orb {
  position: absolute;
  border-radius: 9999px;
  filter: blur(40px);
  opacity: 0.55;
}
.orb-a {
  width: 280px;
  height: 280px;
  left: -40px;
  top: 12%;
  background: rgba(var(--theme-primary-rgb), 0.35);
}
.orb-b {
  width: 340px;
  height: 340px;
  right: -60px;
  bottom: 8%;
  background: color-mix(in srgb, var(--theme-secondary) 40%, transparent);
}
.grid-mask {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(circle at center, black, transparent 78%);
  opacity: 0.45;
}
@media (prefers-reduced-motion: reduce) {
  .orb { filter: none; opacity: 0.25; }
}
</style>