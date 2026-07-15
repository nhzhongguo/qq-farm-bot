<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  href?: string
  type?: 'button' | 'submit' | 'reset'
}>()

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const componentTag = computed(() => {
  if (props.to)
    return RouterLink
  if (props.href)
    return 'a'
  return 'button'
})

const baseClasses = 'ds-btn-base focus-visible:shadow-[var(--shadow-glow)] active:scale-[0.98]'

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'secondary':
      return 'bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] hover:bg-[color-mix(in_srgb,var(--theme-primary)_8%,var(--color-bg-subtle))]'
    case 'success':
      return 'bg-[var(--color-success)] text-white shadow-sm hover:brightness-110'
    case 'danger':
      return 'bg-[var(--color-danger)] text-white shadow-sm hover:brightness-110'
    case 'ghost':
      return 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]'
    case 'outline':
      return 'border border-[var(--color-border-default)] bg-transparent text-[var(--color-text-primary)] hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)]'
    case 'text':
      return 'p-0 bg-transparent shadow-none text-[var(--theme-primary)] hover:opacity-80'
    case 'primary':
    default:
      return 'text-white shadow-sm border border-transparent hover:brightness-110 hover:shadow-[var(--shadow-md)]'
  }
})

const sizeClasses = computed(() => {
  if (props.variant === 'text')
    return ''
  switch (props.size) {
    case 'sm':
      return 'px-3 py-1.5 text-sm'
    case 'lg':
      return 'px-6 py-3 text-base'
    default:
      return 'px-4 py-2 text-sm'
  }
})

const widthClasses = computed(() => props.block ? 'w-full' : '')

const buttonStyle = computed(() => {
  if (!props.variant || props.variant === 'primary') {
    return {
      backgroundImage: 'var(--theme-gradient)',
      backgroundColor: 'var(--theme-primary)',
    }
  }
  if (props.variant === 'text') {
    return { color: 'var(--theme-primary)' }
  }
  return {}
})
</script>

<template>
  <component
    :is="componentTag"
    :to="to"
    :href="href"
    :type="!to && !href ? (type || 'button') : undefined"
    :disabled="disabled || loading"
    :class="[baseClasses, variantClasses, sizeClasses, widthClasses]"
    :style="buttonStyle"
    v-bind="$attrs"
    @click="!disabled && !loading && emit('click', $event)"
  >
    <div v-if="loading" class="i-svg-spinners-ring-resize animate-spin" />
    <slot />
  </component>
</template>
