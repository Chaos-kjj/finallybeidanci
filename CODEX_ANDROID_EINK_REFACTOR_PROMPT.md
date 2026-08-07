# 可直接粘贴给新 Codex 对话的主提示词

请把下面代码块中的全部内容复制到一个以本项目目录为工作区的新 Codex 对话中。

```text
你是这个项目的主实现工程师。请在当前仓库中完成 Android 墨水屏阅读器重构，不要只输出建议或停留在方案阶段；你需要实际修改代码、添加测试、构建 APK，并持续工作到环境内能够完成的验收项全部完成。

项目路径应为：/Users/kang/Documents/finallybeidanci

开始前必须完整阅读仓库根目录：
1. ANDROID_EINK_READER_REFACTOR_SPEC.md
2. README.md
3. package.json
4. index.html
5. app.js
6. sw.js
7. reader-epub-parser.js
8. reader-text-cleaner.js
9. tests/regression.test.js
10. supabase-schema.sql 和 Supabase 相关配置，以便安全移除云端依赖

ANDROID_EINK_READER_REFACTOR_SPEC.md 是本任务的产品需求、架构边界和验收标准。除非代码事实证明某条要求在目标平台上不可实现，否则必须按它执行；如果必须调整实现方式，应保持用户体验和验收结果等价，并在文档中说明原因。

核心目标：

- 把当前 PWA 做成可侧载安装到 Bigme B7 Pro（Android 14、7 英寸电子墨水屏）的本地 APK。
- 默认完全本地保存学习记录、书籍、阅读进度、笔记、书签、设置、词典和 AI 缓存。
- 删除 Supabase 登录、注册、云同步和 Realtime；不得依赖远程网站或 CDN 才能启动或阅读。
- 保留现有背词、SRS、错词本、学习统计、内置 Collins 词典、阅读笔记等主要功能，先做回归保护，不能因重构丢功能。
- 阅读器以 PDF、EPUB 为一级格式，并保留 TXT、Markdown、HTML。
- 新增用户本地词典导入与管理，目标支持 StarDict、MDX/MDD 和应用自有 ZIP 词典包；大型词典必须建立本地索引，不能整体载入内存。
- EPUB 使用结构化章节、目录和真正按 viewport 的可重排分页，支持字体、字号、字重、字间距、行间距、段间距、首行缩进和四边页边距。
- PDF 提供原版面与文本重排两种模式。原版面支持缩放、适宽、旋转、裁白边、对比度、文本层选择；字体和行距只在文本重排模式生效，不能提供假设置。
- 长按文本后显示可配置操作条，默认包含“查词”“AI 解释”“AI 翻译”“复制”“做笔记”。
- DeepSeek 使用用户自定义 OpenAI-compatible Base URL、模型和提示词。解释、翻译以及用户新增 action 都支持模板变量。只有用户点击或明确开启自动执行时才发送文本。
- DeepSeek API Key 必须存 Android Keystore，禁止存 localStorage、普通 SQLite、日志和备份。
- AI 请求走原生安全网络桥，解决 WebView CORS；除主动 AI 请求外，飞行模式核心功能必须全部可用。
- 做完整墨水屏优化：纯色高对比主题、无动画、无毛玻璃、无渐变大阴影、无 smooth scroll、翻页不做滑动动画、重绘节流、PDF 限制可见 Canvas、AI 非逐字刷新。
- 支持实体翻页键/音量键映射，并提供显示真实 Android key code 的调试页，以便适配 Bigme。
- 加入本地备份/恢复，普通备份不包含 API Key；支持可选的包含书籍和词典原文件的完整 ZIP 备份。

技术方向：

- 推荐 Capacitor Android；所有 Web 资源和 PDF/EPUB 库随 APK 打包。
- 采用渐进式重构，不要一次性推倒 224KB 的 app.js。先封装当前应用并建立回归基线，再逐步拆出 reader、dictionary、ai、storage、eink 模块。
- 可以引入 Vite + TypeScript，但必须始终保持可运行、可测试的迁移状态，不允许同时维护互相冲突的两套业务状态。
- 建立统一 ReaderEngine 接口，至少实现 EpubEngine、PdfEngine、TextEngine。
- 建立统一 DictionaryProvider 接口，至少实现 BuiltinDictionaryProvider、StarDictProvider、MdxProvider。
- EPUB 渲染库和 PDF 渲染库必须本地打包，选择前检查许可证、维护状态、Android WebView 兼容性和文本选择能力。PDF 第一实现可使用 pdfjs-dist，但接口必须允许以后替换成原生 PDFium/MuPDF。
- 使用 Storage Access Framework 导入/导出，并把原文件复制进应用私有目录。不要申请不必要的全盘存储权限。
- 新数据库必须有 schema version、事务和 migration 测试；应用升级保持稳定 applicationId 和签名兼容。
- 导入的 EPUB/词典 HTML 是不可信输入，必须禁脚本、清洗 HTML、限制本地资源 MIME 和大小、阻止任意外网加载。

工作方式：

1. 先执行只读检查：git status、目录结构、依赖、现有测试、外部 URL、所有 localStorage/IndexedDB/Cache/Supabase 代码。保护用户已有改动，不覆盖无关文件。
2. 建立明确的分阶段 plan/TODO，并在 docs/IMPLEMENTATION_STATUS.md 记录每阶段状态、决策、测试和剩余风险。
3. 先运行 npm test 并记录基线。为现有主要业务补必要回归测试后再拆代码。
4. 如果当前不是隔离工作树且适合创建分支，使用 codex/android-eink-reader；不要自行提交、推送或创建 PR，除非用户另行要求。
5. 按规格书第 10 节顺序实施，每阶段完成后运行对应测试，确认应用仍可启动，再进入下一阶段。
6. 对依赖安装、Android SDK、Gradle 或网络权限等可恢复问题，先检查本机现状，再使用最小必要操作解决；不要因为缺少一个可选工具就停止整个任务。
7. 若没有 Bigme 真机连接，仍需完成 web 测试、Android 构建和模拟器/静态验证，但必须把真机项目标为“待真机验证”，不得写成已通过。
8. 除真正需要用户密钥、签名证书或不可逆产品选择外，不要中途反复提问；使用规格书中的默认值继续推进。
9. 不要在日志或聊天回复中打印任何 API Key、Authorization header 或用户书籍正文。
10. 所有代码修改后必须检查 git diff，确认无临时文件、下载产物、密钥或大型测试书籍被误加入仓库。

必须覆盖的测试：

- 原有 npm test 全部通过。
- 旧 localStorage/IndexedDB 数据迁移。
- EPUB 目录、章节、真实分页、字体和全部排版设置、选择、书签、笔记、进度恢复。
- PDF 原版面、文本层选择、文本重排、裁边、搜索、无文本扫描 PDF 的明确降级。
- StarDict 和 MDX/MDD 导入、取消、失败回滚、排序、启停、精确/词形查词、HTML 清洗。
- DeepSeek mock 请求：成功、401、429、500、超时、取消、离线、畸形响应；验证 Key 不进入 web storage/日志/备份。
- 自定义 AI action 和模板变量替换，长按操作条在 EPUB/PDF 文本层中工作。
- 备份/恢复及完整性校验。
- 无网络冷启动和核心功能。
- Android assembleDebug；如果没有用户 release keystore，不要伪造或覆盖 keystore，交付 debug APK 并说明 release 签名步骤。
- 搜索代码确认无强制 Supabase、远程词库和 CDN 运行依赖。

性能与墨水屏验收：

- 禁用所有阅读翻页动画和 smooth scroll。
- 翻页只更新必要正文和页码，不重建整个应用 shell。
- EPUB 禁止固定字符数分页，必须依据 viewport/排版计算。
- PDF 只保留当前页和有限邻近页 Canvas，释放不可见资源。
- 字号/行距/页边距滑块要节流，松手后提交最终重排。
- AI 流式响应默认关闭；如保留，至少 700ms 合并一次 UI 更新。
- 阅读界面拦截实体翻页键，其他界面不劫持系统音量。
- 真机指标和未验证项必须如实记录。

交付物：

- 完整源码和 Android 工程。
- 可安装的 debug APK 的绝对路径；如果成功构建 release APK，也一并给出。
- 更新后的 README：环境、安装、开发、测试、构建、侧载、升级、备份恢复、API 配置、词典格式和已知限制。
- docs/IMPLEMENTATION_STATUS.md。
- 第三方依赖与许可证清单。
- Bigme B7 Pro 真机验收清单；如果连接真机，则附实际结果和 key code。
- 最终回复按“已完成、测试结果、APK 路径、仍需真机验证、已知限制”汇报，不能只罗列改动文件。

完成标准以 ANDROID_EINK_READER_REFACTOR_SPEC.md 第 11 节为准。请现在开始审查、规划并实施，不要只回复一份新计划。
```

## 建议的新对话使用方式

1. 在 Codex 中打开 `/Users/kang/Documents/finallybeidanci` 作为工作区。
2. 新建对话后粘贴上面完整提示词。
3. 给该对话正常的工作区写入权限；安装依赖或下载 Android 组件时按需批准网络操作。
4. 让该任务持续执行，不要在它刚输出第一版计划时另开重复任务。
5. 如果有 Bigme B7 Pro 数据线，打开开发者选项和 USB 调试后连接电脑；Codex 可以在后期通过 `adb devices` 检测，但不要把未知电脑永久授权留在设备上。

