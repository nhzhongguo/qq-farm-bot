<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps<{
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'primary' | 'success'
  loading?: boolean
  isAlert?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'close'): void
}>()

function onCancel() {
  emit('cancel')
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.loading)
    onCancel()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-bg-overlay)] p-4 backdrop-blur-sm" @click="!loading && onCancel()">
    <div class="ds-surface-solid max-w-md w-full p-6 shadow-[var(--shadow-lg)]" @click.stop>
      <div class="mb-4 flex items-start gap-3">
        <div
          class="grid h-10 w-10 place-items-center rounded-xl"
          :class="{
            'bg-[var(--color-danger-soft)] text-[var(--color-danger)]': type === 'danger',
            'bg-[var(--color-success-soft)] text-[var(--color-success)]': type === 'success',
            'bg-[rgba(var(--theme-primary-rgb),0.12)] text-[var(--theme-primary)]': type !== 'danger' && type !== 'success',
          }"
        >
          <div :class="type === 'danger' ? 'i-carbon-warning' : (type === 'success' ? 'i-carbon-checkmark' : 'i-carbon-information')" />
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="text-lg text-[var(--color-text-primary)] font-bold">
            {{ title || '确认操作' }}
          </h3>
          <p class="mt-2 whitespace-pre-line text-sm text-[var(--color-text-secondary)] leading-relaxed">
            {{ message || '确定要执行此操作吗？' }}
          </p>
        </div>
      </div>
      <div class="flex justify-end gap-3">
        <BaseButton
          v-if="!isAlert"
          variant="secondary"
          :disabled="loading"
          @click="onCancel"
        >
          {{ cancelText || '取消' }}
        </BaseButton>
        <BaseButton
          :variant="type === 'danger' ? 'danger' : (type === 'success' ? 'success' : 'primary')"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmText || '确定' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
