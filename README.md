# dsh-md2word

**让 AI Agent 把 Markdown 内容交付为可编辑的 Word 文档。**

在 DeepSeek Harness（DSH）中，让 Agent 整理报告、编写方案或生成说明文档，再直接导出 `.docx`。标题、列表、表格和图片随内容一起转换，Mermaid 图表在本机渲染并嵌入，减少从对话复制到 Word 后重新排版的工作。

提供 DSH 原生 `word_export` 工具，也提供独立 CLI，供具备命令执行能力的其他 Agent 和自动化脚本调用。

## 从内容生成到文档交付

- **交付可继续编辑的文件**：正文、标题、列表和表格转换为 Word 内容，方便审阅、修改与归档；Mermaid 图表以图片形式嵌入。
- **沿用 Agent 的 Markdown 工作流**：既能导出已有 `.md` 文件，也能直接接收生成的 Markdown 正文，不必手工中转。
- **开箱即用的中文排版**：A4 页面，正文宋体、标题黑体，覆盖六级标题、五级列表及常见文档元素；实际字体显示取决于阅读环境。
- **把交付结果反馈给 Agent**：返回文件位置和结构化警告，便于修正缺失图片或不支持的图表；严格模式拒绝保存存在内容降级的文档。
- **在运行环境本地转换**：安装依赖后，转换无需 Office、Python、浏览器或在线转换服务。默认保存到当前项目的 `output/`，同名文件自动编号。

适合项目报告、实施方案、会议纪要、技术说明等以结构化内容为主的文档。当前提供固定排版样式，不提供自定义 Word 模板接口。

## 让 Agent 帮你安装

把下面这句话发给 Agent：

> 请帮我安装这个 DSH 插件，并告诉我如何使用：https://github.com/bruc3van/dsh-md2word

安装后重启对应 DSH 服务，即可让 Agent 导出 Word，无需另装 CLI 或 Skill。

<details>
<summary>手动安装命令与环境要求</summary>

当前包要求 Node.js `>=24 <25`、DSH 服务包 `0.1.5-rc.2` 或 `0.1.6-alpha.2`、Cordis `4.0.2`。请在目标 DSH 环境中执行，将 `web` 换成实际 profile，并沿用该环境的 `DSH_HOME`。

```sh
dsh plugin --profile web add dsh-md2word@0.1.4
```

如果你的 DSH 通过 `npx` 启动，可使用对应版本的 CLI，例如：

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile web add dsh-md2word@0.1.4
```

安装后重启对应 profile。默认项目模式需要 DSH 的 `tools` 与 `shell` 服务就绪，才会注册 `word_export`。版本来源见 [npm 包](https://www.npmjs.com/package/dsh-md2word)，服务依赖见 [运行参考](docs/agent-reference.md#环境与工具注册)。

</details>

## 直接描述你要交付的文档

### 导出已有 Markdown

> 请将 docs/报告.md 导出为 Word，命名为“项目报告.docx”。使用 word_export，开启 strict；完成后返回实际文件路径，并说明所有警告。

### 从资料生成报告并交付

> 请根据当前项目资料整理一份项目进展报告，包含背景、已完成事项、问题与下一步计划，用表格汇总任务。先保存为 docs/项目进展.md，再使用 word_export 严格导出为“项目进展报告.docx”。检查导出结果，返回实际路径和需要我关注的问题。

### 在方案中加入图表

> 请编写一份系统接入方案，包含中文 Mermaid 流程图和时序图，保存 Markdown 后使用 word_export 严格导出 Word。如果返回图中文字过小的提示，请根据对应行号简化标签或拆分图表，再重新导出。

默认项目模式下，文件位于**运行 DSH 的机器上、当前会话项目的 `output/` 目录**。即使输入位于 `docs/` 子目录，输出也仍在项目 `output/`。已有同名文件时自动追加编号，Agent 应返回工具给出的真实路径。

## 为 Agent 工作流设计

一次调用接收一个 Markdown 文件或一段正文，返回可由 Agent 继续处理的结构化结果。文件输入示例：

```json
{
  "source": { "kind": "file", "path": "docs/报告.md" },
  "fileName": "项目报告.docx",
  "strict": true
}
```

工作流程是：**生成或修改 Markdown → 调用导出 → 检查结果与警告 → 修正内容后再次导出 → 交付实际文件**。内容撰写、诊断处理与重试由调用方 Agent 完成，插件负责转换和反馈。

- `strict: true` 遇到缺失图片、不支持的图表等内容降级时拒绝保存；默认值为 `false`。
- 普通模式允许保留替代文字或图表源码，并返回降级警告，适合排查问题。
- `MERMAID_SMALL_TEXT` 是可读性提示，严格模式仍可成功；Agent 应继续检查图表。
- 成功返回文件路径、实际文件名、大小、MIME 类型及 `warnings`。路径来自本地运行环境，不是下载链接。

严格模式通过表示未检测到内容降级，不代表文档事实正确或 Word 排版已验收。完整参数、诊断处理、附件模式与配置见 [Agent 接口与运行参考](docs/agent-reference.md)。

## 能转换哪些内容

| 内容 | 支持范围 |
| --- | --- |
| 正文与标题 | 段落、六级标题、粗体、斜体、删除线、链接 |
| 列表 | 有序与无序列表、五级编号样式、嵌套、指定起点与独立列表重启 |
| 结构化内容 | 表格、引用、行内代码、代码块、分隔线 |
| 图片 | PNG、JPEG、GIF、BMP；支持目录内相对路径和内嵌图片数据 |
| Mermaid | 流程图、状态图、时序图、类图、ER 图、XY 图的常用语法 |

图片相对源 Markdown 所在目录解析；直接传正文时，通过 `assetBaseDir` 指定相对图片目录。网络图片不会自动下载，SVG 输入不受支持。

Mermaid 使用本地轻量渲染器，不覆盖官方全部语法。饼图、甘特图以及部分配置和指令会触发未渲染警告。中文图表需要生成机器安装中文字体；宽图仍可能缩小到不易阅读，建议拆分。具体范围见 [图表参考](docs/agent-reference.md#mermaid-图表)。

原始 HTML 按文本保留。数学公式、脚注和任务复选框等扩展语法不作为原生 Word 功能转换；这些记法可能仅按普通文本输出，未必触发警告。

## 先用样例体验

仓库提供可直接导出的样例，方便检查自己的内容和运行环境：

| 样例 | 用途 |
| --- | --- |
| [综合测试](fixtures/综合测试.md) | 标题、格式、列表、表格、四种图片、六类图表及人工验收清单 |
| [异常降级测试](fixtures/异常降级测试.md) | 缺图、损坏数据、不支持的图表与严格模式失败行为 |
| [完整样式](fixtures/完整样式.md) | 集中查看中文正文、标题和列表排版 |
| [Mermaid 中文](fixtures/Mermaid中文.md) | 检查中文图表、长标签和混排效果 |

样例与配套图片位于源码仓库，不包含在 npm 安装包中。使用综合样例时，请保留 `fixtures/assets/` 的相对目录结构。

将仓库放入当前 DSH 项目后，可以直接告诉 Agent：

> 请使用 word_export 严格导出 fixtures/综合测试.md，返回实际文件路径和所有警告。随后对照源文件中的验收清单，说明哪些检查已经完成，哪些需要在 Word 中人工确认。

## 在其他 Agent 或脚本中使用

独立 CLI 可用于 DSH 之外的环境。给 Agent 的安装与使用指令：

> 请检查 Node.js 是否为 24，然后安装 dsh-md2word@0.1.4 的独立 CLI，将 docs/报告.md 严格导出为 Word。读取命令返回的 JSON，告诉我真实输出路径和警告；失败时说明错误码和原因。

对应命令：

```sh
npm install -g dsh-md2word@0.1.4
dsh-md2word docs/报告.md --strict -o output/项目报告.docx
dsh-md2word --help
```

CLI 支持文件输入，也支持以 `-` 从标准输入读取 Markdown；正文含相对图片时使用 `--asset-base-dir`。省略 `-o` 时输出到当前目录的 `output/`；显式指定输出目录时，其父目录须已存在。同名文件自动编号，无覆盖选项。

成功时 stdout 输出 JSON；失败时 stderr 输出结构化错误并返回非零退出码，方便 Agent 或脚本判断结果。

## 开发与验证

在 Node.js 24 下执行：

```sh
npm ci
npm run typecheck
npm test
npm run test:pack
npm run example
```

从源码导出综合样例：

```sh
npm run build
node lib/cli.js fixtures/综合测试.md --strict -o output/综合测试.docx
```

自动化测试覆盖转换内容、样式 XML、DSH 服务集成、资源限制、取消和独立安装包。Word 的实际分页、字体及视觉效果仍需人工检查，完整 Web/Desktop 交互验收也应单独进行。

[验证记录](docs/verification.md) · [GitHub Actions](https://github.com/bruc3van/dsh-md2word/actions) · [实施方案](docs/implementation-plan.md) · [发布说明](docs/releasing.md)

## 许可证与致谢

采用 [MIT](LICENSE) 许可证。转换样式及部分实现来自 Bruce-doc-converter，版权和参考版本见 [NOTICE](NOTICE)；包内附带所用组件的许可证说明。
