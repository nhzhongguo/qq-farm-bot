<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
  options?: Array<{ label: string, value: string | number, disabled?: boolean }>
}>()

const model = defineModel<string | number>()
const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const optionRefs = ref<(HTMLButtonElement | null)[]>([])
const activeIndex = ref(0)
const listboxId = `listbox-${Math.random().toString(36).slice(2, 9)}`

const enabledOptions = computed(() => props.options?.filter(opt => !opt.disabled) || [])

const selectedLabel = computed(() => {
  const found = props.options?.find(opt => opt.value === model.value)
  return found?.label || props.placeholder || '请选择'
})

function currentIndex() {
  const idx = props.options?.findIndex(opt => opt.value === model.value && !opt.disabled) ?? -1
  return idx >= 0 ? idx : 0
}

function openDropdown() {
  if (props.disabled || isOpen.value)
    return
  isOpen.value = true
  activeIndex.value = currentIndex()
  nextTick(() => {
    const el = optionRefs.value[activeIndex.value]
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
    }
  })
}

function closeDropdown(restoreFocus = true) {
  if (!isOpen.value)
    return
  isOpen.value = false
  if (restoreFocus)
    triggerRef.value?.focus()
}

function toggleDropdown() {
  if (isOpen.value)
    closeDropdown(true)
  else
    openDropdown()
}

function move(step: number) {
  const options = enabledOptions.value
  if (!options.length)
    return
  const max = options.length - 1
  activeIndex.value = Math.min(max, Math.max(0, activeIndex.value + step))
  const el = optionRefs.value[activeIndex.value]
  if (el) {
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }
}

function jumpToEdge(edge: 'first' | 'last') {
  const options = enabledOptions.value
  if (!options.length)
    return
  activeIndex.value = edge === 'first' ? 0 : options.length - 1
  const el = optionRefs.value[activeIndex.value]
  if (el) {
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }
}

function selectOption(value: string | number) {
  if (props.disabled)
    return
  model.value = value
  closeDropdown(true)
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled)
    return
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault()
    if (!isOpen.value)
      openDropdown()
    else if (e.key === 'ArrowDown')
      move(1)
    else if (e.key === 'ArrowUp')
      move(-1)
    else
      jumpToEdge(e.key === 'Home' ? 'first' : 'last')
  }
  else if (e.key === 'Enter' || e.key === ' ') {
    if (!isOpen.value) {
      e.preventDefault()
      openDropdown()
    }
  }
  else if (e.key === 'Escape' && isOpen.value) {
    closeDropdown(true)
  }
}

function onListboxKeydown(e: KeyboardEvent) {
  if (props.disabled)
    return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  }
  else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    jumpToEdge(e.key === 'Home' ? 'first' : 'last')
  }
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const option = props.options?.[activeIndex.value]
    if (option && !option.disabled)
      selectOption(option.value)
  }
  else if (e.key === 'Escape' || e.key === 'Tab') {
    closeDropdown(true)
  }
}

function closeDropdownOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node))
    closeDropdown(false)
}

function setOptionRef(index: number, el: HTMLButtonElement | null) {
  optionRefs.value[index] = el
}

onMounted(() => document.addEventListener('click', closeDropdownOutside))
onUnmounted(() => {
  document.removeEventListener('click', closeDropdownOutside)
  optionRefs.value = []
})
</script>

<template>
  <div ref="containerRef" class="flex flex-col gap-1.5">
    <label v-if="label" :id="`${listboxId}-label`" class="text-sm text-[var(--color-text-secondary)] font-medium">
      {{ label }}
    </label>
    <div class="relative">
      <button
        ref="triggerRef"
        type="button"
        class="ds-input-base flex items-center justify-between text-left"
        :class="{ 'opacity-60 cursor-not-allowed': disabled, 'border-[var(--theme-primary)] shadow-[var(--shadow-glow)]': isOpen }"
        :disabled="disabled"
        aria-haspopup="listbox"
        :aria-expanded="isOpen"
        :aria-controls="isOpen ? listboxId : undefined"
        :aria-labelledby="label ? `${listboxId}-label` : undefined"
        aria-label="选择选项"
        @click="toggleDropdown"
        @keydown="onTriggerKeydown"
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
          :id="listboxId"
          role="listbox"
          class="ds-listbox-panel"
          tabindex="-1"
          :aria-labelledby="label ? `${listboxId}-label` : undefined"
          @keydown="onListboxKeydown"
        >
          <template v-if="options?.length">
            <button
              v-for="(opt, index) in options"
              :id="`${listboxId}-option-${index}`"
              :key="opt.value"
              :ref="(el: any) => setOptionRef(index, el as HTMLButtonElement | null)"
              type="button"
              role="option"
              class="ds-option"
              :class="{
                'text-[var(--color-text-tertiary)] cursor-not-allowed': opt.disabled,
              }"
              :aria-selected="model === opt.value"
              :data-active="activeIndex === index"
              :disabled="opt.disabled"
              @click="!opt.disabled && selectOption(opt.value)"
              @mouseenter="!opt.disabled && (activeIndex = index)"
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
