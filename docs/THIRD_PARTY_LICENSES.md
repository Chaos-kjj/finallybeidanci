# 第三方依赖与许可证

以下是源码和 Android 构建直接使用的主要依赖。发布前应以 `package-lock.json` 和 Gradle lock/依赖树再次核对完整传递依赖清单。

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| Capacitor / `@capacitor/core`、`@capacitor/android`、`@capacitor/cli` 7.x | WebView 容器、Android 插件桥 | MIT |
| Vite 7.x | 本地 Web 构建 | MIT |
| `pdfjs-dist` 5.x | 本地 PDF 解析、文本层和 Canvas 渲染 | Apache-2.0 |
| `fflate` 0.8.x | EPUB、词典 ZIP、备份 ZIP | MIT |
| `foliate-js`（完整源码，`vendor/foliate-js`） | EPUB 解析、分页、目录、搜索、CFI 和固定版式渲染 | MIT；固定提交见 `vendor/foliate-js/UPSTREAM_COMMIT` |
| `construct-style-sheets-polyfill` 3.1.0 | Foliate 固定版式 renderer 的离线兼容依赖 | MIT |
| `ts-fsrs` 5.2.3 | 仅用于背词未来算法的 FSRS 影子数据，不参与正式调度 | MIT；`v5.2.3` = `0d72a487efbd1ee57bae9a6265cf413b20ae4338` |
| AndroidX / Capacitor Android 传递依赖 | Android UI、Activity、WebView 支持 | Apache-2.0（按各组件 NOTICE） |
| Gradle Wrapper 8.11.1 | Android 构建 | Apache-2.0 |

内置 Collins 词典资源属于仓库既有本地资源；其原始数据授权/再分发范围没有在本次重构中重新取得或扩大。正式公开发布 APK 前必须确认该资源的许可证和分发权限，或替换为明确可再分发的词典包。

本次没有新增远程 CDN、远程词库、Supabase SDK 或云端运行依赖。Android SDK、Build Tools 和 JDK 是构建工具，不随 APK 作为应用资源再分发。

Foliate 的可选 PDF adapter 随完整上游源码保留以维持源码完整性，但本项目没有启用它；PDF 仍由既有 `PdfEngine`/本地 `pdfjs-dist` 处理。EPUB 资源在 adapter 的 `transformTarget` 中过滤脚本、外部资源和外部链接，并由 Vite 打包进本地构建产物。
