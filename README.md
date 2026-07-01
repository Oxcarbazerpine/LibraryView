# LibraryView

个人电子书库桌面应用：扫描本地书库、书架墙浏览、阅读时长统计、阅读进度自动同步。

> 自用小工具。Windows · Electron + React。

## 功能

- **书架墙**：网格展示书库，显示阅读进度（封面「注水」效果）、上次阅读时间、状态；支持搜索 / 筛选（全部·在读·未读·读完）/ 排序。**虚拟滚动**，上万本也流畅、内存平稳；首屏优先加载书籍、统计延后。
- **封面与元数据**：PDF 渲染首页；EPUB / CBZ 解压取内嵌封面；MOBI / AZW3 解析 PDB+EXTH 抽取内嵌封面与书名/作者（文件名乱码的电子书据此纠正标题）。全部在独立工作进程完成，不阻塞界面。
- **扫描索引**：递归扫描库目录，识别 PDF / EPUB / MOBI / AZW3 / DjVu / CBZ。多段式——先秒级入库（书架立即可浏览），再后台抽取电子书元数据、补算 PDF 总页数。基于文件大小+修改时间增量更新。
- **阅读会话**：点击书籍 → 用外部阅读器打开并开始计时，卡片播放音乐波纹动画。基于 SumatraPDF 翻页活动**空闲自动结束**（默认 5 分钟无翻页），再次翻页**自动恢复**；也可随时手动结束。
- **进度自动同步**：监听 SumatraPDF 的 `SumatraPDF-settings.txt`，解析 `FileStates` 的 `PageNo`，自动回写每本书的当前页与进度。
- **书籍详情**：查看完整信息、阅读历史（每次时长/页码区间）、手动设置当前页。
- **统计面板**：日/周/月阅读时长柱状图、近一年阅读热力图、阅读时长排行、累计时长、连续阅读天数、在读/读完数。
- **设置**：库目录（多目录）、默认阅读器 + **按格式指定阅读器**（如 AZW3→Calibre）、空闲结束阈值、SumatraPDF 设置文件、扫描间隔、数据目录。

## 技术栈

Electron 42 · electron-vite 5 · Vite 7 · React 19 · TypeScript · Tailwind CSS v4 · better-sqlite3 · pdfjs-dist + @napi-rs/canvas（工作进程渲染/解码封面）· fflate（解 EPUB/CBZ）· @tanstack/react-virtual（虚拟滚动）· chokidar。

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

## 配置与数据位置

应用设置存放在**安装目录**下的 `config.json`（打包后 = 安装目录 / exe 同级；开发时 = 项目根）。其中的 `dataDir` 字段决定数据库与封面缓存的位置——这两者始终放在一起：

- 设置文件：`<安装目录>\config.json`（`dataDir` / `libraryPaths` / 阅读器 / 扫描等全部设置）
- 数据库（单文件 SQLite）：`<dataDir>\libraryview.db`（books / reading_sessions / settings 表）
- 封面缓存：`<dataDir>\covers\<书id>.png`（经 `lvimg://cover/<id>` 协议提供给界面）

`dataDir` 默认是 `%APPDATA%\libraryview`，可在「设置 → 数据目录」里更改——更改时会把旧数据库与封面迁移到新目录，然后重启生效。路径直接由设置决定，不做 `app.setPath` 重定向。Electron 框架自身的少量运行缓存仍按默认放在 `%APPDATA%\libraryview`（一次性缓存，非数据）。

**升级不丢配置**：`build/installer.nsh` 在卸载/升级前把安装目录的 `config.json` 备份到临时目录，安装后再恢复，因此重装/升级不会清空设置。

**数据库迁移**：`src/main/db.ts` 里基线 schema（`baseline()`）已冻结，任何后续结构变更都追加到 `MIGRATIONS` 数组（按 `PRAGMA user_version` 顺序执行 `ALTER` 等），全新库与既有库都会一致地演进到最新版本——不要再改基线。

## 代码签名

安装包目前**未签名**，Windows SmartScreen 首次运行会提示。若要签名：在 `package.json` 的 `build.win` 下加 `signtoolOptions`（证书文件/主题名或 EV 证书），electron-builder 会在打包时自动签署。无证书则保持现状即可（自用无碍）。

## 进度同步说明

进度同步专为 **SumatraPDF** 适配（免费、轻量、记录每个文件的上次阅读页）。换用其它阅读器时，时长统计照常，但"自动进度"需要单独适配或改为手动设置页码。首次启动会自动探测 SumatraPDF 的安装位置与设置文件。
