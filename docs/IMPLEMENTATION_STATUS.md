# Android 墨水屏版本实现状态

更新时间：2026-08-01

## 当前结论

源码侧的发布阻断项已经实现并加入回归覆盖。最终状态以本次验收命令和 `android/app/build/outputs/apk/debug/app-debug.apk` 为准；没有 Bigme B7 Pro 真机，因此硬件观感、真实键码和安装升级仍单列为手测项目，不冒充已通过。

## 审查问题对照

| 编号 | 当前实现与证据 |
| --- | --- |
| A 阅读器 | `TextEngine` 渲染完整 TXT/Markdown/HTML，搜索结果使用段落锚点；EPUB 保留相对资源、图片、脚注/内部链接、封面、元数据和嵌套 TOC；PDF 首次只探测一页，页/文本 LRU 限制为 4/16，原版面叠加可选择文字层，重排按页读取并可定位搜索页；阅读设置、触屏翻页/点击区、实体键、滚动保存、resize/orientation 重排、全书进度、批注列表/跳转/删除和删书确认均在 `src/main.js`。 |
| B 备份与安全 | `src/storage/backup.js` 区分 data/complete；数据备份不会以 `blob:null` 覆盖现有文件，完整备份保留书籍文件和字典 `dictionaryId`/`role`；导入校验版本/敏感字段、按 ID 合并并在失败时恢复全 store 快照。 |
| C 原版能力 | 构建阶段从本地 Collins shards 生成 `dist/dict/word-list.json`，新装不再只有 40 个词；学习队列按日期/来源可复现随机；`ActiveTimeTracker` 按真实活跃时间计时；首页有月度打卡日历，趋势支持 7/14/30/自定义和阅读/背词分项；旧 AI URL/model/超时配置按字段迁移，Key 只进 Keystore。云同步和在线音频保持删除。 |
| D Android/墨水屏 | `EinkRenderScheduler` 消费三档不同的防抖、预取、整屏刷新周期；KeyEvents 原生插件只在 reader/capture 模式发事件，设置可捕获并写入 next/previous/menu/back，默认映射和回显持久化；Android Back 按浮层→页面→系统退出分层。 |
| E 离线词典 | StarDict 支持 32/64 位 idx、`sametypesequence`、`.dict`/`.dict.dz`（一次解压复用 + LRU）；导入可取消、分阶段进度、失败回滚、启停/排序/删除。MDX/MDD 公开声明为未加密 stored/zlib record-block 子集；其他变体通过 `scripts/convert-dictionary.js` 转为应用 ZIP，不宣称通用兼容。 |
| F AI/字体/设置 | AI cache key 包含 provider URL/model/action/context，命中与隔离可测；原生网络线程池可取消、超时可配；自定义 action 支持新增/编辑/排序/启停/text/JSON；字体 bytes 存在 `files/font-custom` 并启动恢复；设置和硬件映射启动回显。 |
| G 质量 | `tests/*.test.js` 覆盖迁移、计时、缓存、备份往返/冲突、文本/Markdown、复杂 EPUB、懒加载 PDF、StarDict 64/same-type/dz、词典导入、E-Ink 调度等；浏览器完成新装词库、导书、搜索、设置、批注、冷刷新、离线词典路径。 |

## 已执行命令

本次最终验收已执行：

```text
npm run test:all             # 6/6 passed
npm run lint:offline         # passed
npm run build                # passed; Vite 产物含 index/pdf/browser 分包
git diff --check             # passed
npm run android:sync         # passed
cd android && ./gradlew --no-daemon --max-workers=2 --console=plain assembleDebug  # BUILD SUCCESSFUL
```

构建后用以下方式核对 Web 资源与 APK 一致：

```text
unzip -l android/app/build/outputs/apk/debug/app-debug.apk | rg 'assets/public/(index|pdf|browser)-.*\\.js|assets/public/dict/word-list\\.json'
shasum -a 256 dist/assets/*.js dist/dict/word-list.json
unzip -p android/app/build/outputs/apk/debug/app-debug.apk assets/public/dict/word-list.json | shasum -a 256
```

验收结果：APK 为 `android/app/build/outputs/apk/debug/app-debug.apk`（16,849,817 bytes），`aapt dump badging` 确认 applicationId `com.kangkang.beidanci`、target SDK 35；`unzip -t` 通过。当前 Web 主入口已经按需拆出 PDF 和浏览器相关 chunk：index 165.10 KB、pdf 449.78 KB、browser 32.14 KB。APK 内的 index/pdf/browser、词库、入口 HTML 和 Service Worker 与 `dist` 逐字节一致；内置 `word-list.json` 419,715 bytes。最终 APK SHA-256 为 `d9a1c836f4eab2da3b8c2866302006185f67c66fc4abfdfe67914f02b914fe0c`，资源 SHA-256 为：

```text
dist/assets/index-CJHsj-rz.js       d04df8bd2034b3f34bf0deb2772501b3d8684b2ddc78d6e3ee247ee5304234bc
dist/assets/pdf-C92jcu7y.js         4c71f917dc36a561b092340d01d8793352bf40179f020f9d5927086a633014dd
dist/assets/browser-BzBbrBKd.js     743561b30ab4b50bcd74cfa8a87cb925c96f9bd7427909712b1dc9e48209f427
dist/dict/word-list.json             1da65b96a2bd69931c4c35bdfff064cef6b1dda9ba2076ea2f6475698e65faf5
```

本机 `adb devices -l` 返回空列表，且没有可用 AVD；因此没有伪造安装/真机结果。

## 只剩真机才能确认的事项

- Bigme B7 Pro 实际 Android key code（包含音量、翻页、菜单、返回、长按和重复上报）及按键误触/系统音量行为。
- 7 英寸屏幕下 fast/balanced/quality 的闪烁、残影、局部/整屏刷新观感，以及手动刷新周期。
- 状态栏/导航栏沉浸、横竖屏传感器、系统文件选择器、Keystore 和强制杀进程后的恢复。
- 长时间大 EPUB/PDF/词典导入的真机内存与耗电曲线。
