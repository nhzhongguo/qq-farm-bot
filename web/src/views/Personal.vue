<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

const currentTab = ref<'farm' | 'bag' | 'task'>('farm')
const tabs = [
  { key: 'farm', label: '我的农场', icon: 'i-carbon-sprout' },
  { key: 'bag', label: '我的背包', icon: 'i-carbon-inventory-management' },
  { key: 'task', label: '我的任务', icon: 'i-carbon-task' },
] as const
</script>

<template>
  <div class="ds-page">
    <PageHeader title="个人空间" subtitle="农场、背包与任务集中处理">
      <template #badges>
        <span class="ds-chip ds-chip-brand">账号工作台</span>
      </template>
    </PageHeader>

    <div class="flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="min-w-[7.5rem] flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition"
        :class="currentTab === tab.key
          ? 'bg-[var(--color-bg-surface)] text-[var(--theme-primary)] shadow-sm'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'"
        @click="currentTab = tab.key"
      >
        <div class="flex items-center justify-center gap-2">
          <div :class="tab.icon" />
          <span>{{ tab.label }}</span>
        </div>
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform opacity-0 translate-y-1"
        enter-to-class="transform opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform opacity-100"
        leave-to-class="transform opacity-0"
      >
        <component :is="currentTab === 'farm' ? FarmPanel : (currentTab === 'bag' ? BagPanel : TaskPanel)" />
      </Transition>
    </div>
  </div>
</template>