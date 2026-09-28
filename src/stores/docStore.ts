import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PageViewport } from 'pdfjs-dist'
import { loadPdf } from '../services/pdf'
import { getPageTextHits } from '../services/text'
import { fingerprintBytes, loadDraft } from '../services/draftStore'
import { useEditStore } from './editStore'

const MIN_SCALE = 0.1
const MAX_SCALE = 3

export const useDocStore = defineStore('doc', () => {
  const doc = ref<PDFDocumentProxy | null>(null)
  const fileName = ref('')
  /** 原始 PDF 字节，导出阶段重绘用 */
  const fileBytes = ref<ArrayBuffer | null>(null)
  /** 文件指纹（草稿索引键） */
  const fingerprint = ref('')
  /** 是否有可编辑文本层（false = 扫描件/图片型，提示不可改字） */
  const hasTextLayer = ref(true)
  const numPages = ref(0)
  const currentPage = ref(1)

  /** 手动缩放（1 = 100%），fitWidth 打开时仅作为兜底 */
  const scale = ref(1)
  const fitWidth = ref(true)
  /** 当前渲染的实际缩放（内部维护，PdfCanvas 每页更新） */
  const renderScales = ref<number[]>([])
  /** 每页渲染用的 viewport（对应 renderScale） */
  const pageViewports = ref<(PageViewport | null)[]>([])

  const loading = ref(false)
  const error = ref('')

  let loadingTask: PDFDocumentLoadingTask | null = null

  function setError(msg: string) {
    error.value = msg
  }

  /** 打开本地 PDF 文件。失败时抛出，由调用方提示。 */
  async function openFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      error.value = '仅支持 PDF 文件（.pdf）'
      throw new Error('not a pdf')
    }
    loading.value = true
    error.value = ''
    try {
      const bytes = await file.arrayBuffer()
      if (!bytes.byteLength) throw new Error('文件为空')
      // pdfjs 会把 ArrayBuffer 以 transferable 交给 worker，之后主线程引用被 detach，
      // 因此先复制一份留作导出阶段使用
      const keep = bytes.slice(0)
      // 销毁旧文档的 worker/transport，再加载新文档
      if (loadingTask) {
        loadingTask.destroy().catch(() => {})
        loadingTask = null
      }
      const task = await loadPdf(bytes)
      loadingTask = task
      const proxy = await task.promise

      doc.value = markRaw(proxy)
      fileBytes.value = keep
      fileName.value = file.name
      fingerprint.value = fingerprintBytes(keep)
      numPages.value = proxy.numPages
      currentPage.value = 1
      scale.value = 1
      fitWidth.value = true
      renderScales.value = new Array(proxy.numPages).fill(1)
      pageViewports.value = new Array(proxy.numPages).fill(null)

      // 草稿恢复：同一文件指纹命中草稿则还原编辑记录
      const edit = useEditStore()
      edit.clear()
      edit.editing = false
      const draft = await loadDraft(fingerprint.value).catch(() => null)
      if (draft && draft.records.length) edit.hydrate(draft.records)

      // 扫描件检测：抽查前 3 页，任一页有文本项即视为可编辑
      hasTextLayer.value = true
      try {
        let found = false
        for (let p = 1; p <= Math.min(proxy.numPages, 3); p++) {
          const page = await proxy.getPage(p)
          if ((await getPageTextHits(page)).length > 0) {
            found = true
            break
          }
        }
        hasTextLayer.value = found
      } catch {
        hasTextLayer.value = true
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = `无法打开该 PDF：${msg}`
      throw e
    } finally {
      loading.value = false
    }
  }

  /** 关闭文档并释放资源。 */
  function closeDoc() {
    if (loadingTask) {
      loadingTask.destroy().catch(() => {})
      loadingTask = null
    }
    doc.value = null
    fileName.value = ''
    fileBytes.value = null
    fingerprint.value = ''
    hasTextLayer.value = true
    numPages.value = 0
    currentPage.value = 1
    renderScales.value = []
    pageViewports.value = []
  }

  /** 翻页（±1），自动钳制范围。 */
  function turnPage(delta: number) {
    const next = currentPage.value + delta
    if (next < 1 || next > numPages.value) return
    currentPage.value = next
  }

  function goToPage(p: number) {
    if (!numPages.value) return
    currentPage.value = Math.min(Math.max(1, Math.round(p)), numPages.value)
  }

  /** 放大/缩小（×1.25），进入手动缩放模式并退出适应宽度。 */
  function zoomIn() {
    fitWidth.value = false
    scale.value = Math.min(MAX_SCALE, +(scale.value * 1.25).toFixed(3))
  }
  function zoomOut() {
    fitWidth.value = false
    scale.value = Math.max(MIN_SCALE, +(scale.value / 1.25).toFixed(3))
  }
  function zoomReset() {
    fitWidth.value = false
    scale.value = 1
  }
  function toggleFitWidth() {
    fitWidth.value = !fitWidth.value
  }

  return {
    doc, fileName, fileBytes, fingerprint, hasTextLayer, numPages, currentPage,
    scale, fitWidth, renderScales, pageViewports,
    loading, error,
    setError, openFile, closeDoc,
    turnPage, goToPage,
    zoomIn, zoomOut, zoomReset, toggleFitWidth,
  }
})