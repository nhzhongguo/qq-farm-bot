<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  placeholder?: string
  label?: string
  disabled?: boolean
  rows?: number
}>()
const model = defineModel<string>()
const inputId = useId()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="inputId" class="text-sm font-medium text-[var(--color-text-secondary)]">
      {{ label }}
    </label>
    <textarea
      :id="inputId"
      v-model="model"
      :placeholder="placeholder"
      :disabled="disabled"
      :rows="rows || 3"
      class="ds-input-base resize-y min-h-20"
    />
  </div>
</template>
