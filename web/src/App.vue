<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

onMounted(() => {
  appStore.fetchTheme()
})
</script>

<template>
  <div class="ds-app-bg h-screen w-screen overflow-hidden">
    <RouterView />
    <ToastContainer />
  </div>
</template>
