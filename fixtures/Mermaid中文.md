# Mermaid 中文渲染测试

本示例使用本机 Mermaid 渲染器生成 PNG，然后嵌入 Word。涵盖中文、英文混排、分支和换行。

## 中文流程图

```mermaid
flowchart TD
  A[收到导出请求] --> B{是否包含 Mermaid 图表？}
  B -->|是| C[本机渲染为高清图片]
  B -->|否| D[转换普通 Markdown]
  C --> E[嵌入 Word 文档]
  D --> E
  E --> F[保存到项目 output 文件夹]
```

## 中文时序图

```mermaid
sequenceDiagram
  participant U as 用户
  participant D as DSH 插件
  participant R as 本机渲染器
  U->>D: 导出项目报告（DOCX）
  D->>R: 中文 Mermaid 源码
  R-->>D: 返回 PNG 图片
  D-->>U: 文档已保存，无需上传
```

## 中文长标签与显式换行

```mermaid
flowchart LR
  A[项目资料<br/>中文与 English 混排] --> B[检查中文标点：逗号、句号。<br/>版本 v1.0 / 2026]
  B --> C[输出可编辑的 Word 文档<br/>图表以图片形式保留]
```

## 状态图

```mermaid
stateDiagram-v2
  [*] --> 待处理
  待处理 --> 转换中: 开始导出
  转换中 --> 已完成: 保存成功
  转换中 --> 已取消: 用户取消
  已完成 --> [*]
  已取消 --> [*]
```

## 类图

```mermaid
classDiagram
  class Report {
    +String 标题
    +String 内容
    +导出文档()
  }
  class Diagram {
    +String 源码
    +渲染图片()
  }
  Report --> Diagram : 包含图表
```

## 实体关系图

```mermaid
erDiagram
  USER ||--o{ REPORT : 创建
  REPORT ||--o{ DIAGRAM : 包含
  USER {
    string 用户姓名
  }
  REPORT {
    string 报告标题
  }
  DIAGRAM {
    string 图表源码
  }
```

## 中文统计图

```mermaid
xychart-beta
  title "每月文档导出数量"
  x-axis [一月, 二月, 三月, 四月]
  y-axis "文档数量" 0 --> 100
  bar [30, 55, 70, 90]
  line [20, 45, 65, 80]
```
