<script setup lang="ts">
import { useDateFormat, useNow } from '@vueuse/core'
import { computed } from 'vue'

const props = defineProps<{
  mode?: 'time' | 'uptime'
  baseSeconds?: number
  lastPingAt?: number
}>()

const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

const uptimeText = computed(() => {
  const base = Number(props.baseSeconds || 0)
  const last = Number(props.lastPingAt || Date.now())
  const diff = Math.max(0, Math.floor(base + (now.value.getTime() - last) / 1000))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})
</script>

<template>
  <span>{{ mode === 'uptime' ? uptimeText : formattedTime }}</span>
</template>
