/** Map upsert 提案（TC39 stage 3）类型补充：pdfjs-dist v6 依赖这两个方法，
 * 当前 TS lib 尚未收录；运行时 polyfill 见 main.ts 与 services/pdf.ts。 */
interface Map<K, V> {
  getOrInsert(key: K, value: V): V
  getOrInsertComputed(key: K, calc: (key: K) => V): V
}
