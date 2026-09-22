# dsh-md2word

Markdown → Word CLI 和原生 DeepSeek Harness 插件。CLI 可以独立使用；插件通过 DSH 执行服务调用 CLI，默认保存到**当前会话项目的 `output/` 目录**，返回实际路径。同名文件自动追加编号，不覆盖已有文件。

转换在包内完成，不需要 Python、Office 或外部转换 CLI。不修改 DeepSeek Harness 源码，不添加专用 Client 卡片。

## 安装

目标环境：Node.js 24、DSH 服务包 `0.1.5-rc.2` 或 `0.1.6-alpha.2`、Cordis `4.0.2`。

从 [npm](https://www.npmjs.com/package/dsh-md2word) 安装到 DSH：

```sh
dsh plugin --profile web add dsh-md2word@0.1.4
```

如果使用 `npx` 启动 DSH：

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile web add dsh-md2word@0.1.4
```

将 `web` 换成实际使用的 profile。也可以直接发送给 Agent：

> 请将 dsh-md2word@0.1.4 安装到我的 DSH web profile，使用官方 plugin add 命令；安装后提醒我重启服务。

安装后重启对应 profile。包的 `cordis.patch.yml` 加载插件；需要 `tools` 服务，项目模式还需要 `shell`，附件模式需要 `fs` 和 `attachments`。对应服务就绪后才注册 `word_export`；服务卸载会撤销工具、取消任务并等待清理，恢复后重新注册。`skills` 可选，存在时自动注册使用说明。插件默认调用包内 CLI，复用 DSH 的 Node 运行时，无需另行全局安装。

## 独立 CLI

如需脱离 DSH 单独使用，可执行 `npm install -g dsh-md2word@0.1.4` 安装命令：

```sh
dsh-md2word docs/报告.md -o output/项目报告.docx
dsh-md2word docs/报告.md --strict
printf '# 示例\n\n正文' | dsh-md2word - -o 示例.docx
dsh-md2word --help
```

`-` 从标准输入读取正文，`--asset-base-dir` 指定其图片目录。文件模式的图片始终相对源文件目录。省略 `-o` 时保存到当前目录下的 `output/`。CLI 可以保存到明确指定的目录，但该目录的父目录必须存在；无覆盖选项。成功在 stdout 输出 JSON，失败在 stderr 输出结构化错误并以非零状态退出。

## 使用

在 DSH 会话中直接提出需求：

> 请把 docs/报告.md 导出为 Word，保存为“项目报告.docx”。使用 word_export，开启 strict，完成后告诉我文件路径和所有警告。

也可以先生成 Markdown，再导出：

> 请生成一份中文项目报告，包含标题、列表、表格，以及带中文标签的 Mermaid 流程图。先保存为 docs/报告.md，再使用 word_export 导出 Word。检查返回的警告；如果图中文字过小，拆分或简化图表后重新导出。

工具接口示例：

```json
{
  "source": { "kind": "file", "path": "docs/报告.md" },
  "fileName": "项目报告.docx"
}
```

```json
{
  "source": {
    "kind": "markdown",
    "text": "# 项目报告\n\n这是 **重点**。",
    "assetBaseDir": "."
  },
  "strict": true
}
```

两种 `source` 互斥。文件支持 UTF-8（含 BOM）的 `.md` / `.markdown`。相对路径基于会话 `cwd`，没有会话时需管理员配置绝对 `workspaceRoot`。输出位置固定为该项目的 `output/`，不跟随输入文件所在子目录。

成功值包含 `path`、实际 `fileName`、`mimeType`、`sizeBytes` 和 `warnings`。例如重名后路径为 `output/项目报告 (1).docx`。文档在运行 DSH 的本机生成，直接从项目文件夹打开，不上传文件。

## 转换范围

支持标题、段落、强调、链接、有序和无序列表、代码、引用、表格、分隔线，以及 PNG/JPEG/GIF/BMP 图片。采用 A4 页面，正文中文字体为宋体、标题为黑体；实际显示取决于打开文档的系统字体。

样式完整迁自 Bruce-doc-converter：正文与六级标题的字体、字号、行距、缩进和段间距，五级列表编号，以及代码、引用、表格、分隔线、图片的格式均沿用原版设置。固定基准测试比对原版样式定义与生成的 XML。表格使用明确列宽，单元格图片限制在列宽内；保留独立列表重启和指定起始编号的支持。完整样式示例见 [fixtures/完整样式.md](fixtures/完整样式.md)。

- 文件模式的图片相对源 Markdown 目录；正文模式的相对图片需要 `assetBaseDir`。
- 图片只允许内嵌数据或图片目录内的相对路径；不获取网络图片，不接受绝对路径、file URI 或越界符号链接。
- 原始 HTML 按文本保留；Mermaid 代码块支持本机渲染，范围见下文。
- GIF 使用第一帧；BMP 支持未压缩的 24/32 位 BITMAPINFOHEADER 格式。其余格式或损坏图片保留替代文字并报告降级。
- `strict: true` 遇到降级时不保存；信息提示不触发 strict。诊断数量及消息长度有上限。

## Mermaid 图表

自动将 `mermaid` 代码块渲染为 2 倍像素 PNG，按比例嵌入 Word。采用经本包适配的 `beautiful-mermaid 1.1.3` 和已有的 `sharp`，无需 Chromium、浏览器或独立 CLI；安装依赖后全离线转换，不加载在线字体。

支持流程图、状态图、时序图、类图、ER 图和 XY 图的常用语法。轻量渲染器的布局、主题及语法覆盖与官方 Mermaid 不完全一致。饼图、甘特图等未支持类型，以及初始化配置、前置配置、click 指令、ER 字段注释会在文档中显示未渲染说明、保留代码并报告 `MERMAID_NOT_RENDERED`；`strict` 模式拒绝保存。不承诺识别官方语法的所有不兼容细节。

中文使用生成机器的本地字体，优先 PingFang SC、Microsoft YaHei、Noto Sans CJK SC 等。Linux 无中文字体时需要自行安装。图片嵌入后，接收文档的机器无需相同字体。流程图和状态图的普通节点、连线长标签会在布局前自动换行，保留英文单词和已有换行；含内联格式标签的文本保持原样。其他图类型仍可用 `<br>` 显式换行。中文类成员按宽字符估算所需类框宽度。很宽的图仍会缩小到页面宽度，宜简化布局或拆图。

`MERMAID_SMALL_TEXT` 表示按最终放置比例估算的最小字号低于 8 pt，带源码行号。它是可读性信息，不表示内容缺失，因此不会触发 `strict` 拒绝保存；用户仍需检查排版。不会自动改变图方向或拆分连接关系。

渲染器修正在构建时应用，版本与替换位置均有校验，不修改用户 node_modules 或 DSH 源码。适配后的渲染器及其依赖打包在约 3.4 MiB 的单个文件中，许可证见包内 `lib/MERMAID-LICENSES.txt`。

图表与普通图片共享数量、像素、字节和输出预算，单图 Mermaid 源码上限 50 KB。渲染在现有 worker 中进行，沿用任务超时和取消机制。示例见 [fixtures/Mermaid中文.md](fixtures/Mermaid中文.md)。

## 配置

通过 DSH 的插件配置设置以下字段：

| 字段 | 默认值 / 含义 |
| --- | --- |
| `workspaceRoot` | 非会话调用的绝对项目目录 |
| `allowedReadRoots` | `[]`，额外允许读取的绝对目录；不扩展输出范围 |
| `delivery` | `project`；可选 `attachment` |
| `cliCommand` | 默认调用包内 CLI；管理员可指定其他本机命令 |
| `skill` | `true`，注册可选使用说明 |
| `maxMarkdownBytes` | 5 MiB |
| `maxImageBytes` / `maxTotalImageBytes` | 20 MiB / 100 MiB |
| `maxImages` | 100 |
| `maxImagePixels` / `maxImageDimension` | 40 MP / 单边 16384 像素 |
| `maxOutputBytes` | 100 MiB |
| `timeoutMs` | 120000，包含排队时间 |
| `concurrency` / `queueSize` | 1 / 8，每个插件实例独立 |
| `maxDiagnostics` | 100 |

数值配置均为安全整数：`queueSize` 允许 0，其他字段至少为 1；`timeoutMs` 不超过 2147483647。配置 Schema 同时提供范围、步长和字段说明，加载时还会检查绝对路径与 CLI 命令。

项目模式通过 `ctx.shell` 执行 CLI，传入会话工作目录、取消信号和当前沙箱策略；正文、路径及转换参数通过标准输入 JSON 传递，不拼接为 shell 命令。转换在运行 DSH 的本机完成。默认使用包内 CLI 和 DSH 的 Node 运行时，不引入远程转换服务。

CLI 在执行环境中读取文件、运行转换 worker，完成写入后才原子发布 DOCX；不覆盖文件，需要文件系统支持硬链接。拒绝符号链接输出目录。插件不直接使用宿主 Node 文件 API 写入项目。沙箱执行失败不会自动退回无沙箱执行。

`delivery: attachment` 使用 DSH `attachments.saveFile`，成功值返回不透明 `attachment` 引用，展示输出为标准 FileBlock；不返回 `path`。此模式需要附件服务。headless 消费方通过 `attachments.readFileStream(ref)` 取得字节。目标 DSH 通用工具 UI 尚无附件下载按钮，因此保存成功不等于 Web/Desktop 已完成下载。

取消和卸载会取消执行器任务或附件模式的 worker，并等待清理。CLI 收到 SIGINT/SIGTERM 时也会取消转换。若取消恰好发生在文件或附件提交之后，调用可能返回取消，但已提交产物仍保留；插件不删除已发布文件或附件服务管理的对象。

## 开发与验证

```sh
npm ci
npm test             # 转换、DSH 服务集成、资源和生命周期测试
npm run test:pack    # tarball 在独立目录安装并运行 worker
npm run example      # 生成 output/示例.docx
```

测试使用实际发布的 DSH 工具、文件、附件和执行服务；不等同于完整 Web/Desktop 端到端验收。自动化测试覆盖转换、实际 DSH 服务和独立安装包；各平台 CI 状态见 [GitHub Actions](https://github.com/bruc3van/dsh-md2word/actions)。Windows 本机执行记录见 [验证记录](docs/verification.md)，Microsoft Word 的分页、视觉效果仍需人工验证。

Windows 普通权限下使用目录 junction 验证路径越界防护。独立的文件符号链接测试需要开发者模式或创建符号链接权限；本地缺少权限时明确标记跳过，CI 缺少权限则失败，避免把未执行的断言计为通过。

设计与交付调整见[实施方案](docs/implementation-plan.md)。参考实现及版权见 [NOTICE](NOTICE)，许可证为 [MIT](LICENSE)。

发布步骤与 npm Trusted Publishing 配置见 [发布说明](docs/releasing.md)。
