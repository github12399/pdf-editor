# PDF 文字编辑器

纯前端（零后端）的 PDF 文字编辑器：打开基于文字的 PDF → 点击选中文本 → 原地修改 → 导出新 PDF。导出时在原文字位置做背景采样擦除 + 后备字体同位重绘，白底文档效果接近无痕。

## 功能

- 打开/拖入本地 PDF；翻页、缩放（10%–300% + 适应宽度）、页码导航
- 文本编辑模式：hover 高亮文本项 → 点击进入内联编辑 → Enter 确认 / Esc 取消；可连续改多处
- 编辑记录侧栏：按页列出"原文 → 新文"、删除单条；撤销/重做（Ctrl+Z / Ctrl+Shift+Z）
- 实时画布预览修改效果（擦旧字 + 画新字）
- 导出下载新 PDF（pdf-lib：背景采样擦除 + 黑体后备字体嵌入重绘，超宽自动缩号）
- 草稿自动保存（IndexedDB，按文件指纹；重开同一文件自动恢复原始字节 + 编辑记录）
- 扫描件（无文字层）自动提示不可改字

## 开发

```bash
pnpm install
pnpm dev        # 开发服务器
pnpm build      # 类型检查 + 生产构建
```

## 桌面版（exe）

基于 Electron 封装，`app://` 自定义协议承载前端产物（支持 IndexedDB / module worker / fetch）。

```bash
pnpm app:build         # Windows：vite build + electron-builder --win
pnpm app:build:linux   # Linux：AppImage + deb（需在 Linux/CI 上跑）
pnpm app:build:mac     # macOS：dmg（需在 macOS/CI 上跑）
```

产物在 `release/`：

| 文件 | 说明 |
|---|---|
| `PDF文字编辑器-Portable-1.0.0.exe` | 便携版：单文件免安装，拷到其他电脑（Windows 10/11 x64）双击即用 |
| `PDF文字编辑器-Setup-1.0.0.exe` | 安装包：双击安装（带桌面/开始菜单快捷方式），带卸载器 |

迁移到其他电脑：直接拷贝便携版 exe 即可，无需安装任何运行时。首次运行可能弹出 SmartScreen 提示（未签名应用），点「更多信息 → 仍要运行」。

## 跨平台打包（macOS / Linux）

三平台安装包用 GitHub Actions 自动构建（`.github/workflows/build.yml`）：
Windows 本机只能打 Windows 包（electron-builder 不支持交叉打包；打 Linux 包会卡在
Windows 的符号链接权限上，macOS 包必须由 macOS 产出）。

```bash
# 1. 把 pdf-editor 推到 GitHub 仓库
# 2. 打 tag 触发三平台构建并自动发布 Release 草稿
git tag v1.0.0 && git push origin v1.0.0
# 3. 到 GitHub Releases 里把草稿发布出去，或直接在 Actions 页面下载 Artifacts
```

产物矩阵：

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows x64 | `PDF文字编辑器-Setup/Portable-*.exe` | 安装包 / 便携版 |
| macOS arm64 | `PDF文字编辑器-mac-arm64-*.dmg` | Apple 芯片（M1 及以后） |
| macOS x64 | `PDF文字编辑器-mac-x64-*.dmg` | Intel 芯片 |
| Linux x64 | `PDF文字编辑器-linux-*.AppImage` | 免安装，`chmod +x` 后直接运行 |
| Linux x64 | `PDF文字编辑器-linux-*.deb` | Ubuntu/Debian 安装包 |

macOS 包未签名（无 Apple 开发者账号 $99/年）：首次打开需**右键 → 打开**（直接双击会被
Gatekeeper 拦截），之后正常使用。

## 测试

```bash
node scripts/smoke-electron.mjs
# 对打包产物做全量冒烟：
SMOKE_EXE="$LOCALAPPDATA/Programs/pdf-editor/PDF文字编辑器.exe" node scripts/smoke-electron.mjs
```

16 项断言：窗口加载、IndexedDB、多页渲染、文本层命中、内联编辑、画布预览、导出字节解析、草稿写入与恢复。全部基于 DOM/canvas 像素断言，不依赖 Vue 内部属性。

## 已知限制

- 重绘使用内置黑体（simhei）后备字体，原文特殊字体/颜色为近似呈现（彩色文字提取在后续计划）
- 逐段替换、不重排段落；新文本超宽时自动缩小字号适配原段宽
- 深色/图片背景的擦除可能留痕（界面有相应提示）
