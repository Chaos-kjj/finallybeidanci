# Cloudflare Pages + Supabase 部署说明

这个目录是可公开部署的前端静态版本。用户账户、背词记录、阅读书库、阅读进度、阅读设置、AI 设置和学习统计会通过 Supabase 同步。

## 需要注册的服务

1. Supabase：用于 Auth 登录注册、Postgres 云端数据表、Realtime 多设备更新。
2. Cloudflare Pages：用于托管这个静态 PWA。
3. SiliconFlow：可选，仅用于页面右上角 AI 设置里的释义、造句批改、翻译挑战。

## Supabase 初始化

1. 在 Supabase 新建项目。
2. 打开 SQL Editor，执行 `supabase-schema.sql`。
3. 在 Authentication > Providers 确认 Email 登录已启用。
4. 如果保留邮箱验证，请在 Authentication > URL Configuration 里添加你的 Cloudflare Pages 域名作为 Site URL 或 Redirect URL。
5. `supabase-schema.sql` 会开启 RLS，并把 `user_app_state` 和 `user_reader_books` 加入 `supabase_realtime` publication，用于同账号多设备更新。

## Cloudflare Pages 设置

如果你把整个项目上传到 GitHub，并让 Cloudflare 从项目根目录构建：

- Framework preset: `None`
- Build command: `node deploy/build-config.js`
- Output directory: `deploy`
- Environment variables:
  - `KANGKANG_SUPABASE_URL`
  - `KANGKANG_SUPABASE_ANON_KEY`

如果 GitHub 仓库根目录就是本 `deploy` 目录：

- Framework preset: `None`
- Build command: `node build-config.js`
- Output directory: `/`
- Environment variables:
  - `KANGKANG_SUPABASE_URL`
  - `KANGKANG_SUPABASE_ANON_KEY`

可选环境变量：

- `KANGKANG_SUPABASE_STATE_TABLE`：默认 `user_app_state`，通常不用改。
- `KANGKANG_SUPABASE_READER_BOOKS_TABLE`：默认 `user_reader_books`，通常不用改。

## 本地运行

根目录执行：

```bash
npm start
```

当前 `server.js` 会优先使用根目录 `index.html`；如果不存在，就自动托管 `deploy/` 目录。

本地要测试云端同步时，可以直接编辑 `deploy/supabase-config.js` 和根目录 `supabase-config.js`，填入 Supabase Project URL 和 anon key。anon key 是浏览器端公开 key，不要填写 service role key。

## 数据同步范围

登录后会同步：

- 背词词库、SRS 进度、已认识/待复习列表、错词本分组。
- 阅读书籍正文、书籍元数据、划线/错词高亮、阅读进度。
- 阅读字体、字号、行高、主题、阅读模式、最近书籍。
- 学习统计、打卡日历、趋势数据。
- AI 设置，包括 SiliconFlow API Key。

释义缓存仍保留在当前设备本地，因为它可以重新生成，不属于用户学习记录。
