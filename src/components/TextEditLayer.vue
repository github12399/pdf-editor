<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDocStore } from '../stores/docStore'
import { useEditStore } from '../stores/editStore'
import { getPageTextHits, pdfRectToCssRect } from '../services/text'
import type { PdfRect, TextHit } from '../services/text'

interface CssHit extends TextHit {
  key: string
  css: PdfRect
  cssFontSize: number
}

const props = defineProps<{ pageIndex: number }>()
const store = useDocStore()
const edit = useEditStore()

const layerEl = ref<HTMLDivElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const hits = ref<CssHit[]>([])
const hoverKey = ref('')
const editing = ref<{ key: string; value: string } | null>(null)

let loadSeq = 0
let disposed = false

/** 页面 viewport 就绪后加载文本命中（CSS 坐标），viewport 变化时重载 */
async function loadHits() {
  const proxy = store.doc
  const vp = store.pageViewports[props.pageIndex - 1]
  if (!proxy || !vp) return
  const seq = ++loadSeq
  const page = await proxy.getPage(props.pageIndex)
  if (disposed || seq !== loadSeq || !store.doc) return
  const raw = await getPageTextHits(page)
  if (disposed || seq !== loadSeq) return
  hits.value = raw.map((h, i) => ({
    ...h,
    key: `${props.pageIndex}:${i}`,
    css: pdfRectToCssRect(h.pdfRect, vp),
    cssFontSize: h.fontSize * vp.scale,
  }))
}

watch(
  () => store.pageViewports[props.pageIndex - 1],
  (vp) => {
    hits.value = []
    hoverKey.value = ''
    editing.value = null
    if (vp) void loadHits()
  },
  { immediate: true },
)

function pointFrom(e: MouseEvent) {
  const r = layerEl.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function hitAt(x: number, y: number): CssHit | null {
  for (const h of hits.value) {
    const c = h.css
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return h
  }
  return null
}

function onMove(e: MouseEvent) {
  if (!edit.editing || editing.value) return
  const p = pointFrom(e)
  hoverKey.value = hitAt(p.x, p.y)?.key ?? ''
}

function onLeave() {
  hoverKey.value = ''
}

/** 编辑中放行鼠标事件（input 内可定位光标），否则拦截避免误选 canvas */
function onMouseDown(e: MouseEvent) {
  if (editing.value) return
  e.preventDefault()
}

function onClick(e: MouseEvent) {
  if (!edit.editing || editing.value) return
  const p = pointFrom(e)
  const h = hitAt(p.x, p.y)
  if (!h) return
  editing.value = { key: h.key, value: h.str }
  hoverKey.value = ''
  void nextTick(() => inputEl.value?.focus())
}

function commitEdit() {
  const ed = editing.value
  if (!ed) return
  const h = hits.value.find((x) => x.key === ed.key)
  editing.value = null
  if (!h || !ed.value.trim()) return
  if (ed.value === h.str) return
  edit.commit({
    pageIndex: props.pageIndex,
    hitKey: h.key,
    pdfRect: h.pdfRect,
    originalText: h.str,
    newText: ed.value,
    fontSize: h.fontSize,
  })
}

function cancelEdit() {
  editing.value = null
  hoverKey.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
    ;(e.target as HTMLElement).blur()
  }
}

function onBlur() {
  // Enter/Esc 处理时 editing 已置空，这里自然无操作
  commitEdit()
}

/* ---------- 渲染辅助 ---------- */

const hovered = computed(() => hits.value.find((h) => h.key === hoverKey.value) ?? null)
const hoverStyle = computed(() => {
  const c = hovered.value?.css
  if (!c) return {}
  return { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }
})

const editingHit = computed(
  () => hits.value.find((h) => h.key === editing.value?.key) ?? null,
)
const inputWrapStyle = computed(() => {
  const c = editingHit.value?.css
  if (!c) return {}
  return { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }
})
const inputStyle = computed(() => {
  const h = editingHit.value
  if (!h) return {}
  return { fontSize: `${h.cssFontSize}px`, lineHeight: `${h.css.h}px` }
})
</script>

<template>
  <div
    ref="layerEl"
    class="text-edit-layer"
    :class="{ active: edit.editing }"
    @mousemove="onMove"
    @mouseleave="onLeave"
    @mousedown="onMouseDown"
    @click="onClick"
  >
    <div v-if="hovered" class="te-hover" :style="hoverStyle"></div>
    <div v-if="editing" class="te-input-wrap" :style="inputWrapStyle">
      <input
        ref="inputEl"
        v-model="editing.value"
        class="te-input"
        :style="inputStyle"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>
  </div>
</template>

<style scoped>
.text-edit-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.text-edit-layer.active {
  pointer-events: auto;
  cursor: default;
}

.te-hover {
  position: absolute;
  background: rgba(59, 130, 246, 0.24);
  outline: 1px solid rgba(37, 99, 235, 0.55);
  border-radius: 1px;
  pointer-events: none;
}

.te-input-wrap {
  position: absolute;
  z-index: 6;
  background: #fff;
  outline: 2px solid var(--accent);
  border-radius: 1px;
  overflow: hidden;
}

.te-input {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  padding: 0 2px;
  background: transparent;
  color: #111;
  font-family: var(--sans);
  font-size: 14px;
  white-space: pre;
}
</style>