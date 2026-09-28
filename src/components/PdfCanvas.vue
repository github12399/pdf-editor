<script setup lang="ts">
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocStore } from '../stores/docStore'
import { getBaseViewport, renderPage as renderPageOp, type PageViewport } from '../services/pdf'
import TextEditLayer from './TextEditLayer.vue'
import PatchPreviewLayer from './PatchPreviewLayer.vue'

const store = useDocStore()

const fileInput = ref<HTMLInputElement | null>(null)
const scrollEl = ref<HTMLDivElement | null>(null)
const pageEls = ref<(HTMLDivElement | null)[]>([])
const baseViewports = ref<(PageViewport | null)[]>([])
/** 每页已渲染的 scale，0 = 未渲染 */
const renderedAs = ref<number[]>([])
const containerWidth = ref(0)

function setPageEl(i: number) {
  return (el: unknown) => {
    const wrap = el as HTMLDivElement | null
    if (wrap) pageEls.value[i - 1] = wrap
    else pageEls.value[i - 1] = null
  }
}

/** 当前页实际渲染缩放 = 适应宽度 or 手动缩放 */
function effectiveScale(baseWidth: number): number {
  if (store.fitWidth && containerWidth.value > 0 && baseWidth > 0) {
    // 视觉上留出页面左右阴影/边距
    return Math.max(0.1, (containerWidth.value - 48) / baseWidth)
  }
  return store.scale
}

/* ---------- 懒渲染调度 ---------- */

const pending = new Set<number>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function schedule(p: number) {
  if (!store.doc) return
  pending.add(p)
  scheduleFlush()
}
function scheduleAll() {
  for (let i = 1; i <= store.numPages; i++) pending.add(i)
  scheduleFlush()
}
function scheduleFlush() {
  if (flushTimer != null) return
  flushTimer = setTimeout(async () => {
    flushTimer = undefined
    while (pending.size) {
      const p = pending.values().next().value as number
      pending.delete(p)
      await renderPage(p)
    }
  }, 16)
}

async function renderPage(p: number) {
  const proxy = store.doc
  const wrap = pageEls.value[p - 1]
  if (!proxy || !wrap) return
  const canvas = wrap.querySelector('canvas')
  if (!canvas) return

  let base = baseViewports.value[p - 1]
  if (!base) {
    const page = await proxy.getPage(p)
    if (!store.doc) return // 渲染期间文档被替换
    // 页宽在文档内可能不同，缓存该页的基准宽度
    baseViewports.value[p - 1] = markRaw(getBaseViewport(page))
    base = baseViewports.value[p - 1]!
  }
  const rs = effectiveScale(base.width)
  if (renderedAs.value[p - 1] === rs) return // 已按此缩放渲染过

  const page = await proxy.getPage(p)
  if (!store.doc || pageEls.value[p - 1] !== wrap) return
  const viewport = page.getViewport({ scale: rs })
  await renderPageOp(canvas, page, viewport)

  renderedAs.value[p - 1] = rs
  store.renderScales[p - 1] = rs
  store.pageViewports[p - 1] = markRaw(viewport)
}

/* ---------- 观察器 / 事件 ---------- */

let io: IntersectionObserver | null = null
function buildObserver() {
  io?.disconnect()
  if (!scrollEl.value || !store.doc) {
    io = null
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const p = Number((e.target as HTMLElement).dataset.page)
          if (Number.isInteger(p)) schedule(p)
        }
      }
    },
    { root: scrollEl.value, rootMargin: '600px 0px', threshold: 0 },
  )
  pageEls.value.forEach((el) => el && io?.observe(el))
}

let resizeObs: ResizeObserver | null = null
function rebuildResizeObserver() {
  resizeObs?.disconnect()
  if (!scrollEl.value) return
  resizeObs = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = Math.floor(e.contentRect.width)
      if (w !== containerWidth.value) containerWidth.value = w
    }
  })
  resizeObs.observe(scrollEl.value)
}

let scrollRaf = 0
let scrollLocked = false
function onScroll() {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(updateCurrentPage)
}
function updateCurrentPage() {
  scrollRaf = 0
  if (scrollLocked || !scrollEl.value) return
  const mid = scrollEl.value.scrollTop + scrollEl.value.clientHeight / 2
  for (let i = 0; i < pageEls.value.length; i++) {
    const el = pageEls.value[i]
    if (!el) continue
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (mid >= top && mid <= bottom) {
      if (store.currentPage !== i + 1) store.currentPage = i + 1
      return
    }
  }
}

function scrollToPage(p: number) {
  const el = pageEls.value[p - 1]
  scrollEl.value?.scrollTo({ top: el ? el.offsetTop - 4 : 0, behavior: 'smooth' })
}

/* ---------- 拖放 / 打开 ---------- */

function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    void openFile(file)
  }
}
function onEmptyClick() {
  fileInput.value?.click()
}
function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  void openFile(file as File)
  if (fileInput.value) fileInput.value.value = ''
}
async function openFile(file: File) {
  try {
    await store.openFile(file)
  } catch {
    /* 错误信息已写入 store */
  }
}

/* ---------- 联动 ---------- */

function resetPerPage() {
  pageEls.value = []
  baseViewports.value = []
  renderedAs.value = new Array(store.numPages).fill(0)
}

watch(
  () => store.numPages,
  async () => {
    resetPerPage()
    await nextTick()
    buildObserver()
    scheduleAll()
  },
)

watch(
  () => store.currentPage,
  (p) => {
    if (!store.doc) return
    scrollLocked = true
    scrollToPage(p)
    window.setTimeout(() => (scrollLocked = false), 450)
  },
)

watch(
  () => [store.scale, store.fitWidth] as const,
  () => {
    renderedAs.value = renderedAs.value.map(() => 0)
    scheduleAll()
  },
)

watch(containerWidth, () => {
  if (store.fitWidth && store.doc) {
    renderedAs.value = renderedAs.value.map(() => 0)
    scheduleAll()
  }
})

onMounted(() => {
  rebuildResizeObserver()
  buildObserver()
  watch(() => pageEls.value.length, buildObserver)
})

onBeforeUnmount(() => {
  io?.disconnect()
  resizeObs?.disconnect()
  if (flushTimer) clearTimeout(flushTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <div
    ref="scrollEl"
    class="viewport"
    @scroll.passive="onScroll"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div v-if="!store.doc" class="empty" @click="onEmptyClick">
      <input ref="fileInput" type="file" accept="application/pdf,.pdf" hidden @change="onFileChange" />
      <div v-if="store.loading" class="empty-msg">正在解析 PDF…</div>
      <div v-else class="empty-box">
        <div class="empty-icon">📄</div>
        <p>将 PDF 文件拖到这里，或点击打开</p>
      </div>
    </div>

    <div v-else class="pages">
      <div
        v-for="i in store.numPages"
        :key="i"
        class="page-wrap"
        :data-page="i"
        :ref="setPageEl(i)"
      >
        <canvas></canvas>
        <PatchPreviewLayer :page-index="i" />
        <TextEditLayer :page-index="i" />
      </div>
    </div>
  </div>
</template>
