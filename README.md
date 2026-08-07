# 康康背词器：Android 墨水屏本机版

这是一个离线优先的 Capacitor Android 应用，目标设备为 Bigme B7 Pro（Android 14、7 英寸电子墨水屏）。学习数据、书籍、阅读进度、笔记、书签、设置、词典索引和 AI 缓存保存在应用私有存储中；项目不再使用 Supabase Auth、Postgres、Realtime、远程词库或 CDN 才能启动。

## 环境

- Node.js 18+、npm
- JDK 21（Capacitor 7 的 Android 编译要求）
- Android SDK Platform 35 和 Build Tools 35
- Android Studio 可选；命令行构建不依赖 Android Studio

applicationId 保持为 `com.kangkang.beidanci`。升级安装需要使用同一签名；仓库没有提交任何 release keystore。

## 开发、测试和构建

```bash
npm install
npm run dev                 # Vite 本地预览
npm test                    # 原有回归入口
npm run test:all            # 全部 Node 测试
npm run lint:offline        # 运行时离线/远程依赖扫描
npm run build               # 生成 dist，并复制本地词典、图标和 Service Worker
npm run android:sync        # build + Capacitor sync
```

Android debug 构建：

```bash
cd android
./gradlew assembleDebug
```

本次构建得到的 APK：

`android/app/build/outputs/apk/debug/app-debug.apk`

APK 只使用 debug 签名，适合侧载和验收，不适合发布。侧载示例：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

正式发布时请在 Android Studio 或 Gradle 的 `signingConfigs.release` 中配置用户自己的签名证书；不要把 keystore、密码或 API Key 放进仓库。

## 本地数据和旧版本迁移

新数据库为 IndexedDB `kangkang-local-db`，schema version 3，包含状态、书籍、标注、词典、索引、原文件和 AI 缓存，并带版本升级路径。首次打开会迁移旧版 `localStorage` 状态、阅读设置/进度、释义缓存和旧 reader IndexedDB 书籍。

旧版 AI Key 只有在 Android Keystore 可用且写入成功后才会从旧存储移除；普通浏览器无法安全接管旧 Key，会显示需在 APK 中重新配置。新版本不把 Key 写入 localStorage、IndexedDB、日志或备份。

## 阅读器

- 一级格式：PDF、EPUB；同时支持 TXT、Markdown、HTML。
- EPUB：结构化章节、目录、搜索、HTML 清洗，以及基于实际 viewport、字体、字号、字重、字间距、行距、段距、首行缩进和四边页边距的 CSS 多列分页。
- PDF：原版面 Canvas 和文本重排两种模式；原版面支持缩放、旋转、对比度、裁白边入口、灰度和反色；有文本层时叠加可选择文字层，无文本扫描 PDF 会明确提示只能原版面阅读。页面文本按需读取，页对象和文本使用有上限的 LRU 缓存；搜索结果会定位到原版面页或重排页。
- 阅读页提供触屏上一页/下一页、左右点击区、可见设置入口和实体键路径；滚动/分页/章节位置、全书进度、书签和笔记写入本地书籍记录。阅读翻页不使用滑动动画或 smooth scroll。

书籍通过 `<input type=file>` 进入 WebView 系统文件选择器（Android 上由系统 SAF 处理），然后复制为应用私有数据；应用不申请全盘存储权限。

## 词典

内置 Collins 词典资源随 Web 包本地打包。词典页支持：

- StarDict：`.ifo`、`.idx`、`.dict`、`.dict.dz`，可用 ZIP 组合导入；支持 `idxoffsetbits=64`、`sametypesequence`，`.dict.dz` 首次使用后复用一次解压结果并带条目 LRU。
- MDX/MDD：只声明支持未加密、stored/zlib record-block 子集，MDD 图片/音频资源会在查询时转为本地 data URL；加密、LZO 或其他变体会明确拒绝。
- 应用自有 ZIP：包含 `manifest.json` 和 `entries.json`/`entries.jsonl`。不兼容的 MDX 可以用 `node scripts/convert-dictionary.js input.json output.zip` 转换；转换器接受 JSON 数组、键值对象或 JSONL，并按词头排序。

导入会建立本地索引，并把索引与原文件保存到应用私有目录，重启后自动重建；常规 StarDict 条目按文件切片读取，不扫描整本词典。导入支持取消、失败回滚、启停、精确查词和基础词形候选。外部词典 HTML 会清洗脚本、事件属性、iframe、外链和不允许的资源。

## 背词

- 统一的 SRS 学习状态、每日新词/复习计划、基础/造句/听音模式。
- 支持认识、不认识、纠正、完成复习、继续复习和词库重置；包含已认识列表、待复习列表、错词分组，以及从阅读选区加入错词本。
- 学习页显示本地 Collins 释义，未收录时可主动点击 AI 释义；造句批改、造句挑战和翻译挑战只在主动提交时请求 AI。
- Android APK 使用系统 TTS 朗读，浏览器使用本地 SpeechSynthesis，不依赖外部音频服务。
- 学习统计记录真实活跃分钟数（隐藏、空闲和挂起间隔不计）、互动次数、认识/复习数量、连续学习天数；首页恢复按月打卡日历，统计页支持 7/14/30/自定义趋势以及阅读/背词分项。

## AI 配置

在 APK 设置中填写自定义 OpenAI-compatible HTTPS Base URL、模型、提示词和 API Key。默认请求 `stream:false`，只有用户点选“AI 解释”“AI 翻译”或自定义操作才发送选中文本；自定义操作支持 `{{selection}}`、`{{sentence}}`、`{{paragraph}}`、`{{chapterTitle}}`、`{{bookTitle}}`、`{{sourceLanguage}}`、`{{targetLanguage}}`。

AI Key 由原生 `SecureStorage` 插件写入 Android Keystore，网络由原生 `NativeAi` HTTPS 桥发送以避开 WebView CORS。飞行模式下背词、SRS、阅读、词典、笔记、书签和备份仍可用，AI 会给出离线错误而不自动重试。

## 备份和恢复

普通 ZIP（数据备份）包括学习状态、设置、书籍元数据/进度/批注、词典配置/索引、自定义 AI action 和 AI 缓存，但不包括书籍正文/原文件；恢复时不会用空 blob 覆盖本机已有书籍文件。勾选“完整 ZIP”后才包含书籍和词典原文件，并保留词典文件的 `dictionaryId`/`role` 关联。恢复前会校验格式、版本和敏感字段，按 ID 合并、冲突失败回滚；不会覆盖 Keystore 中的 API Key。

## 墨水屏和实体键

应用提供极速/均衡/质量三档重绘配置：分别使用不同的防抖、预取、局部/整屏刷新周期；禁用动画、渐变、毛玻璃、大阴影和 smooth scroll。只有阅读页拦截已映射的实体键，其他页面不劫持系统音量。设置页可捕获真实 Android key code、写入下一页/上一页/菜单/返回映射并持久化回显。

## 已知限制

- 当前没有连接 Bigme 真机；实体键实际 key code、灰度/刷新观感、文件选择器、沉浸状态和 Keystore 需要在设备上完成验收，软件路径已有自动化/浏览器验收。
- PDF 使用本地 `pdfjs-dist`，`PdfEngine` 只在打开时探测第一页；全文搜索/重排会按页读取，Canvas、页对象和文本缓存均有上限。
- MDX/MDD 的支持范围已明确收窄为文档所述子集；不兼容格式有可执行 JSON/JSONL → 应用 ZIP 转换流程，不伪装成通用 MDX 兼容。
- 当前没有 release 签名 APK，也没有伪造 release keystore。

详细阶段记录见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)，依赖许可证见 [`docs/THIRD_PARTY_LICENSES.md`](docs/THIRD_PARTY_LICENSES.md)，真机清单见 [`docs/BIGME_B7_PRO_CHECKLIST.md`](docs/BIGME_B7_PRO_CHECKLIST.md)。
