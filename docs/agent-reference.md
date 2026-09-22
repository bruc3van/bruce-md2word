# Agent 接口与运行参考

本文面向接入 `word_export` 的 Agent、插件管理员与维护者。产品介绍和安装入口见 [README](../README.md)。

## 环境与工具注册

当前包声明 Node.js `>=24 <25`、DSH 服务包 `0.1.5-rc.2` 或 `0.1.6-alpha.2`、Cordis `4.0.2`。这些是当前兼容范围，不表示自动兼容后续版本。

插件通过 `cordis.patch.yml` 加载，需要 `tools` 服务；默认项目模式还需要 `shell`，附件模式需要 `fs` 和 `attachments`。对应服务就绪后才注册 `word_export`；服务卸载会撤销工具、取消任务并等待清理，恢复后重新注册。`skills` 可选，服务可用且 `skill: true` 时自动注册导出使用说明。无需单独安装 Skill 或全局 CLI。

## word_export 输入与返回

`source` 必填，一次接收一个 Markdown 文件或一段正文。`fileName` 可选，只接受文件名，不接受目录；省略时使用源文件名或 `document.docx`。`strict` 默认 `false`，正式交付建议显式设为 `true`。

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

两种 `source` 互斥。文件支持 UTF-8（含 BOM）的 `.md` / `.markdown`。相对路径基于会话 `cwd`，没有会话时需管理员配置绝对 `workspaceRoot`。默认项目模式的输出位置固定为该项目的 `output/`，不跟随输入文件所在子目录。

默认项目模式的成功值包含 `path`、实际 `fileName`、`mimeType`、`sizeBytes` 和 `warnings`。例如重名后路径为 `output/项目报告 (1).docx`。文档在运行 DSH 的本机生成，直接从项目文件夹打开，不上传文件。可选附件模式的返回方式见下方配置说明。

严格模式仅拒绝 `severity: degradation` 的内容降级。`warnings` 中每项包含 `code`、`message`、`severity`，可附带源码 `line`。Agent 应读取实际返回值，不能自行拼接输出路径或下载链接。

## Agent 处理结果的约定

| 结果 | 建议动作 |
| --- | --- |
| 成功且无警告 | 返回实际文件路径；需要正式交付时继续检查 Word 版面 |
| `MERMAID_SMALL_TEXT` | 根据行号检查图表，简化标签或拆图后重新导出 |
| `IMAGE_UNAVAILABLE` | 检查相对路径、图片格式及完整性，修正源文件后重试 |
| `MERMAID_NOT_RENDERED` | 改用支持的图表类型或语法，检查普通模式保留的源码 |
| `CONTENT_INCOMPLETE` | 本次严格导出未保存；结合源文件排查缺图或不支持的图表，必要时用普通模式诊断，不将其产物当作完整交付 |

严格失败不保证同时返回逐项诊断；CLI 的失败结果包含结构化错误码和消息。普通模式会在成功结果中返回降级警告。

## Mermaid 图表

自动将 `mermaid` 代码块渲染为 2 倍像素 PNG，按比例嵌入 Word。采用经本包适配的 `beautiful-mermaid 1.1.3` 和已有的 `sharp`，无需 Chromium、浏览器或独立 CLI；安装依赖后全离线转换，不加载在线字体。

支持流程图、状态图、时序图、类图、ER 图和 XY 图的常用语法。轻量渲染器的布局、主题及语法覆盖与官方 Mermaid 不完全一致。饼图、甘特图等未支持类型，以及初始化配置、前置配置、click 指令、ER 字段注释会在文档中显示未渲染说明、保留代码并报告 `MERMAID_NOT_RENDERED`；`strict` 模式拒绝保存。不承诺识别官方语法的所有不兼容细节。

中文使用生成机器的本地字体，优先 PingFang SC、Microsoft YaHei、Noto Sans CJK SC 等。Linux 无中文字体时需要自行安装。图片嵌入后，接收文档的机器无需相同字体。流程图和状态图的普通节点、连线长标签会在布局前自动换行，保留英文单词和已有换行；含内联格式标签的文本保持原样。其他图类型仍可用 `<br>` 显式换行。中文类成员按宽字符估算所需类框宽度。很宽的图仍会缩小到页面宽度，宜简化布局或拆图。

`MERMAID_SMALL_TEXT` 表示按最终放置比例估算的最小字号低于 8 pt，带源码行号。它是可读性信息，不表示内容缺失，因此不会触发 `strict` 拒绝保存；用户仍需检查排版。不会自动改变图方向或拆分连接关系。

渲染器修正在构建时应用，版本与替换位置均有校验，不修改用户 node_modules 或 DSH 源码。适配后的渲染器及其依赖打包在约 3.4 MiB 的单个文件中，许可证见包内 `lib/MERMAID-LICENSES.txt`。

图表与普通图片共享数量、像素、字节和输出预算，单图 Mermaid 源码上限 50 KB。渲染在现有 worker 中进行，沿用任务超时和取消机制。示例见 [Mermaid 中文样例](../fixtures/Mermaid中文.md)。

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

`delivery: attachment` 使用 DSH `attachments.saveFile`，成功值返回不透明 `attachment` 引用，展示输出为标准 FileBlock；不返回 `path`。此模式需要附件服务。headless 消费方通过 `attachments.readFileStream(ref)` 取得字节。当前仓库记录的宿主验证未完成通用附件下载体验验收，因此保存成功不等于 Web/Desktop 已完成下载。

取消和卸载会取消执行器任务或附件模式的 worker，并等待清理。CLI 收到 SIGINT/SIGTERM 时也会取消转换。若取消恰好发生在文件或附件提交之后，调用可能返回取消，但已提交产物仍保留；插件不删除已发布文件或附件服务管理的对象。

## 图片与样式细节

- 图片只允许内嵌数据或图片目录内的相对路径；不获取网络图片，不接受绝对路径、file URI 或越界符号链接。
- 文件输入的图片基准目录是源 Markdown 所在目录；正文输入使用 `assetBaseDir`。
- GIF 使用第一帧；BMP 支持未压缩的 24/32 位 BITMAPINFOHEADER 格式。其余格式或损坏图片保留替代文字并报告降级。
- 样式沿用 Bruce-doc-converter，包括正文、六级标题、五级列表、代码、引用、表格、分隔线与图片。表格使用明确列宽，单元格图片限制在列宽内；支持独立列表重启和指定起始编号。
- 固定基准测试比对样式定义与生成的 XML，参考 [样式基准](../fixtures/reference/README.md)；XML 一致不等于 Word 分页和视觉验收通过。

## 验证边界

自动化测试覆盖转换、实际 DSH 服务和独立安装包，不等同于完整 Web/Desktop 交互、真实受限沙箱或 Word 视觉验收。平台与版本记录见 [验证记录](verification.md)。

Windows 普通权限下使用目录 junction 验证路径越界防护。独立的文件符号链接测试需要开发者模式或创建符号链接权限；本地缺少权限时明确标记跳过，CI 缺少权限则失败。
