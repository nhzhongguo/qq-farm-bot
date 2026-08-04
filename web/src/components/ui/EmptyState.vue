<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'

withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
  /** 加载态：显示旋转指示器 */
  loading?: boolean
  /** 错误态：传字符串作为错误信息，true 使用默认信息 */
  error?: boolean | string
  retryText?: string
}>(), {
  loading: false,
  error: false,
  retryText: '重试',
})

const emit = defineEmits<{
  (e: 'retry'): void
}>()
</script>

<template>
  <div class="ds-empty">
    <!-- 加载态 -->
    <template v-if="loading">
      <div class="ds-empty-icon">
        <div class="i-svg-spinners-90-ring-with-bg text-2xl text-[var(--theme-primary)]" />
      </div>
      <div class="text-base text-[var(--color-text-secondary)] font-medium">
        {{ title }}
      </div>
    </template>

    <!-- 错误态 -->
    <template v-else-if="error">
      <div class="ds-empty-icon ds-error-icon">
        <div class="i-carbon-warning-alt" />
      </div>
      <div class="text-base text-[var(--color-text-primary)] font-semibold">
        {{ title }}
      </div>
      <p v-if="typeof error === 'string' && error" class="max-w-md text-sm text-[var(--color-text-secondary)]">
        {{ error }}
      </p>
      <p v-else-if="description" class="max-w-md text-sm text-[var(--color-text-secondary)]">
        {{ description }}
      </p>
      <div class="mt-1">
        <BaseButton variant="secondary" size="sm" @click="emit('retry')">
          <div class="i-carbon-restart" />
          {{ retryText }}
        </BaseButton>
      </div>
    </template>

    <!-- 空态 -->
    <template v-else>
      <div class="ds-empty-icon">
        <div :class="icon || 'i-carbon-cube'" />
      </div>
      <div class="text-base text-[var(--color-text-primary)] font-semibold">
        {{ title }}
      </div>
      <p v-if="description" class="max-w-md text-sm text-[var(--color-text-secondary)]">
        {{ description }}
      </p>
      <div v-if="$slots.actions" class="mt-1 flex flex-wrap items-center justify-center gap-2">
        <slot name="actions" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ds-error-icon {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
</style>
