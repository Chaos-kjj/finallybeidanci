# Android 墨水屏阅读器重构状态

更新时间：2026-08-05

## 总体状态

五阶段交付整改已完成代码和自动化门禁。当前 canonical debug APK 已通过构建、freshness 校验和受保护安装，版本为 `1.1.1` / Android `versionCode 4`，设备为 `emulator-5554`。Bigme B7 Pro 真机未连接，因此实体键真实 key code、墨水屏刷新观感、SAF 文件选择和续航仍不能标记为通过。

本次完整报告见 [DELIVERY_ACCEPTANCE_2026-08-05.md](./DELIVERY_ACCEPTANCE_2026-08-05.md)。2026-08-04 报告是历史记录，不替代本次证据。数据库当前版本为 v6，备份协议为 v2，新备份包含 SHA-256 完整性摘要。

## 阶段记录

| 阶段 | 状态 | 结果 |
| --- | --- | --- |
| 基线审查 | 完成 | 核对 canonical worktree、入口、解析器、清洗器、测试、配置和交付脚本；保留既有工作区变更。 |
| 本地状态与迁移 | 完成 | IndexedDB schema version 6、显式 v4→v5→v6 迁移、阅读进度 v2 迁移、事务接口、Keystore Key store、备份脱敏与恢复完整性校验。 |
| ReaderEngine | 完成 | `TextEngine`、`EpubEngine`、`PdfEngine`、结构化 EPUB 章节/目录、viewport CSS 分页、PDF 原版面/文本重排。 |
| DictionaryProvider | 完成 | 内置词典、Indexed 本地词典、StarDict、MDX、应用 ZIP 导入和 HTML 清洗；索引与原文件写入本地 `dictionaryEntries`/`files`，启动时重建。 |
| 背词功能恢复 | 完成 | 统一旧版学习状态机、SRS 间隔、每日新词/复习计划、基础/造句/听音模式、错词本、已认识/待复习列表、AI 释义、造句/翻译挑战和学习统计；状态只走 `appState`。 |
| AI 与操作栏 | 完成 | Token Rhythm / `deepseek-v4-flash-0731` 默认配置、模板变量、自定义 action、主动点击触发、原生 HTTPS 桥、Android Keystore、非流式响应、退避重试、可配置超时和推理截断识别。 |
| 墨水屏与 Android | 完成 | Capacitor Android 工程、KeyEvents 调试页、实体键映射、Android 系统 TTS、无动画高对比样式、无存储权限。 |
| 测试与交付 | 完成 | 默认 `npm run build` 执行 9 个测试文件、离线扫描、Vite/Capacitor 同步、`assembleDebug` 和 APK 源码指纹/逐文件新鲜度校验；canonical APK 已由 `npm run android:install` 安装到 `emulator-5554`。 |

## 关键决策

- 采用 Capacitor 7，保持 `com.kangkang.beidanci` applicationId；Web 资源由 Vite 打包进 APK。
- 旧 `app.js` 曾承载单体业务和云端状态。为避免迁移期出现两套业务状态，当前入口统一为 `src/main.js`，`app.js` 保留为无副作用的兼容说明文件；背词数据统一由 `src/core/learning.js` 和 `appState` 管理。
- Supabase 配置和 schema 已删除；Web 版 Service Worker 按每次构建的源码指纹隔离缓存并对页面使用网络优先策略，Android 原生包启动后注销 Service Worker，避免覆盖安装继续显示旧页面。
- PDF 第一实现使用本地 `pdfjs-dist`，`PdfEngine` 作为替换边界；原版面 Canvas 不建立整本 PDF 的 Canvas 池。
- API Key 不提供 Web 存储降级。没有原生安全桥时只能保存 AI 非敏感配置，Key 需要在 APK 内重新录入。
- Android 朗读优先使用 `NativeTtsPlugin` 的系统离线 TTS，普通浏览器使用本地 `SpeechSynthesis`，不引入外部音频依赖。

## 自动化测试结果

已通过：

- `npm run test:all`：9 个测试文件、9 个通过、0 个失败。
- `npm run lint:offline`：运行时离线扫描通过。
- `npm run build`：包含 Web 构建、Capacitor 同步、JDK 21 / Android 35 `assembleDebug` 和最终 APK 校验。
- `npm run verify:apk`：源码指纹一致，`dist`、Android assets 和 APK 逐文件一致，且 APK 内存在书架/设置/造句/翻译挑战入口。
- `npm run android:install`：canonical 工作区安装并核对版本、APK SHA-256 和 source fingerprint。

构建指纹、时间和 APK 路径以最后一次 `npm run build` 输出及 `dist/build-info.json` 为准；文档或测试改动后必须重新 build。

## 本次真实路径验收（2026-08-05）

- Computer Use 在本地 Web 页面验证：首页、背词、内置 Collins 查词、阅读空书架、系统文件选择器打开/取消、设置高级区和开发/生产构建身份提示。
- canonical `npm run android:install` 成功后启动 `com.kangkang.beidanci/.MainActivity`，并截取 `emulator-5554` 首页截图；安装器已核对版本、APK SHA-256 和 source fingerprint。
- 2026-08-04 的真实 EPUB/PDF、备份和模拟器回归仍保留为历史证据，但不把它们写成 2026-08-05 本次重新执行的结果。

测试覆盖迁移、schema 版本常量、学习状态/SRS/每日计划、背词 UI 功能入口、APK 交付门禁、HTML 清洗、EPUB 章节/目录/搜索/分页、StarDict/MDX/ZIP 词典、浏览器 fetch receiver 兼容、取消/失败路径、AI 成功/401/429/500/畸形响应/取消/超时、模板变量、备份脱敏和离线扫描。

## 已知风险与剩余工作

- Bigme B7 Pro 真机验收未执行：见 `BIGME_B7_PRO_CHECKLIST.md` 的硬件待办；不能用模拟器代替实体键和墨水刷新验收。
- 没有真实 Bigme key code 记录；设置页显示的是默认 Android 常见按键映射。
- PDF 文本重排会形成当前文档连续文本；大 PDF 的进一步优化可改为按页惰性索引。原版面模式只保留受限邻近页 Canvas。
- 当前词典主索引仍使用 IndexedDB/provider 重建，不是 SQLite/Room/FTS；超过百万条或极大词典需要单独性能评估。
- Vite 对 PDF worker 和主 bundle 有大 chunk 警告；后续可按格式动态分包。
- Android 导出已限制大小并使用临时文件/SAF，但 JS 入口仍先产生 Base64，超大备份的内存峰值需后续原生分块优化。
- MDX 加密/特殊压缩变体和非标准 MDD 资源需要更多真实词典样本。
- 需要发布时由产品/发布者提供 release keystore，并在不改 applicationId 的前提下签名。
