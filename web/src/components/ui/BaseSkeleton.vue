<script setup lang="ts">
withDefaults(defineProps<{
  /** 骨架行数 */
  rows?: number
  /** 每行高度 */
  rowHeight?: string
  /** 行间距 */
  gap?: string
  /** 卡片变体：整块卡片骨架 */
  card?: boolean
  /** 行宽度（card 时无效） */
  width?: string
}>(), {
  rows: 3,
  rowHeight: '14px',
  gap: '0.75rem',
  card: false,
  width: '100%',
})
</script>

<template>
  <div
    class="ds-skeleton"
    :class="{ 'ds-skeleton-card': card }"
    :style="card ? { gap } : {}"
    role="status"
    aria-label="加载中"
  >
    <template v-if="card">
      <div
        v-for="i in rows"
        :key="i"
        class="ds-skeleton-block"
        :style="{ height: rowHeight, width: '100%' }"
      />
    </template>
    <div
      v-for="i in rows"
      v-else
      :key="i"
      class="ds-skeleton-block"
      :style="{ height: rowHeight, width }"
    />
    <span class="sr-only">加载中...</span>
  </div>
</template>

<style scoped>
.ds-skeleton {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.ds-skeleton-block {
  border-radius: 0.5rem;
  background: var(--color-bg-subtle);
  position: relative;
  overflow: hidden;
}

.ds-skeleton-block::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-border-default) 55%, transparent),
    transparent
  );
  animation: ds-skeleton-shimmer 1.4s ease-in-out infinite;
}

.ds-skeleton-card {
  border: 1px solid var(--color-border-default);
  border-radius: 1rem;
  padding: 1.25rem;
  background: var(--color-bg-subtle);
}

@keyframes ds-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}
</style>
