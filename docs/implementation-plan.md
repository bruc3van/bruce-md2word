# dsh-md2word 实施方案

> 2026-09-21 交付方式调整：不修改 `deepseek-harness` 仓库。根据用户提出的项目文件保存和 CLI 方向，包内提供独立 CLI，DSH 插件通过 `ctx.shell` 调用它，沿用执行环境、会话 cwd、沙箱策略和取消信号；正文及路径通过 stdin JSON 传递。项目模式默认保存到 `output/`，同名自动编号，不覆盖。CLI 支持 `input.md -o output.docx` 和 stdin 正文。原附件交付保留为管理员可选 `delivery: attachment`。本调整替代原方案中的“仅附件交付”“不做指定目录导出”“无需外部转换 CLI”：CLI 为同包入口，共用转换核心，不依赖其他转换程序；插件不直接写宿主文件、不增加 Client 卡片。插件使用包内 CLI 和 DSH 的 Node 24 运行时在本机生成，不需要全局安装 CLI，也不涉及远程生成或上传。其他转换、预算、取消及验证要求保持；补充 CLI 独立安装和通过 DSH 执行服务调用的验收。

## 项目目标

开发一个原生 DSH 插件，将 Markdown 文件或正文转换为可编辑的 DOCX，通过 DSH 文件附件交付给用户。

- 项目、仓库和拟发布 npm 包名：`dsh-md2word`。
- 原生工具：`word_export`。
- TypeScript / ESM，一个仓库、一个 npm 包，通过 Cordis bundle 加载。
- 转换使用包内 API，无需外部转换 CLI、Python 或系统 Office。
- 首版支持单文档转换；Mermaid 图形渲染、SVG、模板编辑、批量和指定目录导出留待后续。

## 开发依据

### DSH 插件开发

参考 `deepseek-harness` 仓库源码，首先阅读 `docs/architecture.md`，并核对：

- `docs/cookbook/adding-a-tool.md`：工具定义与展示。
- `packages/core/tools/src/index.ts`：执行、错误和取消契约。
- `packages/fs/fs/src/index.ts`、`types.ts`：文件访问接口。
- `packages/fs/tool-fs/src/session-cwd.ts`：会话工作目录。
- `packages/attachment/attachment/src/index.ts`、`types.ts`：文件附件保存与引用。

### Markdown → Word 转换

参考 `bruce-doc-converter` 仓库的 Markdown → Word 转换逻辑，实际实现位于 `bruce_doc_converter/md_to_docx/`，行为测试位于 `tests/md_to_docx.test.js`。

实施时记录参考仓库的版本，接口以目标 DSH 源码为准。提取代码保留许可和版权信息；发布包独立运行，不依赖上述本地路径。

## 工具设计

```ts
type Source =
  | { kind: 'file'; path: string }
  | { kind: 'markdown'; text: string; assetBaseDir?: string };

interface WordExportInput {
  source: Source;
  fileName?: string;
  strict?: boolean; // 默认 false
}
```

使用 DSH `defineTool` 参数 DSL 表达互斥输入，执行时补充非空字符串、文件名和跨字段校验。

### 输入规则

- 文件模式接受 UTF-8 `.md` / `.markdown`，允许 BOM；图片相对源文件目录解析。
- 正文模式直接接收 Markdown，相对图片需提供 `assetBaseDir`；否则仅接受内嵌图片。
- 相对路径基于本次 `exec.agent?.session.header.cwd`。非会话调用使用管理员配置的绝对 `workspaceRoot`；没有有效目录来源时返回配置错误。
- `fileName` 仅作为附件显示名，拒绝路径和非法字符，统一 `.docx` 后缀；默认为源文件同名或 `document.docx`。
- 空白正文返回 `EMPTY_INPUT`。

### 转换能力

支持标题、正文、强调、链接、有序/无序列表、代码块、引用、表格、分隔线，以及 PNG、JPEG、GIF、BMP 本地或内嵌图片。

原始 HTML 按文本保留。远程图片不自动下载；不支持或损坏的图片保留替代文字并报告降级。Mermaid 块保留为代码并报告未渲染。

普通模式交付可转换内容并返回诊断；`strict` 遇到内容丢失或降级时拒绝保存附件。信息提示不触发 strict。

### 输出与错误

成功值包含：

- `attachment`：宿主 `FileAttachmentRef`。
- `fileName`、`mimeType`、`sizeBytes`：实际产物信息。
- `warnings`：含稳定 code、message、影响等级及可确定来源位置的诊断。

`output.schema` 校验成功值，`output.render` 输出简明说明和 `{ type: 'file', attachment }`。附件标识保持不透明，不拼接成本地路径或下载 URL，不返回 DOCX base64。

失败抛出类型化错误，使宿主返回 `isError`。保留原生 `FsError`、`AttachmentError`；业务错误包括 `EMPTY_INPUT`、`IMAGE_UNAVAILABLE`、`CONTENT_INCOMPLETE`、`LIMIT_EXCEEDED`、`BUSY`。取消使用宿主的取消语义。诊断数量和长度设上限，不回显完整 data URL。

## 架构

保留 markdown-it + jsdom + docx 转换路径，先迁移既有语义及测试。

```text
DSH word_export
  → 参数和访问校验
  → ctx.fs 读取 Markdown
  → worker 解析 Markdown，生成 HTML 与图片引用清单
  → ctx.fs 读取图片 / 解码内嵌图片
  → 同一 worker 将 HTML 和图片映射转换为 DOCX
  → 校验产物、strict 和取消状态
  → ctx.attachments 保存文件
  → 返回附件及诊断
```

必需宿主能力：`tools`、`fs`、`attachments`；`skills` 可选。DSH 相关包使用 peerDependencies，版本范围由实际加载测试确定。Node 24 LTS 为主要验证目标，其他版本通过测试后再声明支持。

```text
dsh-md2word/
  src/
    index.ts
    skill.ts
    tools/word-export.ts
    core/
      convert.ts
      markdown.ts
      html-to-docx.ts
      styles.ts
      diagnostics.ts
    runtime/
      worker-entry.ts
      worker-client.ts
      assets.ts
      paths.ts
      artifact.ts
  tests/
  fixtures/
  docs/implementation-plan.md
  cordis.patch.yml
  package.json
  package-lock.json
  tsconfig.json
  README.md
  LICENSE
```

转换核心接收正文和资源数据，返回字节与诊断，不执行文件读写。worker 两阶段传递可序列化消息；HTML 保留在 worker 内，图片清单来自正式 Markdown 解析，覆盖表格、列表中的图片。不得跨线程传递 DOM、docx 实例、函数或 AbortSignal。

worker 编译为 JS，随 npm 包发布，按 `import.meta.url` 定位。取消由外层监听并终止 worker。

## 代码提取

| 源模块 | 提取内容 |
| --- | --- |
| `md_to_docx/index.js` | DOCX 构建流程 |
| `markdown-converter.js` | Markdown 语法规则、`html:false`，解除 Mermaid 强制依赖 |
| `html-converter.js` | HTML → docx；状态改为单次转换上下文，图片改由字节映射提供 |
| `styles.js` | 样式和编号 |
| 原 DSH 插件 | 工具可逆注册和 guidance skill 的实现方式 |
| `tests/md_to_docx.test.js` | 编号、链接、转义、代码、图片等语义测试 |

文件输出部分按附件交付重新实现，不迁移原 CLI、命令 runner、安装工具和运行时缓存管理。

## 文件与资源管理

通过 `ctx.fs` 的 resolve、contains、stat、readBytes 等接口访问输入，传递取消信号和读取上限。不得解析 `FsTarget.targetKey`，或把 provider 的路径直接用于宿主本地 fs。

文件访问限制在会话工作目录或管理员允许的读取根内，遵循宿主策略。图片进一步限制在源文件目录或 `assetBaseDir`；拒绝绝对图片路径、file URI 和越界引用。符号链接与路径规范化按 provider 语义处理。

首版完整验证本地 provider；远端 provider 验证路径与能力后再声明支持。

初始预算（根据基准调整）：

| 资源 | 上限 |
| --- | --- |
| UTF-8 正文 | 5 MiB |
| 单张图片 | 20 MiB |
| 图片总量 / 数量 | 100 MiB / 100 张 |
| 单张图片尺寸 | 40 MP，任一边不超过 16,384 像素 |
| DOCX 输出 | 100 MiB |
| 单任务时间 | 120 秒，包含排队 |
| 每实例并发 / 等待队列 | 1 / 8 |

实际读取与解码过程执行限制，stat 仅作预检。队列满返回 BUSY。附件保存前由插件执行输出大小限制。

## 生命周期与交付

任务 deadline 与宿主取消信号合并。取消、异常和卸载均停止 worker、等待退出并释放资源；卸载先停止接收新任务，再取消本实例任务。所有工具和 skill 注册使用 Cordis 可逆生命周期。

附件保存前检查 DOCX ZIP、主文档、关系与媒体引用，并检查 strict 和取消状态。使用宿主 `saveFile` 或经验证的 `saveFileStream`，不绕过不支持文件保存的 provider。

保存后的取消可能被 DSH 转为 `TOOL_ABORTED`，导致附件未进入成功工具结果。已保存对象归附件服务管理，插件不自行删除底层文件；该取消窗口可能产生未被会话引用的对象，需在测试和文档中明确。

输出展示函数保持纯函数，附件引用进入持久化结果。首版使用标准工具展示及附件能力，不实现专用 Client 卡片。

当前参考源码中的 `ctx.fs` 没有通用二进制写入接口，因此首版采用附件交付。指定目录导出需要另行核实宿主支持，不纳入本次实现。

## 实施计划

| 阶段 | 预计投入 | 验收 |
| --- | --- | --- |
| 1. 宿主贯通 | 1–2 人日 | bundle 加载/卸载、工具参数、会话目录、文件读取、DOCX 附件保存及用户取得文件 |
| 2. 核心提取 | 2–3 人日 | 两种输入、两阶段图片处理、编号/链接/表格/代码/图片回归 |
| 3. 生命周期 | 1–2 人日 | worker、队列、预算、strict、失败、取消和卸载 |
| 4. 发布验收 | 1–2 人日 | npm pack 隔离安装、支持的 Node/DSH 组合、三平台冒烟、实际 Word 打开检查 |

预计 **5–9 人日**，以宿主附件交付能力可直接复用为前提。若需要宿主或 Client 改动，阶段 1 单独评估依赖工作。

第一个里程碑：在真实 DSH 中调用 `word_export`，把 Markdown 正文生成用户可取得的 DOCX 附件。

## 必须验证的事项

- 工具文件内容块能否被目标 DSH 接纳；Web/Desktop 中附件能否下载，重放后能否访问，headless 如何消费引用。
- 所声明版本的插件安装、加载、卸载与错误行为。
- worker 从发布包运行，离开源码目录仍可转换。
- 读取限制、越界图片、缺图、strict，以及附件保存前后取消竞争。
- Windows/macOS/Linux 的转换冒烟；目标 Word 中的中文样式、列表、表格、图片与分页。

分别记录源码测试、发布包测试、宿主端到端测试及 Word 视觉验收。首阶段附件交付未贯通前，不将保存成功视为用户已取得文件。
