<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
  options?: Array<{ label: string, value: string | number, disabled?: boolean }>
}>()

const model = defineModel<string | number>()
const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(() => {
  const found = props.options?.find(opt => opt.value === model.value)
  return found?.label || props.placeholder || '请选择'
})

function toggleDropdown() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
}

function selectOption(value: string | number) {
  model.value = value
  isOpen.value = false
}

function closeDropdown(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node))
    isOpen.value = false
}

onMounted(() => document.addEventListener('click', closeDropdown))
onUnmounted(() => document.removeEventListener('click', closeDropdown))
</script>

<template>
  <div ref="containerRef" class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm font-medium text-[var(--color-text-secondary)]">
      {{ label }}
    </label>
    <div class="relative">
      <button
        type="button"
        class="ds-input-base flex items-center justify-between text-left"
        :class="{ 'opacity-60 cursor-not-allowed': disabled, 'border-[var(--theme-primary)] shadow-[var(--shadow-glow)]': isOpen }"
        :disabled="disabled"
        @click="toggleDropdown"
      >
        <span class="truncate" :class="{ 'text-[var(--color-text-tertiary)]': !options?.some(o => o.value === model) }">
          {{ selectedLabel }}
        </span>
        <div class="i-carbon-chevron-down text-lg text-[var(--color-text-tertiary)] transition-transform duration-200" :class="{ 'rotate-180': isOpen }" />
      </button>

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="transform scale-95 opacity-0"
        enter-to-class="transform scale-100 opacity-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="transform scale-100 opacity-100"
        leave-to-class="transform scale-95 opacity-0"
      >
        <div
          v-if="isOpen"
          class="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] py-1 shadow-[var(--shadow-md)]"
        >
          <template v-if="options?.length">
            <button
              v-for="opt in options"
              :key="opt.value"
              type="button"
              class="w-full px-3 py-2 text-left text-sm transition-colors"
              :class="{
                'bg-[rgba(var(--theme-primary-rgb),0.12)] text-[var(--theme-primary)]': model === opt.value,
                'text-[var(--color-text-tertiary)] cursor-not-allowed': opt.disabled,
                'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]': model !== opt.value && !opt.disabled,
              }"
              :disabled="opt.disabled"
              @click="!opt.disabled && selectOption(opt.value)"
            >
              <slot name="option" :option="opt" :selected="model === opt.value">
                {{ opt.label }}
              </slot>
            </button>
          </template>
          <div v-else class="px-3 py-2 text-center text-sm text-[var(--color-text-tertiary)]">
            暂无选项
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
