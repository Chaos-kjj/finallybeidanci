# 康康背词器产品交付整改与验收方案书

日期：2026-08-05  
工作区：`/Users/kang/Documents/finallybeidanci`  
分支：`codex/delivery-remediation`  
验收原则：只记录本次可复现证据；2026-08-04 的历史模拟器报告不替代本次构建和安装结果。

## 1. 结论

本轮五阶段整改已完成代码、数据、离线、安全、阅读器、词典、备份、Android 交付链路和自动化回归；产品目前达到“可安装的交付候选”状态：

- `npm run test:all` 覆盖 9 个测试文件，目标为 9/9 通过。
- `npm run lint:offline` 必须通过，运行时禁止 Supabase、CDN 和远程词典依赖。
- `npm run build` 是唯一交付证据，包含测试、离线扫描、Vite 构建、Capacitor 同步、Android APK 组装和 freshness verifier。
- `npm run android:install` 已在 canonical 工作区成功安装并核对 `emulator-5554` 的版本、APK SHA-256 和源码指纹；每次后续源码/文档修改后仍需重新 build/install。
- Computer Use 已验收本地真实路径：首页、背词、本地 Collins 查词、阅读空书架、系统文件选择器打开/取消、设置高级区和构建身份展示。
- Bigme B7 Pro 真机、墨水屏刷新观感、实体键真实 key code、正式 release 签名仍未验证，因此当前不能把 debug APK 宣称为最终商业发布包。

整体健康度：**条件性良好（可交付候选，真机与正式签名仍是发布门禁）**。核心功能、数据安全和构建可重复性已达到候选完成品标准；剩余问题主要集中在硬件证据、超大文件性能、长期维护性和少数格式兼容边界。

## 2. 五阶段执行记录

### 阶段一：基线、版本与交付边界

已完成：

- 确认第一条 `git worktree list --porcelain` 记录的主工作区为 canonical 工作区。
- 创建整改分支 `codex/delivery-remediation`，保留既有工作区变更，不进行破坏性回滚。
- 统一 `package.json`、`package-lock.json`、Android `versionName` 为 `1.1.1`，Android `versionCode` 提升为 `4`。
- 把构建指纹、产品契约、版本号和交付渠道写入 `build-info.json`，由 `scripts/verify-apk.js` 对 `dist`、Android assets 和 APK 逐文件校验。
- 清理并隔离旧云端入口：运行时离线扫描覆盖 JS、HTML、Java 和静态配置。

依据：`scripts/release-context.js`、`scripts/build-fingerprint.js`、`scripts/stamp-build.js`、`scripts/verify-apk.js:45-103`、`scripts/check-offline.js:15-25`。

### 阶段二：P0/P1 交付阻断修复

已完成：

- IndexedDB schema 升到 v6，显式处理 v4→v5→v6 迁移；高版本数据库不会被降级覆盖。
- 书籍、标注、词典条目、词典源文件和 AI 缓存建立明确的数据边界；删除书籍会同步清理标注与具有关联的 AI 缓存。
- 普通备份不含 API Key、AI 缓存和书籍正文；完整备份才包含原文件；恢复前预演、覆盖前安全快照、完整性校验和原子写入均已落地。
- 书籍/词典导入在解析、大小、条目数和取消检查通过后才提交，避免损坏文件或半成品进入库。
- Android AI 网络桥限制 HTTPS、请求/响应大小、重定向和取消竞态；Keystore 写入失败不会静默降级到普通存储。
- 原生 TTS、导出、按键、沉浸式窗口和系统返回均有边界处理。

关键位置：`src/storage/local-store.js:11-289`、`src/storage/backup.js:1-255`、`src/main.js:1306-1375`、`src/main.js:1653-1710`、`android/app/src/main/java/com/kangkang/beidanci/NativeAiPlugin.java:26-134`、`android/app/src/main/java/com/kangkang/beidanci/DocumentExportPlugin.java:24-95`。

### 阶段三：阅读器、词典、备份和性能收敛

已完成：

- EPUB 改为 spine 描述符加按章节加载，清洗外链、脚本、事件属性和危险协议，并增加源文件、解压总量、条目、章节、资源和封面上限。
- PDF 使用本地 worker 优先、主线程回退；文本缓存和页面缓存有上限，原版面模式不建立整本 Canvas 池；连续模式只渲染受限邻近页。
- 阅读进度按格式保留章节、页码、滚动 progression、PDF 页和 EPUB href；书签/笔记写入流相关位置。
- StarDict、MDX/MDD 和应用 ZIP 词典统一走 provider/repository 边界，资源按需读取并限制单资源大小。
- 导入过程提供取消、进度和 UI yield；大备份改为 Android 临时文件再通过 SAF 复制，减少 Binder 单次传输风险。

关键位置：`reader-epub-parser.js:14-306`、`src/reader/reader-engine.js:69-343`、`src/dictionary/import-service.js:6-150`、`src/dictionary/stardict-provider.js`、`src/dictionary/mdx-provider.js`、`src/main.js:1720-1900`。

### 阶段四：自动化、离线与安全门禁

验收命令：

```text
npm run test:all
npm run lint:offline
npm run build
npm run android:install
```

必须满足：9 个测试文件全部通过；offline scan 通过；APK 为 canonical 工作区最新构建；版本号、产品契约、资源逐文件摘要和 APK 指纹全部一致。最终指纹与构建时间以最后一次 `npm run build` 的终端输出和 `dist/build-info.json` 为准。

### 阶段五：真实用户路径与设备验收

Computer Use 本地 Web 路径已执行：

1. 首页：显示“离线可用 · 本机数据”、本机学习概览和快速入口。
2. 背词：进入学习页，显示 `ability`，点击“显示答案”后加载内置 Collins 释义。
3. 词典：进入词典管理，输入 `ability` 并查询，显示“ability · 内置 Collins”；导入文件选择器可打开，取消后回到页面且无残留文件。
4. 阅读：进入空书架，显示“书架还是空的”，导入入口可打开系统选择器并安全取消。
5. 设置：AI、备份、实体按键、高级设备调试、字体和版本信息均可见；开发服务器无构建元数据时显示明确的开发预览提示，生产构建读取版本/指纹。

canonical Android 安装后已启动 `com.kangkang.beidanci/.MainActivity` 并截取首页截图；安装器已完成版本、APK SHA-256 和源码指纹核对。`emulator-5554` 是本次软件验收设备，不代表 Bigme 真机。

## 3. 架构问题清单与处理判定

| 编号 | 问题/证据 | 影响 | 判定 | 当前处理 |
| --- | --- | --- | --- | --- |
| A-01 | 入口装配仍集中在 `src/main.js`，文件承担页面、导入、阅读、备份和设置事件绑定。 | 修改容易产生跨域回归，维护成本高。 | 局部重构 | 已抽出 reader/dictionary/vocab/storage/ui 边界；剩余页面装配列为后续拆分，不阻塞当前交付。 |
| A-02 | 当前本地数据主存储为 IndexedDB，词典启动时仍需重建 provider；没有 SQLite/Room/FTS。 | 超大词典启动、全文查词和内存上限不如原生索引。 | 必要重构（后续版本） | 当前规模用条目上限、provider LRU 和事务保护；若目标词典超过百万条，迁移到 SQLite/Room + FTS。 |
| A-03 | PDF.js worker 与主 bundle 体积较大，构建有 chunk >500 kB 警告。 | 冷启动和 APK 首次加载成本增加。 | 局部重构 | 当前功能与离线性优先；后续按格式动态 import PDF/EPUB 模块。 |
| A-04 | PDF 文本重排最终仍会形成当前文档的连续文本；全文索引不是持久化惰性索引。 | 超大 PDF 可能占用较多内存。 | 最小修复/后续优化 | 页面缓存已限额；后续按页建立持久索引并限制重排拼接。 |
| A-05 | Android 导出桥的 JS 接口仍接收 Base64，再写入临时文件。 | 大备份会产生 JS 内存峰值。 | 局部重构 | 已限制 512 MB 并避免 TransactionTooLarge；后续可改为原生分块/流式接口。 |
| A-06 | Gradle 仍有 `flatDir` 警告，构建日志有 SDK XML/deprecated API 提示。 | 不直接影响当前 debug 构建，但会增加升级风险。 | 无需修改（当前）/后续清理 | 记录为依赖升级任务，不改变本轮功能。 |

## 4. 功能、安全和数据问题清单

| 编号 | 位置 | 根因/风险 | 推荐处理 | 状态 |
| --- | --- | --- | --- | --- |
| F-01 | `src/main.js:1306-1375` | 导入若先写元数据再解析，会留下损坏书籍或覆盖当前阅读上下文。 | 最小范围修复：先读取/解析/校验，最后一次写入。 | 已完成并有回归测试。 |
| F-02 | `reader-epub-parser.js:14-306` | EPUB 解压炸弹、超大资源和外链 HTML 可能造成内存或安全风险。 | 必要安全修复：上限、边界检查和属性级 URL 清洗。 | 已完成。 |
| F-03 | `src/storage/local-store.js:162-222` | 覆盖恢复未清除旧 AI 缓存/旧元数据会产生串库。 | 最小范围修复：事务内清理并按模式重建。 | 已完成并有测试。 |
| F-04 | `src/ai/ai-client.js`、`NativeAiPlugin.java` | 缓存键未区分书籍或请求边界不受限可能导致串文、超大请求和重试失控。 | 最小范围修复：缓存键加入 bookId/配置，设置 token/请求/响应上限。 | 已完成并有测试。 |
| F-05 | `src/main.js:2026-2051` | Safari 对无效构建元数据响应/本地时间格式化会抛异常。 | 最小范围修复：校验 JSON content-type，时间格式化失败回退 ISO，本地预览显示明确提示。 | 已完成；需由最终 build 重新验证。 |
| F-06 | `src/dictionary/import-service.js`、各 provider | 大词典、MDX/MDD 特殊压缩或加密变体样本不足。 | 无需修改现有路径；补充真实样本后再决定兼容性改动。 | 常见格式已覆盖，特殊样本待补。 |
| F-07 | Android 真机 | 没有 Bigme B7 Pro 的真实按键码、墨水刷新和文件选择器证据。 | 必要验收：连接真机后按清单执行；不应通过模拟器结果替代。 | 未完成，发布阻断。 |
| F-08 | Android release | 仓库没有 release keystore，当前 APK 为 debug 签名。 | 无需修改代码；由发布者提供签名和发布配置，重新 build/安装验收。 | 未完成，正式发布阻断。 |

## 5. 重复代码、历史遗留与已收敛内容

- 旧 `app.js` 保留为无副作用兼容说明，运行入口统一到 `src/main.js`；避免新旧学习状态机并行运行。
- Supabase 配置/schema 已从运行时路径移除；offline scan 将其重新引入视为失败。
- 书籍、词典和 AI 数据不再分别散落在 localStorage、临时 Map 和多套 IndexedDB 逻辑中；统一通过 `LocalStore`、`DictionaryRepository`、`BookLibrary` 和 AI cache 边界处理。
- 阅读器按 `TextEngine`、`EpubEngine`、`PdfEngine` 分开；主页面仍有装配代码，但解析、缓存、进度和清洗不再复制三套实现。
- 仍存在的历史/维护性遗留是 `src/main.js` 页面装配偏大、Gradle 警告和未使用的旧兼容文件；这些不应在发布前被“顺手大重写”，应按独立重构任务拆批。

## 6. 风险等级与优先级

| 优先级 | 释放条件 | 处理方式 |
| --- | --- | --- |
| P0 | 构建、测试、APK freshness、canonical install 任一失败。 | 立即停止交付，修复后重新执行完整 `npm run build`。 |
| P1 | Bigme 真机按键/墨水观感、正式签名、超大词典/PDF/备份边界。 | 发布前必须验证或明确降低产品承诺；必要时实施局部/必要重构。 |
| P2 | bundle 分包、SQLite/FTS、main.js 拆分、Gradle 警告。 | 进入下一迭代，不阻塞当前模拟器 debug 候选。 |
| P3 | 低频 MDX 加密、非标准 MDD、特殊 EPUB。 | 收集样本后按兼容性需求处理。 |

## 7. 完整整改实施顺序

### 立即执行（当前交付候选）

1. 保持 canonical 工作区和当前分支，不从临时 worktree 安装。
2. 对最后一次代码/文档修改执行 `git diff --check`、`npm run test:all`、`npm run lint:offline`、`npm run build`。
3. 只在 build 成功后执行 `npm run android:install`。
4. 安装成功后再做首页、设置、背词、词典、阅读和冷启动截图；记录版本、SHA-256、source fingerprint。
5. 交付 debug 候选时同时交付本报告，明确 Bigme 真机和 release 签名状态。

### 发布前必做

1. 连接 Bigme B7 Pro，按 `docs/BIGME_B7_PRO_CHECKLIST.md` 逐项验证实体键、沉浸式返回、墨水刷新、横竖屏、SAF 文件选择、TTS、Keystore 和长时间运行。
2. 使用至少一份真实 EPUB、一份真实 PDF、一份扫描 PDF、一份 StarDict、一份 MDX/MDD 和一份大备份做设备验收。
3. 配置 release keystore，提升 versionCode，执行完整 build/install/升级验证；禁止使用 downgrade 参数。
4. 对真实数据做恢复前快照，验证普通备份不含正文/Key、完整备份可恢复，且覆盖恢复不会串入旧缓存。

### 后续版本

1. 对 PDF/EPUB/词典进行动态分包和按页/按章节索引。
2. 评估 SQLite/Room + FTS 替代大规模 IndexedDB 条目 Map。
3. 将设置、备份、书籍导入和字体管理从 `src/main.js` 拆为独立 controller。
4. 清理 `flatDir` 与 deprecated API，补充非标准 MDX/MDD 样本和性能基准。

## 8. 交付判定

当前判定为：**代码整改完成，canonical debug APK 可安装并通过自动化/基本 UI 验收；正式放心交付仍需 Bigme 真机和 release keystore 两个外部条件。**

本报告没有把未连接的硬件、未提供的真实格式样本或未配置的 release 签名标记为通过。

