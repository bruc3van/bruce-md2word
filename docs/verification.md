# 验证记录

## 2026-09-22 数学公式迭代（v0.2.0 发布前）

环境：Windows、Node.js 24.19.0，新增 Temml 0.13.5。公式由 Temml 解析为 MathML，再由自有转换层生成可编辑 OMML。

- `npm run typecheck` 通过；`npm test` 共 68 项，67 项通过、0 项失败、1 项因 Windows 文件符号链接权限明确跳过，目录 junction 检查已执行。
- 10 项公式专项测试覆盖四种分隔符、代码/金额/转义隔离、上下标与重音、矩阵和中文条件、源码行号、异常源码保留、诊断/公式预算、CLI 严格拒绝和 DSH 附件调用。
- `npm run test:pack` 通过；隔离安装包的默认插件调用和独立 CLI 均验证生成原生联合上下标，附件 worker 读回通过。
- 严格导出 `fixtures/数学公式.md` 无警告；生成文档包含 28 个原生公式，其中 16 个使用独立公式段落结构，图片数量为 0，文末标记存在。产物为 `output/数学公式-验收.docx`。
- 综合样例严格导出成功，只有原有的两条 Mermaid 小字号信息提示；公式降级样例普通模式返回 10 条带行号的 `MATH_NOT_CONVERTED`。CLI 专项测试确认严格失败未创建输出文件。
- 后续使用 Microsoft Word 原生渲染检查了三份 README 展示样例，截图及复现方式见 [展示截图](assets/README.md)。公式编辑操作和全部测试文档的逐页视觉验收仍未完成。

## 2026-09-22 Windows 插件规范修复验证

环境：Windows、Node.js 24.19.0、DSH 服务包 0.1.6-alpha.2、Cordis 4.0.2。宿主源码参考 `ddefc45fbc`；本节测试运行实际发布的服务包，不代表完整宿主 UI 验收。后文 macOS 记录保留为历史验证。

- `npm run typecheck` 通过；`npm test` 共 52 项，51 项通过、0 项失败、1 项明确跳过。跳过项为需要 Windows 文件符号链接权限的专项测试，本机创建文件符号链接返回 EPERM；目录 junction 的输入越界、图片越界和输出目录拒绝测试实际执行并通过。CI 对文件符号链接权限错误不跳过。
- 模式依赖回归验证了 shell 缺失时不注册工具、服务卸载时撤销工具和 Skill、恢复后可再次导出；项目模式无需宿主 fs 服务。附件服务消失会取消活动任务，恢复后新队列可正常保存附件。
- 补充 shell 提供方卸载场景后，单独执行 `node --test tests/cli.test.mjs`，6 项全部通过；确认用户取消、插件卸载、shell 服务卸载均终止并等待 DSH 管理的活动 CLI 进程。
- `npm run test:pack` 通过：独立目录安装 tarball 后，附件读回、默认插件调用包内 CLI 保存 DOCX、独立 CLI 中文 Mermaid 导出均成功。
- 本地 strict 导出 `output/Windows-完整样式.docx`（10,951 字节，无警告）和 `output/Windows-Mermaid中文.docx`（212,515 字节，无降级）。后者在源码第 32、68、85 行分别提示估算最小字号约 7.4、5.0、7.8 pt；属于可读性提示。

仍未完成 Microsoft Word 整页视觉检查、完整 Web/Desktop UI 交互和真实受限沙箱端到端验收。本次没有修改用户 profile、提交或发布版本。

## 历史验证

验证环境：macOS，Node.js **24.21.0**，DSH 服务包 **0.1.6-alpha.2**，Cordis **4.0.2**。

补充兼容验证：使用本机 `npx @deepseek-ai/dsh@latest web` 对应的 **0.1.5-rc.2** 已安装服务依赖，在隔离目录运行全部 48 项测试通过。peer 兼容声明限定为这两个已测版本。经用户授权，tarball 已安装到现有 `web` profile；bundle 注册和配置组合检查通过，实际安装包的 CLI 成功生成样式试用文档。原运行中的 Web 进程仍需重启，尚未据此声明 UI 中已加载新工具。

Mermaid 更新已打包为 **0.1.1** 并安装回该 profile。使用实际安装包 CLI，以 strict 模式导出中文示例，DOCX 内含 7 张图片，大小 208,932 字节，无降级提示。隔离 tarball 冒烟也覆盖了中文 Mermaid 图片生成。新增 beautiful-mermaid 及其依赖在本机解包约 11 MiB，不含项目已有的 sharp，无 Chromium。

实现范围已按后续讨论调整为：默认通过 DSH 执行服务调用同包 CLI，在本机项目 `output/` 生成 DOCX；附件交付保留为可选配置。没有专用 Client 卡片，也没有修改宿主源码。

## 已验证

| 要求 | 证据及边界 |
| --- | --- |
| 类型检查与源码测试 | 编译通过；Node 24 下 `tests/*.test.mjs` 共 48 项通过，无跳过 |
| Bruce 原版样式 | 对照版本 `5bcfa6d170debb7d36580c2ab833c506459dca67`：完整样式和五级编号配置一致；生成的 styles.xml 完全一致；固定样本的段落、表格边框/留白/底纹/对齐、页边距 XML 一致；图片默认 560px 宽度、比例及独立图片段间距通过测试。基准保存在 fixtures/reference；此项不等于 Word 视觉验收 |
| Markdown 文件和正文 | 真实 DSH 工具注册调用、CLI 文件输入和 stdin 输入均生成有效 DOCX；覆盖 BOM、互斥参数、空输入、文件名 |
| 转换语义 | XML 回归覆盖中文、混合样式、链接、转义、HTML 文本、列表起始编号与嵌套、表格、代码空白、图片嵌入 |
| 两阶段 worker | worker 解析、宿主/CLI 读取图片、同一 worker 生成并校验产物；取消等待 worker 及资源读取清理 |
| 中文 Mermaid | beautiful-mermaid 1.1.3 + sharp：六类图共 7 张中文样例，CLI strict 模式成功导出；从实际 DOCX 提取 PNG 并逐张检查，中文、全角标点、中英混排、显式换行可见且无缺字方框。生成时禁用网络字体，图片为 2 倍像素；不等同 Word 整页视觉验收 |
| 图片与诊断 | PNG/JPEG/GIF/BMP；缺图、损坏、不支持的 Mermaid、strict、受限诊断与 data URL 不回显；BMP 支持范围见 README |
| 文件访问 | 会话 cwd 优先；显式额外读取根；源文件/图片符号链接越界；实际读取大小超过 stat 预检值仍拒绝 |
| 预算与生命周期 | 正文、图片字节/数量/尺寸、输出大小、排队、BUSY、deadline；预取消、执行中取消和卸载 |
| 本机 CLI 交付 | 实际 DSH 本地执行服务调用默认包内 CLI；返回文件可读取，DOCX 主文档包含预期文本；模型正文通过 stdin，shell 表达式不执行 |
| 发布文件 | 同名自动编号；并行创建不覆盖；完整写入后发布；拒绝符号链接输出目录；测试后无临时文件 |
| 执行器取消和卸载 | 启动真实长运行测试进程后取消/卸载，等待任务结束，并确认 PID 不再存在 |
| 沙箱转交 | 适配器测试确认传递会话 cwd、策略和 signal，沙箱拒绝不重试；尚未验证各操作系统内核沙箱 |
| 附件模式 | 真实附件服务保存与读取；JSON 序列化后的引用仍可读取；AttachmentError 原样抛出；保存后取消不返回成功附件但保留已提交对象 |
| npm 包独立运行 | `scripts/pack-smoke.mjs` 在独立目录安装 tarball，验证附件模式、默认插件调用包内 CLI、独立 CLI。无需全局 CLI，无源码目录依赖 |
| 实际 DSH profile | 目标 DSH CLI 与 pnpm 11.7.0 在独立临时 `DSH_HOME` 中安装 tarball，`--dump-config` 包含插件行；profile 中的 CLI 在无 peer 自动安装时生成可读取 DOCX；启动实际 profile 后，探针插件通过工具注册表调用 `word_export`，成功保存并读取 8,878 字节 DOCX；正常移除后 bundle 列表不含插件。未调用模型，此项不是 UI 验收 |

安装验证发现 pnpm profile 不一定自动安装 host peer dependencies，因此 CLI 与其 worker 的构建产物打包了所用 DSH 辅助代码；转换库仍作为普通 dependencies 安装。原生宿主模块保留 peer 身份。CLI 已在这种 pnpm 安装布局下验证，不依赖 npm 自动补齐 peer 的行为。打包依赖的许可证随 `lib/CLI-LICENSES.txt` 一起发布。

本机全局 pnpm 11.16.0 的一次移除在打印完成后未退出，已终止该测试子进程；随后使用参考 DSH 仓库声明的 pnpm 11.7.0 重新验证正常移除成功。没有修改宿主源码或用户现有 profile。

测试命令：

```sh
npm test
npm run test:pack
npm run example
node scripts/mermaid-example.mjs # 导出中文 Mermaid Word 并提取图片供检查
```

应在 Node 24 下执行。开发机默认 `npm` 的解释器是 Node 26，曾产生 engines 警告；上述转换测试与打包后的运行进程使用 Node 24，未据此声明 Node 26 支持。

## 尚未验收

- Windows 本机自动化验证已补充在上文；Linux 实机冒烟和各平台受限沙箱行为仍待验证。三平台 GitHub Actions 的实时结果见仓库 Actions 页面。
- Microsoft Word 中的中文字体、列表、表格、图片和分页视觉检查。当前机器没有 Microsoft Word/LibreOffice；WPS 界面工具未完成样例打开检查，不把 ZIP/XML 校验视为视觉验收。
- 完整 DSH Web/Desktop 从用户请求到工具调用的交互验收。实际 profile 启动及工具调用已程序化验证，尚未验证 UI 操作。
- DSH 文件附件的完整 Web/Desktop 下载体验：参考宿主没有通用下载按钮；默认项目文件交付已绕开此依赖，可选附件模式不承诺浏览器下载能力。

因此，当前实现和本机自动化验证可供试用，但尚不能宣称实施方案的所有发布验收门槛均通过。

## 0.1.2 错误回传修复

复现 Node 26.0.0 在 stderr 输出 localStorage ExperimentalWarning，后接 CLI 的 CONTENT_INCOMPLETE JSON；此前整体 JSON.parse 失败，误报 CLI 启动失败。现在按行识别 protocol=1 的错误消息，保留正确错误码，忽略前后运行时警告。新增回归覆盖警告前置/后置、纯 JSON、非协议错误。实际 DSH 执行器在 Node 26 下使用用户降级案例验证：返回 CONTENT_INCOMPLETE，无输出文件。此项仅确认该问题已修复，不代表完整 Node 26 支持。

## 0.1.3 布局与诊断修复

- 构建时对固定版本 beautiful-mermaid 应用中文类成员宽度修正，先测量再布局；不修改参考库安装目录或 DSH 仓库。带原始中文长方法签名的类图增加像素回归，确认文本存在且没有越过类框右边界。
- 流程/状态图节点、连线的长文本在布局前换行；保留英文单词、显式换行和字符内容，内联格式标签不做自动分行。原始 M1 长标签已实际查看分行效果。
- 按最终图片放置尺寸估算最小显式字号，低于 8 pt 返回带行号的 MERMAID_SMALL_TEXT 信息。严格模式仍可导出内容完整的宽图；这不是小字自动变大的功能。
- 未渲染图在 DOCX 中增加中文说明及源文件行号，后接原始 CodeBlock；strict 仍拒绝降级内容。
- 原始正常案例重新导出后仍有 7 张图，M4 已目视确认无中文方法签名溢出；M7 估算最小字号约 2.6 pt，并返回明确提示。Word 整页分页仍未实测。
