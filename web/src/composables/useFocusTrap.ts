import type { ComponentPublicInstance, Ref } from 'vue'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ')

export interface UseFocusTrapOptions {
  /** 关闭后是否把焦点还原到打开前的元素，默认 true */
  restoreFocus?: boolean
}

/**
 * 通用弹窗焦点陷阱：
 * - 打开时聚焦容器内第一个可聚焦元素
 * - Tab / Shift+Tab 在容器内循环
 * - 关闭后把焦点还原给触发元素
 * - 组件卸载时清理监听并还原焦点
 */
export function useFocusTrap(active: Ref<boolean>, options: UseFocusTrapOptions = {}) {
  const containerRef = ref<HTMLElement | null>(null)

  function setContainer(el: Element | ComponentPublicInstance | null) {
    containerRef.value = el instanceof Element ? (el as HTMLElement) : null
  }
  const shouldRestoreFocus = options.restoreFocus !== false
  let previouslyFocused: HTMLElement | null = null
  let trapped = false

  function getFocusableElements(): HTMLElement[] {
    const root = containerRef.value
    if (!root)
      return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(el => el.getAttribute('aria-hidden') !== 'true')
  }

  function focusFirstElement() {
    const focusable = getFocusableElements()
    const target = focusable[0] ?? containerRef.value
    target?.focus()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab')
      return
    const focusable = getFocusableElements()
    if (focusable.length === 0)
      return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last)
      return
    const current = document.activeElement
    if (event.shiftKey && (current === first || current === containerRef.value)) {
      event.preventDefault()
      last.focus()
    }
    else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function restorePreviousFocus() {
    if (previouslyFocused && previouslyFocused.isConnected) {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }

  function activate() {
    if (trapped)
      return
    trapped = true
    if (document.activeElement instanceof HTMLElement)
      previouslyFocused = document.activeElement
    window.addEventListener('keydown', onKeydown)
    void nextTick(focusFirstElement)
  }

  function deactivate() {
    if (!trapped)
      return
    trapped = false
    window.removeEventListener('keydown', onKeydown)
    if (shouldRestoreFocus)
      restorePreviousFocus()
  }

  watch(active, (value) => {
    if (value)
      activate()
    else
      deactivate()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    if (shouldRestoreFocus)
      restorePreviousFocus()
  })

  return { containerRef, setContainer, activate, deactivate }
}
