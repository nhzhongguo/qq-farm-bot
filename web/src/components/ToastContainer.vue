<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
const { toasts } = storeToRefs(toastStore)

function iconOf(type: string) {
  if (type === 'success') return 'i-carbon-checkmark-filled'
  if (type === 'error') return 'i-carbon-error-filled'
  if (type === 'warning') return 'i-carbon-warning-filled'
  return 'i-carbon-information-filled'
}
</script>

<template>
  <div class="pointer-events-none fixed right-3 top-3 z-[var(--z-toast)] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 sm:top-4">
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-md)] backdrop-blur-md"
        :class="{
          'bg-[color-mix(in_srgb,var(--color-success-soft)_90%,var(--color-bg-surface))] border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] text-[var(--color-success)]': toast.type === 'success',
          'bg-[color-mix(in_srgb,var(--color-danger-soft)_90%,var(--color-bg-surface))] border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] text-[var(--color-danger)]': toast.type === 'error',
          'bg-[color-mix(in_srgb,var(--color-warning-soft)_90%,var(--color-bg-surface))] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] text-[var(--color-warning)]': toast.type === 'warning',
          'bg-[color-mix(in_srgb,var(--color-info-soft)_90%,var(--color-bg-surface))] border-[color-mix(in_srgb,var(--color-info)_30%,transparent)] text-[var(--color-info)]': toast.type === 'info' || !toast.type,
        }"
      >
        <div :class="iconOf(toast.type)" class="mt-0.5 text-lg" />
        <div class="min-w-0 flex-1 text-sm font-medium leading-relaxed text-[var(--color-text-primary)]">
          {{ toast.message }}
        </div>
        <button class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" aria-label="关闭通知" @click="toastStore.remove(toast.id)">
          <div class="i-carbon-close" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
