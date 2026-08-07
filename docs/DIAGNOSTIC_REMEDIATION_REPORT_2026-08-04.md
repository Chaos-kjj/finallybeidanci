# 康康背词器诊断、修复与验收报告

> 历史说明：本文记录 2026-08-04 的模拟器回归，不代表 2026-08-05 本次重新执行的结果。当前交付状态、最新测试、canonical 安装和未验证边界见 [DELIVERY_ACCEPTANCE_2026-08-05.md](./DELIVERY_ACCEPTANCE_2026-08-05.md)。

日期：2026-08-04  
范围：Android APK、离线 WebView、背词、词典、阅读器、AI、备份恢复、墨水屏/硬件键、数据迁移与交付链路。

## 1. 结论

本轮已完成代码审查、Android 14 模拟器全功能回归、缺陷修复、自动化回归和 APK 交付。最终交付以仓库根目录执行 `npm run build` 为唯一有效证据；该命令会依次执行 8 组测试、离线扫描、Vite 构建、Capacitor 同步、Gradle debug APK 组装及 APK freshness 校验。

Owner 数据在验收前后保持一致：43 个词、8 本书、已认识 1、待复习 1；数据库中的 2026-08-04 日统计仍为 129 分钟。最终复核时设备已跨到 2026-08-05 00:22（中国标准时间），首页按设计显示新一天的 0 分钟，不是数据丢失。隔离测试记录已清理，没有 `test-*` 或 `dict-test` 数据残留。

## 2. 方法与边界

- 使用 Android 14 / API 34 模拟器 `beidanci_api34`（`emulator-5554`）。
- Computer Use 无法枚举外置 Emulator，因此按技能允许的降级路径使用 ADB 截图、Android UI hierarchy 与 WebView CDP 完成真实 UI 操作和证据采集。
- 先保存 Owner WebView/IndexedDB 可恢复快照，再使用隔离状态测试，最后恢复 Owner 并只读核对。
- 测试覆盖在线、离线、重启、横竖屏、损坏文件、v5 数据升级、硬件键和 APK 覆盖安装。
- Token Rhythm 服务曾以用户提供的主密钥做受控连通性/模型列表验证，确认使用 `deepseek-v4-flash-0731`。备用密钥未使用；任何密钥均未写入仓库、自动化 fixture、日志或备份，也未注入最终模拟器数据。

## 3. 缺陷、根因与解决方案

| ID | 级别 | 问题与根因 | 已实施方案 | 验收结果 |
| --- | --- | --- | --- | --- |
| D-01 | P0 | 已有设备数据库为 v5，而旧代码请求 v4，会触发 IndexedDB `VersionError`，存在无法启动风险。 | 数据库提升到 v6；显式实现 v4→v5、v5→v6 幂等迁移；不删除旧记录；增加高版本数据库保护和可读恢复提示。 | v5 fixture 与模拟器真实迁移均通过；书籍、42% 进度、笔记和 marker 保留。 |
| D-02 | P0 | 导入词典把运行时 `Map` 当可持久化结构，重启后条目不可可靠恢复；启停/删除也未形成完整事务。 | 新增 `DictionaryRepository`，将每个条目序列化为 IndexedDB 记录；保存 metadata、entry、源文件关系；启停持久化；删除时事务清理词典、索引和关联文件。 | 导入、查询、重启、停用/启用、删除及清理通过。 |
| D-03 | P0 | 旧备份缺少词典文件的 `dictionaryId`/`role`，普通/完整备份边界不清，恢复缺少预演和原子回滚。 | 备份协议升级为 v2；保留书籍、字体、词典源文件及关系字段；恢复前预演并选择合并/覆盖；保存完整安全快照；单事务写入；v2 必须带 SHA-256 且恢复前校验，缺失/篡改即拒绝；v1 可兼容读取但始终明确标为未验证。 | 完整 ZIP、干净库恢复、字体/词典关系、事务失败回滚和篡改拒绝均通过。 |
| D-04 | P0 | Android 14 返回键未关闭阅读菜单；同时存在 `!element?.…` 把不存在的反馈抽屉误判为可见的逻辑错误。 | 同时支持 `OnBackInvokedDispatcher`、`dispatchKeyEvent(KEYCODE_BACK)` 和 WebView 状态机；仅在反馈抽屉实际存在且可见时拦截。 | 最终 APK 上依次验证“关闭菜单→退出沉浸→回首页”。 |
| D-05 | P0 | 损坏书籍可能在解析失败前进入库或覆盖当前阅读状态。 | 所有格式先解析/校验再提交；失败项可单独安全删除；打开失败不会覆盖上一本文档；删除同步清理标注。 | 损坏 PDF 被 `Invalid PDF structure` 拒绝，未污染书库；合法 PDF 随后正常打开。 |
| D-06 | P1 | TXT/Markdown/HTML/PDF/EPUB 共用不完整阅读路径，滚动进度、搜索、标注、字体和 PDF 适配不一致。 | 按格式拆分 ReaderEngine；实现真实 Markdown/HTML 渲染和清洗、分页/滚动进度、搜索分页与高亮、书签/笔记元数据、每书设置、PDF fit/旋转、字体持久化与备份。 | TXT、Markdown、HTML、PDF 设备样本及 EPUB 回归均通过；重启后进度/设置恢复。 |
| D-07 | P1 | 剪贴板在 Android WebView 权限受限时无可靠反馈。 | 增加 Android 原生 Clipboard 插件，并保留 Web Clipboard 与 `execCommand` 逐级 fallback；沉浸模式使用可见反馈抽屉。 | 原生与 fallback 自动化路径通过，设备复制反馈可见。 |
| D-08 | P1 | AI 失败时学习/挑战流程可能前进；默认服务与模型不一致；429、慢推理、推理 token 截断反馈不足。 | 默认 Base URL 使用 Token Rhythm，模型使用 `deepseek-v4-flash-0731`；API Key 仅存 Android Keystore；429/5xx/网络/超时按上限退避重试；超时可配 5–120 秒（默认 60 秒）；识别 `reasoning_content` 和 `finish_reason=length`；只有成功结果才推进学习状态。 | 成功、401、429、5xx、取消、超时、畸形响应、推理截断与重试自动化测试通过；设备设置校验反馈通过。 |
| D-09 | P1 | AI 设置逻辑写入不存在的 `#ai-status`，自定义操作错误复用备份状态区。 | 建立独立 AI 状态区域，规范值回写，补连接自检、超时和重试配置；所有 AI 操作反馈归入 AI 区域。 | 保存、非法 URL、自定义操作和连接状态反馈可见。 |
| D-10 | P1 | 词典 `ability` 的内置 headword 数据冲突会显示错误词头。 | 对内置词典采用键名优先修复规则，并加固定 fixture。 | `ability` 查询结果和标题正确。 |
| D-11 | P1 | Android `KEYCODE_MENU` 有映射但未由 Activity 转发；硬件返回与音量翻页链路分散。 | Activity 统一转发菜单、翻页、音量和返回事件；保留调试页但只记录 keyCode/source/time，不记录 printable key。 | 菜单键、音量翻页、返回链及日志脱敏通过。 |
| D-12 | P2 | 多处使用浏览器 `confirm`、无重试提示或状态区域冲突，墨水屏上反馈不清晰。 | 新增应用内 Modal/Feedback 组件；危险删除二次确认；错误支持重试；设置区可折叠；优化离线状态、输入校验和挑战文案。 | UI 回归和窄范围启动日志检查通过。 |

## 4. 已完成的重构

- `src/controllers/reader-controller.js`：阅读状态机、滚动进度与恢复。
- `src/controllers/dictionary-controller.js`：词典仓库、启停和删除事务。
- `src/controllers/vocab-controller.js`：学习结果与流程推进边界。
- `src/ui/modal.js`、`src/ui/feedback.js`：统一确认、错误、重试和沉浸反馈。
- `src/core/clipboard.js`：原生/Web/fallback 剪贴板策略。
- `src/storage/local-store.js`：数据库迁移、事务和恢复失败分类。
- `src/storage/backup.js`：备份协议、完整性、预演、合并和恢复数据集。
- `src/reader/reader-engine.js`：按格式隔离解析与呈现能力。

## 5. 验收矩阵

| 范围 | 结果 |
| --- | --- |
| 自动化 | 8/8 测试文件通过，0 失败；覆盖迁移、备份完整性/回滚、词典重启、阅读格式、安全清洗、AI 错误矩阵、学习状态和 APK 门禁。 |
| 离线 | offline scan 通过；飞行模式下首页、书库、阅读和内置词典可用；AI 仅主动操作时联网。 |
| 数据 | v5→v6 保留书籍、进度、笔记和 marker；高版本 DB 不降级覆盖；Owner 恢复后数据计数一致。 |
| 阅读 | Markdown/HTML/TXT/PDF/EPUB、滚动/分页、搜索/高亮、书签/笔记、字体、PDF fit/旋转和重启恢复通过。 |
| Android | API 34 安装、覆盖启动、沉浸返回链、原生复制、TTS、菜单/音量/翻页键和日志脱敏通过。 |
| 备份 | 普通/完整 ZIP、关系字段、SHA-256、预演、合并/覆盖、事务回滚、完整恢复和 Key 脱敏通过。 |
| APK | `npm run build` 完成测试、离线扫描、资源同步、Gradle 组装和 freshness verifier；精确指纹与 SHA-256 以该次命令及最终交付信息为准。 |

## 6. 保留限制与后续优化

以下不阻塞本次模拟器交付：

1. Bigme B7 Pro 真机未连接；真实墨水刷新观感、厂商特殊 key code 与长时间续航仍需按 `BIGME_B7_PRO_CHECKLIST.md` 做真机验收。
2. PDF.js 测试仍提示 `standardFontDataUrl` 警告，但合法 PDF 已在模拟器成功渲染；可在后续版本内置标准字体资源以消除警告。
3. 当前 Web bundle 约 1.9 MB，主要来自 PDF.js；可按格式动态加载 PDF/EPUB 模块以缩短冷启动。
4. `src/main.js` 仍承担页面装配职责；后续可继续把设置、备份和导入流程拆成独立 controller，但业务状态已开始按域隔离。
5. 超大 PDF 的全文索引可进一步改为按页惰性建立；特殊加密 MDX/MDD 仍需更多真实词典样本。
6. 发布版仍需要正式 release keystore；本次交付为可安装调试 APK。

## 7. 安全说明

- 仓库和 APK 不内置任何 API Key。
- API Key 不进入 localStorage、IndexedDB、日志、错误消息或备份，只在 Android Keystore 中由用户主动保存。
- 因密钥曾经出现在对话内容中，建议验收结束后在服务商后台轮换主/备用密钥。
