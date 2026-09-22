# README 展示截图

这三张图片来自本项目实际导出的 DOCX，使用 Windows 上的 Microsoft Word 原生渲染，由 officecli 截取第 1 页。未手工修改 Word 排版，也未使用 HTML 重绘或图片生成模型。

| 图片 | Markdown 来源 | 截取内容 |
| --- | --- | --- |
| [word-chinese.png](word-chinese.png) | [中文排版](../../fixtures/showcase/中文排版.md) | 分级标题、中文正文、列表、表格与引用 |
| [word-mermaid.png](word-mermaid.png) | [Mermaid 图表](../../fixtures/showcase/Mermaid图表.md) | 中文流程图与时序图 |
| [word-math.png](word-math.png) | [数学公式](../../fixtures/showcase/数学公式.md) | 分式、求和积分、矩阵、中文分段条件 |

## 复现

在 Windows、Node.js 24、Microsoft Word 和 officecli 可用的环境中，于项目根目录执行：

```powershell
npm run build
node lib/cli.js fixtures/showcase/中文排版.md --strict -o output/showcase-chinese.docx
node lib/cli.js fixtures/showcase/Mermaid图表.md --strict -o output/showcase-mermaid.docx
node lib/cli.js fixtures/showcase/数学公式.md --strict -o output/showcase-math.docx

officecli view output/showcase-chinese.docx screenshot --render native --page 1 -o docs/assets/word-chinese.png
officecli view output/showcase-mermaid.docx screenshot --render native --page 1 -o docs/assets/word-mermaid.png
officecli view output/showcase-math.docx screenshot --render native --page 1 -o docs/assets/word-math.png
```

若 output 中已有同名文件，CLI 会追加编号。截图命令必须使用本次转换 JSON 返回的实际路径，避免截到旧文档。

生成日期：2026-09-22。三个展示样例均通过严格导出，未返回警告。截图展示实际页面外观，不能代替 Word 中逐项编辑公式的交互验收；不同字体和阅读软件可能影响分页与显示。
