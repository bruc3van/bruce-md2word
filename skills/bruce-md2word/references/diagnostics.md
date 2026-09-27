# CLI 诊断处理

成功结果的 `warnings` 每项有 `code`、`message`、`severity`，可能带源码 `line`；行号用于定位 Markdown，消息以实际输出为准。失败结果写入 stderr，形如：

```json
{"protocol":1,"error":{"code":"CONTENT_INCOMPLETE","message":"...","diagnostics":[{"code":"IMAGE_UNAVAILABLE","message":"...","severity":"degradation","line":12}]}}
```

`severity: degradation` 会使严格模式失败；`severity: info` 不会。对于未知代码仍读取其消息和严重级别，不把未知警告忽略成成功无警告。

## 严格失败后定位问题

`CONTENT_INCOMPLETE` 表示本次严格导出未保存文档。`error.diagnostics` 与成功时的 `warnings` 字段和数量上限相同，直接据此修正源文件，再运行原来的 `--strict` 命令；`error.message` 最多 500 字符，不要只依赖它。

0.4.0 之前的 CLI 不返回 `error.diagnostics`。此时可以明确生成一份仅供诊断的普通模式文档读取 `warnings`：

```sh
bruce-md2word "docs/报告.md" -o "output/项目报告-诊断.docx"
```

诊断产物可能缺图、保留公式或图表源码，不作为完整交付；最终返回严格导出的真实路径。用户明确允许降级交付时，可以使用普通模式，但必须说明缺失或替代内容。

## 内容警告

| 代码 | 级别 | 处理方式 |
| --- | --- | --- |
| `IMAGE_UNAVAILABLE` | 降级 | 检查图片是否存在、格式及完整性、是否位于允许读取的目录。文件输入的图片相对 Markdown 目录解析；标准输入使用 `--asset-base-dir`。 |
| `IMAGE_FIRST_FRAME` | 降级 | 动图只嵌入了首帧。需要完整内容时换成静态图或拆成多张图。 |
| `MERMAID_NOT_RENDERED` | 降级 | 根据源码行号检查图表类型和语法；饼图、甘特图、部分配置或指令不支持。保持原意修改，无法等价表达时说明限制。 |
| `MATH_NOT_CONVERTED` | 降级 | 检查分隔符、公式语法和不支持的结构，保留数学含义。普通模式保留完整公式源码；不要把源码保留当成原生公式转换成功。 |
| `LINK_UNAVAILABLE` | 降级 | 文内链接没有匹配的标题、`#ref:id` 没有匹配的编号题注，或链接协议不安全已被移除。核对标题文字、题注 `id` 和链接地址。 |
| `LAYOUT_DIRECTIVE_INVALID` | 降级 | `<!-- word:... -->` 指令错误、错位或参数越界，已保留源文本。按 [排版说明](document-layout.md) 修正。 |
| `LIST_CONTINUATION_UNAVAILABLE` | 降级 | 命名列表或章节续号找不到可续接的实例，已按源 Markdown 新建列表。检查 `id`、缩进、起始编号和作用域。 |
| `LIST_DEPTH_REDUCED` | 降级 | 列表嵌套超过五层，深层已被压平。减少嵌套层级。 |
| `FOOTNOTE_UNDEFINED` / `FOOTNOTE_DUPLICATE` / `FOOTNOTE_NESTED` | 降级 | 补齐定义、合并重复定义或移除嵌套引用。不要自动删除脚注正文来让严格模式通过。 |
| `FOOTNOTE_TABLE_FLATTENED` | 降级 | 脚注中的表格已改为逐段排列。需要表格时移到正文。 |
| `FOOTNOTE_UNUSED` | 信息 | 未被引用的脚注定义保留在正文，确认是否遗漏引用。 |
| `MERMAID_SMALL_TEXT` | 信息 | 检查图表，简化标签或拆分后再导出，需要时检查实际版面。 |
| `MERMAID_LAYOUT_ADJUSTED` | 信息 | 横向流程图在 Word 中会太小，已改为纵向排布；节点与连线保留。检查最终页面，确认调整后的阅读顺序符合用途。 |
| `MERMAID_STYLE_UNSUPPORTED` | 信息 | 图表已生成，但部分主题变量、样式属性或字号/虚线值未应用；检查图表样式。 |
| `DIAGNOSTICS_TRUNCATED` | 随被截断项 | 警告已截断，不能声称已列出全部问题。先修正已知问题，再导出获取后续诊断。 |

## 错误代码

| 代码 | 处理方式 |
| --- | --- |
| `EMPTY_INPUT` / `INVALID_INPUT` | 检查输入内容、扩展名（`.md` / `.markdown`）、命令参数和输出文件名。 |
| `FS_NOT_FOUND` / `FS_NOT_REGULAR_FILE` / `FS_NOT_DIRECTORY` | 输入文件或图片目录不存在或类型不对。核对相对于当前工作目录的路径。 |
| `FS_NOT_TEXT` | 源文件不是有效 UTF-8，转换编码后重试。 |
| `FS_TOO_LARGE` / `LIMIT_EXCEEDED` | 查看消息，按内容含义拆分文档或降低图片大小与复杂度；可能是字节数、时间、内存、公式或脚注数量（各 1000 个）等上限，不盲目重复执行。 |
| `FS_SANDBOX_DENIED` | 输入越出允许读取的目录，或输出目录（含默认的 `./output`）是符号链接。改用真实目录或显式 `-o`。 |
| `FS_PERMISSION_DENIED` / `FS_IO_ERROR` | 检查输出目录权限和磁盘状态；同名文件过多时换一个文件名。 |
| `ABORTED` | 导出被中断信号取消（退出码 130），未保存文件；确认是否为用户或宿主主动取消，不自动重试。 |
| `CONFIGURATION_ERROR` / `CONVERSION_FAILED` | 保留实际错误，检查 Node.js 版本和依赖；无法定位时报告失败，不伪造产物路径。 |
