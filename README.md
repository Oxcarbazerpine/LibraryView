# LibraryView

个人电子书库桌面应用：扫描本地书库、书架墙浏览、阅读时长统计、阅读进度自动同步。

> 自用小工具。Windows · Electron + React。

## 功能

- **书架墙**：网格展示书库，PDF 自动渲染首页作封面，显示阅读进度、上次阅读时间、状态；支持搜索 / 筛选（全部·在读·未读·读完）/ 排序，海量书籍下无限滚动。
- **扫描索引**：递归扫描库目录，识别 PDF / EPUB / MOBI / AZW3 / DjVu / CBZ。两段式——先秒级入库（书架立即可浏览），再后台用 pdfjs 补算 PDF 总页数。基于文件大小+修改时间增量更新，支持实时监听与定时扫描。
- **阅读会话**：点击书籍 → 用外部阅读器（推荐 SumatraPDF）打开并开始计时，卡片播放音乐波纹动画；再点一下手动结束，时长入库。
- **进度自动同步**：监听 SumatraPDF 的 `SumatraPDF-settings.txt`，解析 `FileStates` 的 `PageNo`，自动回写每本书的当前页与进度。
- **统计面板**：每日阅读时长柱状图、累计时长、连续阅读天数、在读/读完数。
- **设置**：库目录（多目录）、外部阅读器、SumatraPDF 设置文件、扫描间隔、封面缓存目录。

## 技术栈

Electron 42 · electron-vite 5 · Vite 7 · React 19 · TypeScript · Tailwind CSS v4 · better-sqlite3 · pdfjs-dist + @napi-rs/canvas（主进程渲染封面）· chokidar。

## 开发

```bash
npm install
npm run dev          # 启动开发（HMR）
npm run typecheck    # 类型检查（主进程 + 渲染层）
npm run build        # 仅构建（产出到 out/）
```

> 原生模块 `better-sqlite3` 由 electron-builder / `npm run rebuild` 自动按 Electron ABI 重编译。

## 打包

```bash
npm run package      # 产出 NSIS 安装包到 dist/
npm run package:dir  # 仅产出免安装目录 dist/win-unpacked/
```

打包脚本通过 `cross-env` 将 electron-builder 缓存指到 `.ebcache/`（位于项目所在的本地卷）。原因：部分（尤其企业重定向的）`%LOCALAPPDATA%` 卷不支持原子重命名，electron-builder 解压工具时会报 `EXDEV`；放到正常本地卷即可避开。注意两点：① 该路径必须是**绝对路径**（electron-builder 不认相对路径，会退回默认缓存），目前硬编码为 `E:/Projects/LibraryView/.ebcache`，迁移项目时需同步修改；② `.ebcache` 已在 `build.files` 里排除，不会被打进安装包。

## 数据位置

- 数据库（单文件 SQLite）：`%APPDATA%\libraryview\libraryview.db`（books / reading_sessions / settings 三张表）
- 封面缓存：`%APPDATA%\libraryview\covers\<书id>.png`（可在设置里改目录；经 `lvimg://cover/<id>` 协议提供给界面）

开发版与打包版共用同一数据目录。

## 进度同步说明

进度同步专为 **SumatraPDF** 适配（免费、轻量、记录每个文件的上次阅读页）。换用其它阅读器时，时长统计照常，但"自动进度"需要单独适配或改为手动设置页码。首次启动会自动探测 SumatraPDF 的安装位置与设置文件。
