<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="ds-page-header">
    <div class="min-w-0">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <slot name="badges" />
      </div>
      <h1 class="ds-page-title">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="ds-page-subtitle">
        {{ subtitle }}
      </p>
      <div v-if="$slots.meta" class="mt-3 flex flex-wrap items-center gap-2">
        <slot name="meta" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
