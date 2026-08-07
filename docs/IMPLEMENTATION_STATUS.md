# Android 墨水屏阅读器重构状态

更新时间：2026-08-03

## 总体状态

已完成当前环境可执行的 EPUB、FSRS 影子数据、Web 构建、自动化测试和 Android debug APK 构建。Bigme B7 Pro 真机未连接，因此硬件按键、墨水屏刷新观感和设备侧安装/升级仍标为待真机验证。

## 阶段记录

| 阶段 | 状态 | 结果 |
| --- | --- | --- |
| 基线审查 | 完成 | 检查 git status/diff、README、入口、解析器、Android MainActivity、存储/备份和全部既有测试；初始 `npm run test:all` 为 3 通过、2 失败。 |
| 本地状态与迁移 | 完成 | 新 IndexedDB schema version 3、迁移、事务接口、Keystore Key store、备份脱敏。 |
| ReaderEngine | 完成 | PDF/TXT/MD/HTML 保留既有引擎；EPUB 默认接入完整 `foliate-js` 固定提交，封装 `FoliateEpubEngine`/`ReaderEngineAdapter`，失败自动回退 `EpubEngine`。 |
| DictionaryProvider | 完成 | 内置词典、Indexed 本地词典、StarDict、MDX、应用 ZIP 导入和 HTML 清洗；索引与原文件写入本地 `dictionaryEntries`/`files`，启动时重建。 |
| 背词功能恢复 | 完成 | 统一旧版学习状态机、SRS 间隔、每日新词/复习计划、基础/造句/听音模式、错词本、已认识/待复习列表、AI 释义、造句/翻译挑战和学习统计；状态只走 `appState`。 |
| EPUB 定位与影子调度 | 完成 | 进度/书签/笔记增量写入 EPUB CFI locator，旧字段和备份格式保留；`ts-fsrs` 5.2.3 仅生成 `fsrsShadow`/`reviewHistory`，不参与正式队列。 |
| AI 与操作栏 | 完成 | 模板变量、自定义 action、主动点击触发、原生 HTTPS 桥、Android Keystore、非流式响应。 |
| 墨水屏与 Android | 完成 | Capacitor Android 工程、KeyEvents 调试页、实体键映射、Android 系统 TTS、无动画高对比样式、无存储权限。 |
| 测试与交付 | 完成 | `npm test`、构建、离线扫描、Capacitor 同步和 `assembleDebug` 成功；`test:all` 仅保留基线中的词汇队列日期断言失败。 |

## 关键决策

- 采用 Capacitor 7，保持 `com.kangkang.beidanci` applicationId；Web 资源由 Vite 打包进 APK。
- 旧 `app.js` 曾承载单体业务和云端状态。为避免迁移期出现两套业务状态，当前入口统一为 `src/main.js`，`app.js` 保留为无副作用的兼容说明文件；背词数据统一由 `src/core/learning.js` 和 `appState` 管理。
- Supabase 配置和 schema 已删除；Service Worker 只缓存本地 shell，外部请求不进入离线缓存。
- PDF 第一实现使用本地 `pdfjs-dist`，`PdfEngine` 作为替换边界；原版面 Canvas 不建立整本 PDF 的 Canvas 池。
- EPUB 使用完整 `vendor/foliate-js` 源码，固定提交 `df623dbe6610fd98a7c2d5d7a5c23bfcfc7d19f3`；挂载在现有 `#reader-content`，通过 `transformTarget` 阻止脚本/外部资源，并保留既有 `EpubEngine` fallback。Foliate 可选 PDF adapter 未启用。
- EPUB 新进度优先恢复有效 CFI，其次 href/fraction，再回退旧 chapter/page；`locator`、`cfi`、`href` 均为增量字段。
- FSRS 依赖为 `ts-fsrs` 5.2.3（固定提交 `0d72a487efbd1ee57bae9a6265cf413b20ae4338`）。`known` 使用影子 `Easy`，绝不写成 `Good`；正式 `status/srsLevel/nextReviewDate/队列/统计` 不读取影子结果。
- API Key 不提供 Web 存储降级。没有原生安全桥时只能保存 AI 非敏感配置，Key 需要在 APK 内重新录入。
- Android 朗读优先使用 `NativeTtsPlugin` 的系统离线 TTS，普通浏览器使用本地 `SpeechSynthesis`，不引入外部音频依赖。

## 测试结果

已通过：

- `npm test`
- `npm run test:all`：9 个测试文件、8 个通过、1 个失败；失败是基线已有的 `tests/vocab-learning.test.js` 日期/队列断言（实际 `gamma,alpha`，断言 `gamma,beta`），未为变绿修改产品逻辑或弱化断言。初始缺失 `fflate` 的 reader-dictionary 失败已随锁定依赖安装后消失。
- `npm run build`
- `npm run lint:offline`
- `npx cap sync android`
- `cd android && env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug`（JDK 21、Android 35；成功，生成 `android/app/build/outputs/apk/debug/app-debug.apk`）

测试覆盖迁移、schema 版本常量、学习状态/SRS/每日计划、背词 UI 功能入口、HTML 清洗、普通 EPUB3/NCX/损坏 OPF/图片样式/内部链接/脚注/RTL 竖排/固定版式/大型 EPUB 夹具、Foliate 正常路径/fallback/CFI/iframe 选词/监听器清理/目录/搜索/安全过滤、旧新 locator/书签/笔记/备份往返、PDF/TXT/MD/HTML 引擎合同、硬件键 reader-only 路由、StarDict/MDX/ZIP 词典、浏览器 fetch receiver 兼容、取消/失败路径、AI 成功/401/429/500/畸形响应/取消/超时、模板变量、备份脱敏和离线扫描。

## 已知风险与剩余工作

- 真机验收未执行，必须明确标记“未实机验证”：见 `BIGME_B7_PRO_CHECKLIST.md`。
- 没有真实 Bigme key code 记录；设置页显示的是默认 Android 常见按键映射。
- Node 测试使用 Foliate mock/fixture；尚未在真实 Capacitor WebView 中完成视觉分页、selection/CFI、RTL/竖排和固定版式的实机交互验收。
- PDF 文本层在打开阶段预取，用于全文搜索；大 PDF 的进一步优化可改为惰性文本索引。
- MDX 加密/特殊压缩变体和非标准 MDD 资源需要更多真实词典样本。
- 需要发布时由产品/发布者提供 release keystore，并在不改 applicationId 的前提下签名。
