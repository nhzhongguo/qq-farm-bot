<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Sidebar from '@/components/Sidebar.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { sidebarOpen } = storeToRefs(appStore)
</script>

<template>
  <div class="ds-app-bg w-screen flex overflow-hidden" style="height: 100dvh;">
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-[calc(var(--z-sidebar)-1)] bg-[var(--color-bg-overlay)] backdrop-blur-sm transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <header class="h-[var(--header-height)] flex shrink-0 items-center justify-between border-b border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-surface)_82%,transparent)] px-4 backdrop-blur-xl lg:hidden">
        <div class="flex items-center gap-2">
          <div class="i-carbon-sprout text-xl text-[var(--theme-primary)]" />
          <div class="text-base font-bold tracking-tight">
            QQ农场智能助手
          </div>
        </div>
        <button
          class="grid h-10 w-10 place-items-center border border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] shadow-sm transition hover:text-[var(--theme-primary)]"
          aria-label="打开菜单"
          @click="appStore.toggleSidebar"
        >
          <div class="i-carbon-menu text-xl" />
        </button>
      </header>

      <div class="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-3 md:p-6 sm:p-5">
        <RouterView v-slot="{ Component, route }">
          <Transition name="slide-fade" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </div>
    </main>
  </div>
</template>
