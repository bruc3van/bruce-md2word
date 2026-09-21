# 原版样式回归基准

提取自 `bruce-doc-converter` 的 `bruce_doc_converter/md_to_docx/styles.js`、`html-converter.js`，版本 `5bcfa6d170debb7d36580c2ab833c506459dca67`，MIT / Copyright (c) 2026 Bruce。

`bruce-styles.json` 保留原样式选项、编号和用于渲染的 HTML。XML 由该版本转换器配合本项目 docx 9.7.1 生成；不依赖开发机上的参考仓库运行测试。

回归覆盖默认字体、六级标题、字符样式、代码、引用、链接、Emoji、表格、分隔线及页边距。表格沿用原版满版宽度的视觉设置，但使用明确的 DXA 列宽和单元格宽度保证兼容性；单元格内图片不超出单元格。列表继续支持显式起始编号及独立列表重启。
