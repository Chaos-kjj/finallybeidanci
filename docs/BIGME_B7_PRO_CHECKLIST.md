# Bigme B7 Pro 真机验收清单

状态：Bigme B7 Pro 真机待连接。Android 模拟器 `beidanci_api34` / `emulator-5554` 的软件回归已完成；下方硬件项目仍不能据此标记为通过。

## 已完成的 Android 模拟器回归

- [x] 最新 debug APK 安装、强制退出重启、覆盖安装后 IndexedDB 书籍/设置/阅读进度保留。
- [x] 两本真实测试文件导入：EPUB 图片、稳定分页、触摸翻页、目录/跳转、搜索、书签/笔记；PDF 原版面与文本重排、PDF.js 离线 worker、翻页和搜索。
- [x] 沉浸式阅读顶部 15% 菜单、中间点击不弹菜单、横竖屏切换、系统栏隐藏。
- [x] 普通备份与包含原文件的完整备份：修复大 Base64 SAF 导致的 `TransactionTooLargeException`，完整 ZIP 实际落盘且应用不崩溃。
- [x] 计时 activeMs 前后观测、音量键调试日志隐私（只记录 keyCode/source/time）。

截图证据：`/tmp/beidanci-final-*.png`；构建指纹与 APK 新鲜度以最终 `npm run build` 输出为准。

## 安装和升级

- [ ] Android 14 上安装 `app-debug.apk`，applicationId 为 `com.kangkang.beidanci`。
- [ ] 同一 debug 签名覆盖安装，验证学习记录、书籍和设置保留。
- [ ] 覆盖旧 APK 后无需清除应用数据即可看到最新界面，旧 Service Worker 缓存不会继续返回旧版本。
- [ ] 冷启动和飞行模式启动成功；不依赖外网、CDN 或 Supabase。
- [ ] Android 系统文件选择器导入 TXT/EPUB/PDF/词典，退出重进后仍可用。

## 阅读体验

- [ ] EPUB 目录、章节切换、真实分页、字号/字重/字间距/行距/段距/首行缩进/四边页边距。
- [ ] EPUB 长按选择后出现“查词、AI 解释、AI 翻译、复制、做笔记”和自定义 action。
- [ ] PDF 原版面缩放、适宽/旋转、裁白边、对比度、灰度/反色和文本层选择。
- [ ] PDF 文本重排设置生效；扫描 PDF 明确提示无文本层，不伪造查词能力。
- [ ] 书签、笔记、搜索、阅读进度在强制退出后恢复。
- [ ] 翻页无滑动动画，无 smooth scroll；确认仅正文/页码更新。

## 学习、词典和隐私

- [ ] 背词、SRS、造句挑战、翻译挑战、错词本、已认识/待复习列表、统计和内置 Collins 词典回归。
- [ ] StarDict、MDX/MDD、应用 ZIP 词典导入、取消、失败回滚、排序、启停、精确/词形查询。
- [ ] 检查 Android Keystore 中 Key 可用；logcat、WebView storage、普通备份均无 API Key。
- [ ] 主动点击 AI action 才发请求；离线时核心阅读/背词/词典不受影响。
- [ ] 普通备份不含书籍正文、原文件、AI Key；完整备份恢复完整性校验通过。

## 按键调试记录

在设置页点击“记录测试按键”，依次按 Bigme 实体翻页键、音量键、返回/菜单键，记录页面显示的真实 Android key code，然后按需调整下一页/上一页映射。当前默认映射：

- 下一页：24、93、22
- 上一页：25、92、21
- 菜单：82
- 返回：4

## 性能观察

- [ ] 7 英寸屏上滑块松手后重排，不连续重建应用 shell。
- [ ] 大 EPUB 章节切换无明显卡死；大 PDF 只保留当前页 Canvas。
- [ ] AI 结果整段刷新，默认不逐字流式刷新。
- [ ] 记录冷启动耗时、首次打开 EPUB/PDF 耗时、翻页耗时和内存异常；将实际数值补回本文件和实现状态文档。
