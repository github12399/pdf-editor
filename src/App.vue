<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocStore } from './stores/docStore'
import { useEditStore } from './stores/editStore'
import { saveDraft, deleteDraft } from './services/draftStore'
import TopToolbar from './components/TopToolbar.vue'
import PdfCanvas from './components/PdfCanvas.vue'
import EditSidebar from './components/EditSidebar.vue'

const store = useDocStore()
const edit = useEditStore()

const hideScanHint = ref(false)
watch(
  () => !!store.doc,
  () => (hideScanHint.value = false),
)

/* ---------- 草稿自动保存 ----------
 * 编辑记录变化后防抖写入 IndexedDB（按文件指纹索引），避免并发写同键乱序。
 * 删除草稿的闸门：只有“当前指纹 == 上次实际保存过草稿的指纹”时，
 * 空记录才删除对应草稿——避免打开新文档时内部 clear 误删旧文档草稿。
 * pagehide 兜底：用户编辑后立刻关闭窗口时，防抖可能未到期，立即 flush。 */
let saveTimer: ReturnType<typeof setTimeout> | undefined
let savedFp = ''

function flushDraft() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  const fp = store.fingerprint
  if (!fp || !store.fileBytes) return
  const recs = edit.records
  if (recs.length) {
    void saveDraft(fp, store.fileName, store.fileBytes, recs).catch(() => {})
    savedFp = fp
  } else if (fp === savedFp) {
    void deleteDraft(fp).catch(() => {})
    savedFp = ''
  }
}

watch(
  () => edit.records,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flushDraft, 600)
  },
  { deep: true },
)

/* 全局撤销/重做快捷键（输入框内让位给编辑器自身的文本撤销） */
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z') {
    e.preventDefault()
    if (e.shiftKey) edit.redo()
    else edit.undo()
  } else if (k === 'y') {
    e.preventDefault()
    edit.redo()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pagehide', flushDraft)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pagehide', flushDraft)
})
</script>

<template>
  <div class="app">
    <TopToolbar />
    <div class="main">
      <PdfCanvas />
      <EditSidebar v-if="store.doc" />
    </div>
    <Transition name="fade">
      <div v-if="store.doc && !store.hasTextLayer && !hideScanHint" class="scan-hint">
        <span>⚠️ 该 PDF 没有文字层（扫描件 / 图片型），无法直接修改文字</span>
        <button class="error-close" @click="hideScanHint = true">✕</button>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="store.error" class="error-bar">
        {{ store.error }}
        <button class="error-close" @click="store.setError('')">✕</button>
      </div>
    </Transition>
  </div>
</template>