# 发布流程

推送 `vX.Y.Z` tag 触发 [Release 工作流](../.github/workflows/release.yml)：三平台测试通过后发布 npm，再创建 GitHub Release 并附上构建好的 `.tgz`。GitHub 自动生成的源码压缩包不包含 `lib/`，安装应使用 npm 包或 Release 中的 `.tgz`。

## 发布步骤

1. 在 Node.js 24 下执行 `npm version <新版本> --no-git-tag-version`，同步更新两个包清单；同步 README 和 `skills/bruce-md2word/SKILL.md` 中的安装版本，将 `CHANGELOG.md` 的未发布条目归入新版本。
2. 执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run test:pack`。
3. 提交并推送 `main`，创建与包版本一致的 `vX.Y.Z` tag 并推送。tag 必须指向包含版本变更的提交。
4. 确认 Release 工作流成功，GitHub Release 已公开且包含 `.tgz`，npm 新版本及 `latest` 已更新。
5. 在独立目录安装公开 npm 包并运行转换冒烟，核对 npm 包与 GitHub Release 附件一致。npm 可能需要几分钟处理新版本，发布命令成功不等于立即可安装。

仅在 GitHub 页面创建 Release 不会触发发布工作流。已发布版本不可覆盖，修复应使用新版本号。CI 和安装包验证不能替代 Word 版面及完整宿主交互验收。

## npm 发布配置

发布目标为 `bruce-md2word`，CLI 和 Skill 同名，不提供旧命令别名。GitHub 仓库为 `bruc3van/bruce-md2word`。首次发布新包名之前，需确认新包的发布权限与 Trusted Publisher 配置；旧包的授权不能作为新包已配置的依据。

工作流通过 npm Trusted Publishing（OIDC）发布，无需长期 `NPM_TOKEN`。维护仓库或工作流时，需同步检查 npm 包 Settings → Trusted Publisher 中的配置：

- Owner：`bruc3van`
- Repository：`bruce-md2word`
- Workflow filename：`release.yml`
- Environment：留空，与当前工作流一致
- Allowed actions：允许直接 `npm publish`

使用支持 `npm trust` 的 npm CLI 时，可执行 `npm trust github bruce-md2word --repository bruc3van/bruce-md2word --file release.yml --allow-publish` 配置，再用 `npm trust list bruce-md2word` 核对。npm 可能要求账号二次验证；仓库改名后也需同步这里的 repository。

工作流使用 GitHub 托管 runner、Node.js 24 和 `id-token: write`。首次创建新包可先通过 npm 登录完成发布，再配置新包的 Trusted Publisher。如果版本已存在，会跳过 npm 发布；GitHub Release 附件使用从 npm 重新获取的该版本 tarball，保证两处安装包一致。排查授权问题时应检查实际发布步骤日志，不能仅看工作流是否为绿色。
