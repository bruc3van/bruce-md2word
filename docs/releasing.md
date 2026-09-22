# 发布

采用与 dsh-desktop-safe-market 相同的 tag 触发流程：测试通过后发布 npm，再创建 GitHub Release。Release 附带构建好的 `.tgz`，可直接通过 `dsh plugin add` 安装；GitHub 自动生成的源码压缩包不包含 `lib/`。

## 首次发布

npm Trusted Publishing 需要先有包。维护者使用 `npm login --auth-type=web` 登录，在 Node.js 24 下完成 `npm test`、`npm run test:pack`、`npm pack`，再执行 `npm publish ./dsh-md2word-<version>.tgz --access public`。

首次发布后，在 npm 包 Settings → Trusted Publisher 配置 GitHub Actions：

- Owner：`bruc3van`
- Repository：`dsh-md2word`
- Workflow filename：`release.yml`
- Environment：留空（工作流未设置 environment）
- Allowed actions：允许直接 `npm publish`；仅允许 `npm stage publish` 不满足当前自动发布流程。

配置入口：https://www.npmjs.com/package/dsh-md2word → Settings → Trusted Publisher。Workflow filename 只填写文件名，不填写 `.github/workflows/`。工作流已使用 GitHub 托管 runner、Node.js 24 和 `id-token: write`，无需添加 `NPM_TOKEN` Secret。要求 npm CLI 至少为 11.5.1，参见 [npm 官方说明](https://docs.npmjs.com/trusted-publishers/)。

授权完成后，后续 tag 发布使用 OIDC，不保存长期 npm token。首次 tag 如发现版本已存在，会跳过 npm 发布并创建 GitHub Release。未配置 Trusted Publisher 时，后续新版本的自动发布会失败。

## 后续版本

1. 同步更新 `package.json`、`package-lock.json`、README 的安装版本及 `CHANGELOG.md`。
2. 使用 Node.js 24 运行 `npm ci`、`npm test`、`npm run test:pack`。
3. 提交并推送 `main`，创建与包版本一致的 `vX.Y.Z` tag 并推送。
4. 检查 Release 工作流完成、GitHub Release 附件及 npm 版本。CI 通过不代替 Word 版面或 Windows 实机验收。

已发布的版本不可覆盖；发现问题应增加版本号重新发布。

例如下次发布 `0.1.4`，先执行 `npm version 0.1.4 --no-git-tag-version` 同步两个包清单，再更新 README 和 CHANGELOG、完成测试并提交。之后执行：

```sh
git push origin main
git tag -a v0.1.4 -m "Release v0.1.4"
git push origin v0.1.4
```

tag 必须指向包含版本变更和发布工作流的提交。仅在 GitHub 页面创建 Release 不是本工作流的触发条件；触发条件是推送 tag。

2026-09-22 核查：npm 已有 `0.1.3`，GitHub 的 `v0.1.3` Release 工作流成功，但日志明确显示跳过已有 npm 版本。因此这次绿色运行不能证明 Trusted Publisher 授权有效；需通过新版本发布验证。
