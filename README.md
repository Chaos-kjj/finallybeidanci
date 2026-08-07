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
npm run test:all            # 全部 Node 测试，不检查 APK
npm test                    # 全部 Node 测试，并拒绝过期 APK
npm run lint:offline        # 运行时离线/远程依赖扫描
npm run build:web           # 仅生成 Web 预览，不算完成 Android 交付
npm run build               # 完整测试、同步、构建并校验最新 debug APK
npm run android:install     # 仅从主工作区安装并核验模拟器中的 APK
npm run deliver             # 完整构建 + 受保护安装
```

`npm run build` 是唯一的 APK 交付命令，会依次运行全部测试、离线扫描、Vite 构建、Capacitor 同步、Gradle `assembleDebug` 和 APK 新鲜度校验。JDK 与 Android SDK 可通过 `JAVA_HOME`、`ANDROID_HOME` 指定；在 Homebrew 的常见安装位置也会自动发现。

每次修改任意工作区文件后都必须重新运行 `npm run build`。构建会把整个工作区的 SHA-256 源码指纹写入 `dist/build-info.json`、Android 资源和 APK；校验器还会逐文件比较 `dist`、Android 资源与 APK 内容。旧 APK、漏同步资源或只修改源码未重打包都会让 `npm test` / `npm run verify:apk` 失败。

如需在成功构建后打开 Android Studio：

```bash
npm run android:debug
```

本次构建得到的 APK：

`android/app/build/outputs/apk/debug/app-debug.apk`

APK 只使用 debug 签名，适合侧载和验收，不适合发布。构建成功后必须使用受保护安装命令：

```bash
npm run android:install
```

安装器只接受 Git 的主工作区，拒绝临时 worktree；它不会使用 Android 降级参数，安装后还会核对版本号、模拟器内 APK 的 SHA-256 和源码构建指纹。设置页会显示同一构建身份。每个可见版本必须提升 Android `versionCode`，因此旧 APK 无法再通过普通更新覆盖当前包。

正式发布时请在 Android Studio 或 Gradle 的 `signingConfigs.release` 中配置用户自己的签名证书；不要把 keystore、密码或 API Key 放进仓库。

## 本地数据和旧版本迁移

新数据库为 IndexedDB `kangkang-local-db`，schema version 6，包含状态、书籍、标注、词典、索引、原文件和 AI 缓存，并带有明确的 4→5→6 单调升级路径。首次打开会迁移旧版 `localStorage` 状态、阅读设置/进度、释义缓存和旧 reader IndexedDB 书籍；如果发现更高版本数据库，应用不会降级或删除数据，会给出升级提示。

旧版 AI Key 只有在 Android Keystore 可用且写入成功后才会从旧存储移除；普通浏览器无法安全接管旧 Key，会显示需在 APK 中重新配置。新版本不把 Key 写入 localStorage、IndexedDB、日志或备份。

## 阅读器

- 一级格式：PDF、EPUB；同时支持 TXT、Markdown、HTML。
- EPUB：结构化章节、目录、搜索、HTML 清洗，以及基于实际 viewport、字体、字号、字重、字间距、行距、段距、首行缩进和四边页边距的 CSS 多列分页。
- PDF：原版面 Canvas 和文本重排两种模式；原版面支持缩放、旋转、对比度、裁白边入口、灰度和反色；有文本层时可搜索和选择，无文本扫描 PDF 会明确提示只能原版面阅读。
- 阅读进度、书签和笔记写入本地书籍记录。阅读翻页不使用滑动动画或 smooth scroll。

书籍通过 `<input type=file>` 进入 WebView 系统文件选择器（Android 上由系统 SAF 处理），然后复制为应用私有数据；应用不申请全盘存储权限。

## 词典

内置 Collins 词典资源随 Web 包本地打包。词典页支持：

- StarDict：`.ifo`、`.idx`、`.dict`、`.dict.dz`，可用 ZIP 组合导入。
- MDX/MDD：`.mdx` 和可选资源 `.mdd`。
- 应用自有 ZIP：包含 manifest 和 JSON/JSONL entries。

导入会建立本地索引，并把索引与原文件保存到应用私有目录，重启后自动重建；常规 StarDict 条目按文件切片读取，不扫描整本词典。导入支持取消、失败回滚、启停、精确查词和基础词形候选。外部词典 HTML 会清洗脚本、事件属性、iframe、外链和不允许的资源。

## 背词

- 统一的 SRS 学习状态、每日新词/复习计划、基础/造句/听音模式。
- 支持认识、不认识、纠正、完成复习、继续复习和词库重置；包含已认识列表、待复习列表、错词分组，以及从阅读选区加入错词本。
- 学习页显示本地 Collins 释义，未收录时可主动点击 AI 释义；造句批改、造句挑战和翻译挑战只在主动提交时请求 AI。
- Android APK 使用系统 TTS 朗读，浏览器使用本地 SpeechSynthesis，不依赖外部音频服务。
- 学习统计记录分钟数、互动次数、认识/复习数量、连续学习天数和最近 14 天活动。

## AI 配置

在 APK 设置中填写自定义 OpenAI-compatible HTTPS Base URL、模型、提示词和 API Key。默认 Base URL 为 `https://tokenrhythm.studio/v1/chat/completions`，模型预设为 `deepseek-v4-flash-0731`；请求 `stream:false`，429 会指数退避并加入随机抖动，只有用户点选“AI 解释”“AI 翻译”或自定义操作才发送选中文本。自定义操作支持 `{{selection}}`、`{{sentence}}`、`{{paragraph}}`、`{{chapterTitle}}`、`{{bookTitle}}`、`{{sourceLanguage}}`、`{{targetLanguage}}`。

AI Key 由原生 `SecureStorage` 插件写入 Android Keystore，网络由原生 `NativeAi` HTTPS 桥发送以避开 WebView CORS。飞行模式下背词、SRS、阅读、词典、笔记、书签和备份仍可用，AI 会给出离线错误而不自动重试。

## 备份和恢复

普通 ZIP 备份包括学习状态、设置、书籍元数据、书签/笔记、词典配置/索引和自定义 AI action，但不包括 API Key、AI 缓存和书籍正文/原文件。勾选“完整 ZIP”后才包含书籍、词典源文件和自定义字体。备份格式 v2 保留 dictionaryId/role 关联；旧 v1 可安全读取。恢复前会校验并预演，自动保存恢复前安全快照，随后以覆盖或合并模式原子应用；恢复不会覆盖 Keystore 中的 API Key。

## 墨水屏和实体键

应用提供极速/均衡/质量三档重绘配置，禁用动画、渐变、毛玻璃、大阴影和 smooth scroll；阅读页拦截实体音量键、翻页键和方向键，其他页面不劫持系统音量。设置页记录真实 Android key code，方便在 Bigme 上调整下一页/上一页/菜单映射。

## 已知限制

- 当前没有连接 Bigme 真机；实体键、灰度/刷新观感、文件选择器和 Keystore 需要在设备上完成验收。
- PDF 使用 pdf.js 的本地打包实现，接口已抽象为 `PdfEngine`，未来可替换原生 PDFium/MuPDF。当前打开 PDF 会预取文本层用于全文搜索；Canvas 只保留当前渲染页。
- StarDict `.dict.dz`、MDX/MDD 的常见导入路径已覆盖；加密 MDX、特殊压缩变体和极少数非标准资源仍需用真实词典样本补测。
- 当前没有 release 签名 APK，也没有伪造 release keystore。

详细阶段记录见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)，依赖许可证见 [`docs/THIRD_PARTY_LICENSES.md`](docs/THIRD_PARTY_LICENSES.md)，真机清单见 [`docs/BIGME_B7_PRO_CHECKLIST.md`](docs/BIGME_B7_PRO_CHECKLIST.md)。

本次整改与验收方案见 [`docs/DELIVERY_ACCEPTANCE_2026-08-05.md`](docs/DELIVERY_ACCEPTANCE_2026-08-05.md)。当前 canonical debug APK 已通过自动化构建和模拟器安装；Bigme B7 Pro 真机、特殊词典样本和 release keystore 仍是正式发布前的外部验收条件。
