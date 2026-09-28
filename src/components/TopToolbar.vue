<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDocStore } from '../stores/docStore'
import { useEditStore } from '../stores/editStore'
import { exportEditedPdf } from '../services/exportPdf'

const store = useDocStore()
const edit = useEditStore()
const fileInput = ref<HTMLInputElement | null>(null)
const exporting = ref(false)
const exportError = ref('')

const zoomLabel = computed(() => {
  if (store.fitWidth) return '适应宽度'
  return `${Math.round(store.scale * 100)}%`
})

async function onExport() {
  if (!store.fileBytes || !store.doc) return
  exporting.value = true
  exportError.value = ''
  try {
    const { bytes, fileName } = await exportEditedPdf({
      fileBytes: store.fileBytes,
      fileName: store.fileName || 'document.pdf',
      records: edit.records,
      getPage: (p) => store.doc!.getPage(p),
    })
    // slice() 得到独立 ArrayBuffer 视图，规避 SharedArrayBuffer 联合类型
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = false
  }
}

function onPick() {
  fileInput.value?.click()
}
async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    try {
      await store.openFile(file)
    } catch {
      /* 错误已入 store */
    }
  }
  if (fileInput.value) fileInput.value.value = ''
}
function jumpTo(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) store.goToPage(v)
}
</script>

<template>
  <header class="toolbar">
    <button class="btn primary" @click="onPick" :disabled="store.loading">打开 PDF</button>
    <input
      ref="fileInput"
      type="file"
      accept="application/pdf,.pdf"
      hidden
      @change="onFileChange"
    />

    <span class="fname" :title="store.fileName">{{ store.fileName || '未打开文档' }}</span>

    <div v-if="store.doc" class="group">
      <button
        class="btn"
        :class="{ active: edit.editing }"
        @click="edit.editing = !edit.editing"
        :disabled="!store.hasTextLayer"
        :title="
          store.hasTextLayer
            ? edit.editing
              ? '当前：文本编辑模式，点击页面文字可修改；再次点击退出'
              : '文本编辑模式：点击文字可修改'
            : '该 PDF 没有文字层（扫描件 / 图片型），无法修改文字'
        "
      >
        ✏️ 改文字
      </button>
      <button class="btn" @click="edit.undo" :disabled="!edit.undoable" title="撤销 (Ctrl+Z)">↶</button>
      <button class="btn" @click="edit.redo" :disabled="!edit.redoable" title="重做 (Ctrl+Shift+Z / Ctrl+Y)">↷</button>
      <button
        class="btn primary"
        @click="onExport"
        :disabled="!edit.records.length || exporting"
        :title="edit.records.length ? '导出为新的 PDF 文件' : '还没有编辑记录'"
      >
        {{ exporting ? '导出中…' : '💾 导出 PDF' }}
      </button>
    </div>
    <span v-if="exportError" class="export-error" :title="exportError">{{ exportError }}</span>

    <div v-if="store.doc" class="group">
      <button class="btn" @click="store.turnPage(-1)" :disabled="store.currentPage <= 1">◀</button>
      <input
        class="pageno"
        type="number"
        :value="store.currentPage"
        min="1"
        :max="store.numPages"
        @change="jumpTo"
      />
      <span class="total">/ {{ store.numPages }}</span>
      <button class="btn" @click="store.turnPage(1)" :disabled="store.currentPage >= store.numPages">▶</button>
    </div>

    <div v-if="store.doc" class="group">
      <button class="btn" @click="store.zoomOut" title="缩小">−</button>
      <button class="btn" @click="store.toggleFitWidth" :class="{ active: store.fitWidth }" title="适应页面宽度">
        适应宽度
      </button>
      <button class="btn" @click="store.zoomIn" title="放大">＋</button>
      <span class="zoom-label">{{ zoomLabel }}</span>
    </div>
  </header>
</template>

<style scoped>
.export-error {
  color: #fca5a5;
  font-size: 13px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>