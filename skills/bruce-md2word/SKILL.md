---
name: bruce-md2word
slug: bruce-md2word
version: 0.6.6
displayName: Markdown 转 Word
summary: 将 Markdown、报告和方案导出为 Word，支持中文排版、Mermaid 图表和可编辑数学公式；需要 Node.js 24 或 26。
license: MIT
homepage: https://github.com/bruc3van/bruce-md2word
tags:
  - markdown
  - word
  - docx
  - mermaid
  - office
description: 使用本地 bruce-md2word CLI 将 Markdown 或新撰写的报告、方案导出为 Word，支持中文排版、Mermaid 图表和可编辑数学公式。适用于要求交付 DOCX 的任务；不用于读取或修改已有 Word、PDF 转换或自定义 Word 模板。
---

# Markdown 导出 Word

通过命令执行工具调用 `bruce-md2word`，将 Markdown 转为本地 `.docx`。本 Skill 不依赖 DSH 服务；若当前环境已提供 `word_export` 工具（DSH 插件），直接使用该工具，无需准备 CLI。

## 准备 CLI

每个会话首次使用时准备一次，之后的导出不再重复检查：

1. 运行 `bruce-md2word --version`（项目安装时用 `node "node_modules/bruce-md2word/lib/cli.js" --version`）确认已安装版本。
2. 联网可用时运行 `npm view bruce-md2word@latest version engines --json` 检查更新，按语义版本比较。
3. 全局安装落后于稳定版且当前 Node.js 满足 `engines` 时，更新到该版本并告诉用户版本变化；项目依赖或用户指定的版本只提示有新版本，不擅自改动依赖和锁文件。
4. 离线、查询失败或宿主策略不允许更新时，继续使用已有版本并说明未更新。

命令不存在、需要安装或更新时，阅读 [安装与版本检查](references/install.md)，遵守宿主的安装审计、执行权限及用户指定的版本、安装位置和离线要求。运行环境为 Node.js 24 或 26。

## 导出流程

1. 已有 Markdown 时使用原文件；从资料撰写时，先保存为 UTF-8 的 `.md` 文件，保留可修改的源稿。使用用户要求的内容与文件名。
2. 在用户项目目录执行命令，引用含空格或中文的路径。正式交付默认开启严格模式：

   ```sh
   bruce-md2word "docs/报告.md" --strict -o "output/项目报告.docx"
   ```

   省略 `-o` 时保存到当前工作目录的 `output/`；`-o` 以 `/` 结尾时视为目录并沿用默认文件名。输出目录不存在时只会创建最后一级，其父目录必须已存在。文件图片相对源 Markdown 所在目录解析，保持图片位于该目录内；不要为文件输入传 `--asset-base-dir`。

3. 同时检查退出码、stdout 和 stderr。成功退出码为 0，stdout 是 JSON，包含 `protocol`、`path`、`fileName`、`mimeType`、`sizeBytes`、`warnings`。失败为非零退出码，stderr 的 JSON 包含 `error.code` 和 `error.message`；严格失败（`CONTENT_INCOMPLETE`）还包含逐项的 `error.diagnostics`。启动失败或包管理器错误可能不是 JSON，保留真实错误。
4. 检查所有警告和诊断，按需阅读 [诊断处理](references/diagnostics.md)。严格失败时根据 `error.diagnostics` 的代码和行号修正源稿，再重新严格导出；不擅自关闭严格模式作为最终交付。相同原因重复失败且没有新修正依据时停止重试，说明需要补充的素材或环境条件。
5. 检查返回路径对应文件存在且非空，交付实际 `path` 和需要关注的警告。同名文件自动编号，不能根据请求的文件名推测最终路径。文件在命令运行机器上；只有宿主提供附件能力时才附加文件，不编造下载链接。

严格成功只表示未检测到内容降级，不代表事实正确或版面验收通过。若未实际打开或渲染文档，明确说明尚未检查分页和视觉效果。

## 排版选项

默认中文报告排版，无需任何指令。需要预设、目录、页码、页眉页脚或标题编号时，在文档第一个内容块单独放一行配置：

```markdown
<!-- word:document {"preset":"technical","toc":true,"pageNumbers":true} -->
```

预设为 `chinese-report`（默认风格）或 `technical`。字体/字号/边距覆盖、图表题注与交叉引用、宽表横向分节、表格列宽、列表续号和脚注见 [排版说明](references/document-layout.md)。用户未要求时保持默认排版。目录和引用须在 Word/WPS 更新域后验收。

## 输入与能力边界

- 优先文件输入，避免终端管道改变中文编码或解释正文中的 `$`、反引号等字符。必要时可以用 `-` 读取 UTF-8 标准输入，并用 `--asset-base-dir "图片目录"` 指定正文中的相对图片目录；通过执行工具的标准输入传递正文，不将正文拼进 shell 命令。
- 正文、标题、列表、表格保持可编辑。不支持自定义 Word 模板接口。
- PNG、JPEG、GIF、BMP 图片可嵌入，动图只保留首帧并报告降级；网络图片不会自动下载，SVG 输入不支持。不要把网络图片或越界路径当作已嵌入成功。
- Mermaid 流程图、状态图、时序图、类图、ER 图、XY 图的常用语法转为 PNG；不覆盖官方全部语法。横向流程图若缩放后文字过小，工具可能保留节点和连线、自动改为纵向布局并返回 `MERMAID_LAYOUT_ADJUSTED` 信息提示；流程图和状态图还可能放大图内字号并返回 `MERMAID_TEXT_ENLARGED`。宽图可放入横向分节以获得更大的显示宽度。仍过小的宽图应按含义简化或拆分，不能为通过检查随意删除关系。流程图支持节点字号、节点/连线虚线和常用 init/YAML 主题颜色；`MERMAID_STYLE_UNSUPPORTED` 表示部分样式未应用，为信息提示；无法解析的流程图语句会保留源码并报告 `MERMAID_NOT_RENDERED`。
- LaTeX 行内及块公式转为可编辑 Word 原生公式；自定义宏、公式编号与引用等不支持。每次导出最多 1000 个公式、1000 个脚注定义，超出时整体返回 `LIMIT_EXCEEDED`（不会降级保存），长文档需拆分后分别导出。不支持的公式或图表可能保留源码并产生降级警告。
- 命名脚注转换为 Word 原生脚注，重复引用使用 NOTEREF 域；未定义、重复或嵌套脚注会报告诊断。任意 HTML 和任务复选框仍按普通文本处理，不以严格成功证明版面验收通过。
