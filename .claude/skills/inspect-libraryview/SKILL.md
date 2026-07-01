---
name: inspect-libraryview
description: >-
  看到并测量 LibraryView 桌面应用（Electron + Vite + React，位于 E:\Projects\LibraryView）真实运行的界面与性能，而不是靠猜。
  当在 LibraryView 项目里需要：确认某个界面/样式改动实际长什么样、排查 UI 卡顿或"未响应"、验证扫描/封面/阅读进度等后台行为是否正常时，
  务必使用本 skill。凡是"这个页面对不对""帮我看看效果""是不是又卡了""截个图看看""启动慢/卡"之类涉及本应用可视化或性能的请求都应触发。
  它靠应用内置的 LV_SHOT / LV_DIAG / LV_SMOKE 等环境变量钩子来截图和量测。
---

# 自查 LibraryView 的界面与性能

LibraryView 是个 Electron 桌面应用，没有常规的"浏览器预览"能感知它的界面。为此，应用主进程 `src/main/index.ts` 内置了一组**环境变量钩子**（平时不设这些变量则毫无影响）。用它们可以：把真实界面截成 PNG 让你 `Read`、把主线程卡顿量化出来、无头验证数据层与后台任务。

## 通用前提

- **从项目根目录运行**（`E:\Projects\LibraryView`）。`npx electron .` 跑的是构建产物 `out/`，所以**先 `npm run build`**（改了代码就要重新 build）。
- 运行会读取项目根 `config.json` 的 `dataDir`（当前为 `D:\ProgramData\LibraryView`，数据库与封面都在那里）。应用名 `libraryview`。
- **先杀掉在跑的实例**，避免两个实例抢同一个数据库：
  ```powershell
  Stop-Process -Name LibraryView, electron -Force -ErrorAction SilentlyContinue
  ```
- 环境变量值尽量用 **ASCII**（Windows 下向原生 exe 传中文参数/环境值可能乱码）。`LV_SHOT_NAV` 用页面 id：`shelf` / `stats` / `settings`。
- 用 PowerShell 时用 `$env:NAME='值'` 设置；这些钩子进程会继承环境变量。

## 看界面（截图）——最常用

`LV_SHOT` 会在窗口加载后（可选先导航到某页）用 `webContents.capturePage()` 截图存 PNG，然后**自动退出**。之后用 `Read` 工具查看 PNG 即可"看到"界面。

```powershell
npm run build
$shot = 'C:\Users\<你>\AppData\Local\Temp\claude\...\scratchpad\shot.png'  # 用一个绝对路径
$env:LV_SHOT = $shot
$env:LV_SHOT_NAV = 'settings'   # 可选：shelf | stats | settings，缺省停在书架墙
$env:LV_SHOT_DELAY = '3000'     # 可选：截图前等待毫秒（等首屏渲染/封面），默认 4500
npx electron .
```
然后：`Read` 那个 `shot.png`。

导航原理：钩子对 `document.querySelector('[data-nav="<id>"]').click()`（侧边栏按钮带 `data-nav`）。要截其它状态（如打开某弹窗），可在 `src/main/index.ts` 的 `LV_SHOT` 分支里临时加一段 `executeJavaScript`。

## 测性能 / 排查卡顿

`LV_DIAG=1` 让主进程把**事件循环延迟**（`[diag] loop lag <ms>`）和**扫描各阶段耗时**（`[diag] indexLibrary <ms>` / `backfill`）打到 stdout。Electron 的窗口消息泵在主进程，主循环被阻塞几秒窗口就会"未响应"——这个探针能定位是哪一步、堵了多久。

```powershell
npm run build
$env:LV_DIAG = '1'
npx electron .
```
正常运行不会自动退出。推荐**后台运行**，等 ~15–20s 后从输出里 `grep "\[diag\]"`，再 `Stop-Process` 结束。判读：偶发几百 ms 的 lag 可接受；出现数秒的单次 lag 就是会导致 UI 卡死的元凶，需要把对应阶段移出主线程或分批 `await setImmediate` 让出事件循环。

## 无头验证数据 / 后台任务

这些钩子跑完即退出，把结果写到 `LV_SMOKE_OUT` 指定的文件（或打印），适合快速核对而无需开窗：

| 环境变量 | 作用 |
|---|---|
| `LV_SMOKE=1` + `LV_SMOKE_OUT=<文件>` | 输出：书籍数、sqlite 版本、阅读器与 Sumatra 路径。确认数据库连得上、库读得到。 |
| `LV_WORKERTEST=1` + `LV_SMOKE_OUT=<文件>` | 在 utilityProcess 里给一本 PDF 算页数 + 渲封面，验证工作进程链路。 |
| `LV_SCAN=<目录>` + `LV_SMOKE_OUT=<文件>` | 对指定目录做一次索引 + 少量页数补算 + Sumatra 同步并报告（会写库；隔离测试可配合 `LV_DB_PATH`）。 |
| `LV_SUMATRA=1` + `LV_SMOKE_OUT=<文件>` | 只跑一次 SumatraPDF 进度同步并报告。 |
| `LV_DB_PATH=<db文件>` | 覆盖数据库路径，做不污染正式库的隔离测试。 |

例：
```powershell
$out = 'C:\...\scratchpad\smoke.txt'
$env:LV_SMOKE = '1'; $env:LV_SMOKE_OUT = $out
npx electron .
# 然后 Read $out
```

## 注意

- 这些钩子都在 `src/main/index.ts`，用 `process.env.LV_*` 守卫，正常启动（不设变量）完全不受影响。
- 截图/无头钩子会 `app.exit()` 自动结束；`LV_DIAG` 和普通启动需要手动 `Stop-Process` 结束。
- 若装了打包版（`D:\Program Files\LibraryView\LibraryView.exe`），同样能带这些环境变量运行来复现打包形态下的行为；它读安装目录的 `config.json`。
