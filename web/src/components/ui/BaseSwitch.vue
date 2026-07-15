<script setup lang="ts">
defineProps<{
  label?: string
  disabled?: boolean
}>()
const model = defineModel<boolean>()
</script>

<template>
  <label class="inline-flex select-none items-center gap-2" :class="disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'">
    <span class="relative h-6 w-11 inline-flex items-center">
      <input
        v-model="model"
        type="checkbox"
        class="peer sr-only"
        :disabled="disabled"
      >
      <span class="absolute inset-0 border border-[var(--color-border-default)] rounded-full bg-[var(--color-bg-subtle)] transition-all duration-200 peer-checked:border-[var(--theme-primary)] peer-checked:bg-[var(--theme-primary)] peer-focus-visible:shadow-[var(--shadow-glow)]" />
      <span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
    </span>
    <span v-if="label" class="text-sm text-[var(--color-text-secondary)]">{{ label }}</span>
  </label>
</template>
