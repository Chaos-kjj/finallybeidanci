# Android 墨水屏阅读器重构状态

更新时间：2026-08-04

## 总体状态

已完成 Web/Capacitor/原生 Android 重构、自动化测试和 Android 模拟器回归。`beidanci_api34`（`emulator-5554`）已安装并验证两本真实书籍；Bigme B7 Pro 真机未连接，因此硬件按键手感、墨水屏刷新观感和设备侧安装/升级仍标为待真机验证。

## 阶段记录

| 阶段 | 状态 | 结果 |
| --- | --- | --- |
| 基线审查 | 完成 | 完整阅读规格、README、入口、解析器、清洗器、测试和 Supabase 配置；先运行原有 `npm test`，基线通过。 |
| 本地状态与迁移 | 完成 | IndexedDB schema version 4、阅读进度 v2 迁移、事务接口、Keystore Key store、备份脱敏。 |
| ReaderEngine | 完成 | `TextEngine`、`EpubEngine`、`PdfEngine`、结构化 EPUB 章节/目录、viewport CSS 分页、PDF 原版面/文本重排。 |
| DictionaryProvider | 完成 | 内置词典、Indexed 本地词典、StarDict、MDX、应用 ZIP 导入和 HTML 清洗；索引与原文件写入本地 `dictionaryEntries`/`files`，启动时重建。 |
| 背词功能恢复 | 完成 | 统一旧版学习状态机、SRS 间隔、每日新词/复习计划、基础/造句/听音模式、错词本、已认识/待复习列表、AI 释义、造句/翻译挑战和学习统计；状态只走 `appState`。 |
| AI 与操作栏 | 完成 | 模板变量、自定义 action、主动点击触发、原生 HTTPS 桥、Android Keystore、非流式响应。 |
| 墨水屏与 Android | 完成 | Capacitor Android 工程、KeyEvents 调试页、实体键映射、Android 系统 TTS、无动画高对比样式、无存储权限。 |
| 测试与交付 | 完成 | 默认 `npm run build` 强制执行 Node 全量测试、离线扫描、Vite/Capacitor 同步、`assembleDebug` 和 APK 源码指纹/逐文件新鲜度校验；最终 APK 已安装到 `emulator-5554` 回归。 |

## 关键决策

- 采用 Capacitor 7，保持 `com.kangkang.beidanci` applicationId；Web 资源由 Vite 打包进 APK。
- 旧 `app.js` 曾承载单体业务和云端状态。为避免迁移期出现两套业务状态，当前入口统一为 `src/main.js`，`app.js` 保留为无副作用的兼容说明文件；背词数据统一由 `src/core/learning.js` 和 `appState` 管理。
- Supabase 配置和 schema 已删除；Web 版 Service Worker 按每次构建的源码指纹隔离缓存并对页面使用网络优先策略，Android 原生包启动后注销 Service Worker，避免覆盖安装继续显示旧页面。
- PDF 第一实现使用本地 `pdfjs-dist`，`PdfEngine` 作为替换边界；原版面 Canvas 不建立整本 PDF 的 Canvas 池。
- API Key 不提供 Web 存储降级。没有原生安全桥时只能保存 AI 非敏感配置，Key 需要在 APK 内重新录入。
- Android 朗读优先使用 `NativeTtsPlugin` 的系统离线 TTS，普通浏览器使用本地 `SpeechSynthesis`，不引入外部音频依赖。

## 自动化测试结果

已通过：

- `npm run test:all`：7 个测试文件、7 个通过、0 个失败（包含 PDF.js legacy、计时、按键隐私和阅读器平台回归）
- `npm run lint:offline`
- `npm run build`：包含 Web 构建、Capacitor 同步、JDK 21 / Android 35 `assembleDebug` 和最终 APK 校验
- `npm test`：全量测试加 APK 新鲜度门禁
- `npm run verify:apk`：源码指纹一致，`dist`、Android assets 和 APK 逐文件一致，且 APK 内存在造句/翻译挑战入口

## Android 模拟器回归（2026-08-04）

设备：`beidanci_api34` / `emulator-5554`，物理显示 2560×1600，Android System WebView 113。测试文件只从 Downloads 推入模拟器，未加入仓库：

- `Investing Amid Low Expected Returns…epub`：导入、封面图片（4 个本地资源）、115 页稳定分页、右侧翻页、顶部 15% 菜单、中间点击不弹菜单、目录树（100 条）及跳转到 Chapter 1（第 27 页）、全文搜索（`returns` 503 条）、书签/笔记、强制退出后进度恢复均通过。
- `CFA 2026 Level I SchweserNotes Book-1.pdf`：PDF.js worker 在旧 WebView 离线加载、文本重排、原版面 Canvas（313 页）、原版面右侧翻页、阅读设置切换、全文搜索（`Welcome` 1 条）均通过；该 PDF 没有可用 outline，因此目录显示为空是源文件能力限制，不伪造目录。
- 打开失败隔离：推入 32 字节损坏 PDF 后显示 `打开失败：Invalid PDF structure.`，选择器仍指向上一本 EPUB，但正文区域被明确错误页替换，没有残留旧正文。
- 沉浸式：阅读正文占满屏幕，系统状态/导航栏隐藏；顶部菜单为覆盖层，不挤压正文。横屏/竖屏切换截图均保持正文可读。
- 备份：普通 ZIP 实际生成；完整 ZIP 曾触发 `TransactionTooLargeException`，已改为 native 临时文件 + SAF 流式复制，修复后完整 ZIP 实际生成并包含 14.5 MB `backup.json`，其中含 PDF/EPUB 原文件数据；导出后应用进程仍存活。
- 计时/隐私：背词页前后 IndexedDB `activeMs` 仅增加约 9.6 秒（22 秒观察窗口内，无 4 倍累加）；设置页发送音量键后日志仅显示 `keyCode`、`source`、`at`，不保存 printable `key`。

截图证据保存在本次验收的 `/tmp/beidanci-final-*.png`；最终 APK 路径和 SHA-256 由最后一次 `npm run build` / `verify:apk` 输出记录。

测试覆盖迁移、schema 版本常量、学习状态/SRS/每日计划、背词 UI 功能入口、APK 交付门禁、HTML 清洗、EPUB 章节/目录/搜索/分页、StarDict/MDX/ZIP 词典、浏览器 fetch receiver 兼容、取消/失败路径、AI 成功/401/429/500/畸形响应/取消/超时、模板变量、备份脱敏和离线扫描。

## 已知风险与剩余工作

- Bigme B7 Pro 真机验收未执行：见 `BIGME_B7_PRO_CHECKLIST.md` 的硬件待办；模拟器回归已单独记录在上节。
- 没有真实 Bigme key code 记录；设置页显示的是默认 Android 常见按键映射。
- PDF 文本层在打开阶段预取，用于全文搜索；大 PDF 的进一步优化可改为惰性文本索引。原版面模式只保留当前页 Canvas。
- MDX 加密/特殊压缩变体和非标准 MDD 资源需要更多真实词典样本。
- 需要发布时由产品/发布者提供 release keystore，并在不改 applicationId 的前提下签名。
