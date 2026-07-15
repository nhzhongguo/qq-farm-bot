<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
}>()
</script>

<template>
  <div class="ds-empty">
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
  </div>
</template>
