<script setup lang="ts">
import { computed, ref, useId } from 'vue'

const props = defineProps<{
  type?: string
  placeholder?: string
  label?: string
  disabled?: boolean
  clearable?: boolean
}>()
const emit = defineEmits<{
  (e: 'clear'): void
}>()
const model = defineModel<string | number>()
const showPassword = ref(false)
const inputId = useId()
const inputType = computed(() => {
  if (props.type === 'password' && showPassword.value)
    return 'text'
  return props.type || 'text'
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="inputId" class="text-sm text-[var(--color-text-secondary)] font-medium">
      {{ label }}
    </label>
    <div class="relative">
      <input
        :id="inputId"
        v-model="model"
        :type="inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        class="base-input ds-input-base"
        :class="{ 'pr-10': type === 'password' || (clearable && model) }"
      >
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute right-3 top-1/2 text-[var(--color-text-tertiary)] -translate-y-1/2 hover:text-[var(--color-text-primary)]"
        :aria-label="showPassword ? '隐藏密码' : '显示密码'"
        @click="showPassword = !showPassword"
      >
        <div v-if="showPassword" class="i-carbon-view-off" />
        <div v-else class="i-carbon-view" />
      </button>
      <button
        v-else-if="clearable && model"
        type="button"
        class="absolute right-3 top-1/2 text-[var(--color-text-tertiary)] -translate-y-1/2 hover:text-[var(--color-text-primary)]"
        aria-label="清除"
        @click="model = ''; emit('clear')"
      >
        <div class="i-carbon-close" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.base-input::-ms-reveal,
.base-input::-ms-clear {
  display: none;
}
</style>
