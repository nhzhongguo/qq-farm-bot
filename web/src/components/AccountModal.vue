<script setup lang="ts">
import { reactive, ref, toRef, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])
const { setContainer } = useFocusTrap(toRef(props, 'show'))

const loading = ref(false)
const errorMessage = ref('')

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

// 添加账号
async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

// 手动提交
async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入Code'
    return
  }

  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
    }
  }

  await addAccount(payload)
}

function close() {
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
    }
    else {
      form.name = ''
      form.code = ''
      form.platform = 'qq'
    }
  }
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" :ref="setContainer" role="dialog" aria-modal="true" :aria-label="editData ? '编辑账号' : '添加账号'" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @keydown.esc="close">
      <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
        <!-- Header -->
        <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
            {{ editData ? '编辑账号' : '添加账号' }}
          </h3>
          <BaseButton variant="ghost" class="!p-1" aria-label="关闭" @click="close">
            <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
          </BaseButton>
        </div>

        <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
          <!-- 错误信息 -->
          <div v-if="errorMessage" class="mb-4 rounded p-3 text-sm" :style="{ background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', color: 'var(--color-danger)' }">
            {{ errorMessage }}
          </div>

          <!-- 手动填码 -->
          <div class="space-y-4">
            <BaseInput
              v-model="form.name"
              label="账号备注（可选）"
              placeholder="留空默认账号"
            />

            <BaseTextarea
              v-model="form.code"
              label="Code"
              placeholder="请输入登录 Code"
              :rows="3"
            />

            <div v-if="!editData" class="flex gap-4">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="form.platform"
                  type="radio"
                  value="qq"
                  class="h-4 w-4"
                  :style="{ accentColor: 'var(--theme-primary)' }"
                >
                <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ小程序</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="form.platform"
                  type="radio"
                  value="wx"
                  class="h-4 w-4"
                  :style="{ accentColor: 'var(--theme-primary)' }"
                >
                <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
              </label>
            </div>

            <div class="flex justify-end gap-2 pt-4">
              <BaseButton variant="outline" @click="close">
                取消
              </BaseButton>
              <BaseButton variant="primary" :loading="loading" @click="submitManual">
                {{ editData ? '保存' : '添加' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
