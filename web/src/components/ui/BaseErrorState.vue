<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'

withDefaults(defineProps<{
  title?: string
  message?: string
  retryText?: string
}>(), {
  title: '加载失败',
  message: '',
  retryText: '重试',
})

const emit = defineEmits<{
  (e: 'retry'): void
}>()
</script>

<template>
  <div class="ds-empty">
    <div class="ds-empty-icon ds-error-icon">
      <div class="i-carbon-warning-alt" />
    </div>
    <div class="text-base text-[var(--color-text-primary)] font-semibold">
      {{ title }}
    </div>
    <p v-if="message" class="max-w-md text-sm text-[var(--color-text-secondary)]">
      {{ message }}
    </p>
    <div class="mt-1">
      <BaseButton variant="secondary" size="sm" @click="emit('retry')">
        <div class="i-carbon-restart" />
        {{ retryText }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.ds-error-icon {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
</style>
