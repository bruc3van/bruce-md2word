# 发布

采用与 dsh-desktop-safe-market 相同的 tag 触发流程：测试通过后发布 npm，再创建 GitHub Release。Release 附带构建好的 `.tgz`，可直接通过 `dsh plugin add` 安装；GitHub 自动生成的源码压缩包不包含 `lib/`。

## 首次发布

npm Trusted Publishing 需要先有包。维护者使用 `npm login --auth-type=web` 登录，在 Node.js 24 下完成 `npm test`、`npm run test:pack`、`npm pack`，再执行 `npm publish ./dsh-md2word-<version>.tgz --access public`。

首次发布后，在 npm 包 Settings → Trusted Publisher 配置 GitHub Actions：

- Owner：`bruc3van`
- Repository：`dsh-md2word`
- Workflow filename：`release.yml`
- Environment：留空（工作流未设置 environment）

授权完成后，后续 tag 发布使用 OIDC，不保存长期 npm token。首次 tag 如发现版本已存在，会跳过 npm 发布并创建 GitHub Release。未配置 Trusted Publisher 时，后续新版本的自动发布会失败。

## 后续版本

1. 同步更新 `package.json`、`package-lock.json`、README 的安装版本及 `CHANGELOG.md`。
2. 使用 Node.js 24 运行 `npm ci`、`npm test`、`npm run test:pack`。
3. 提交并推送 `main`，创建与包版本一致的 `vX.Y.Z` tag 并推送。
4. 检查 Release 工作流完成、GitHub Release 附件及 npm 版本。CI 通过不代替 Word 版面或 Windows 实机验收。

已发布的版本不可覆盖；发现问题应增加版本号重新发布。
