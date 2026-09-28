import { openDB, type IDBPDatabase } from 'idb'
import type { EditRecord } from '../stores/editStore'

/**
 * IndexedDB 草稿存储：按「文件指纹（原始字节 hash）」为键，保存原始 PDF 字节
 * 与当前编辑记录。打开同一文件时自动恢复上次未完成编辑。
 *
 * 表结构：drafts { fingerprint, fileName, bytes, records, updatedAt }
 */

interface DraftRow {
  fingerprint: string
  fileName: string
  bytes: ArrayBuffer
  records: EditRecord[]
  updatedAt: number
}

const DB_NAME = 'pdf-editor-drafts'
const DB_VERSION = 1
const STORE = 'drafts'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'fingerprint' })
        }
      },
    })
  }
  return dbPromise
}

/** djb2 型（含长度）指纹：对 PDF 字节做快速散列，同文件字节必有同指纹 */
export function fingerprintBytes(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes)
  let h = 5381
  for (let i = 0; i < u8.length; i++) {
    h = ((h << 5) + h + u8[i]) | 0
  }
  return `p${(h >>> 0).toString(36)}x${u8.length.toString(36)}`
}

export async function saveDraft(
  fingerprint: string,
  fileName: string,
  bytes: ArrayBuffer,
  records: EditRecord[],
): Promise<void> {
  const db = await getDB()
  const row: DraftRow = {
    fingerprint,
    fileName,
    bytes,
    // records 可能来自 Pinia 响应式状态，逐字段解包为纯数据，
    // 否则嵌套 proxy 无法通过 IndexedDB 结构化克隆（DataCloneError）
    records: records.map((r) => ({
      id: r.id,
      pageIndex: r.pageIndex,
      hitKey: r.hitKey,
      pdfRect: { x: r.pdfRect.x, y: r.pdfRect.y, w: r.pdfRect.w, h: r.pdfRect.h },
      originalText: r.originalText,
      newText: r.newText,
      fontSize: r.fontSize,
    })),
    updatedAt: Date.now(),
  }
  await db.put(STORE, row)
}

export async function loadDraft(
  fingerprint: string,
): Promise<{ fileName: string; records: EditRecord[] } | null> {
  const db = await getDB()
  const row = await db.get(STORE, fingerprint)
  if (!row) return null
  return { fileName: row.fileName, records: row.records }
}

export async function deleteDraft(fingerprint: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE, fingerprint)
}

export async function clearDrafts(): Promise<void> {
  const db = await getDB()
  await db.clear(STORE)
}
