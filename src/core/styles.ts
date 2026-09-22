// Styles retained from bruce-doc-converter, revision recorded in NOTICE.
import { AlignmentType, BorderStyle, TabStopType, LevelFormat } from 'docx';
import type { IStylesOptions, INumberingOptions } from 'docx';
export const PAGE_WIDTH = 11906;
export const PAGE_HEIGHT = 16838;
export const MARGIN = 1417;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// Pixels at 96 DPI; leave room for paragraph spacing and table cell padding.
export const MAX_IMAGE_HEIGHT = 740;
export function charsToTwips(chars: number, fontSize = 12) {
  // 1 字符 ≈ 1 个字号大小
  // 1 pt = 20 twips
  return chars * fontSize * 20;
}

/**
 * 创建文档样式配置
 */
export function createStyles(): IStylesOptions {
  return {
    default: {
      document: {
        run: {
          font: "SimSun", // 宋体
          size: 24  // 12pt (半磅为单位: 12 * 2 = 24)
        },
        paragraph: {
          spacing: {
            line: 360  // 1.5倍行距
          },
          indent: {
            firstLine: 0  // 首行缩进仅由正文样式应用，避免污染列表和图片
          }
        }
      }
    },
    paragraphStyles: [
      { id: "BodyText", name: "Body Text", basedOn: "Normal", next: "BodyText", paragraph: { indent: { firstLine: charsToTwips(2) } } },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 44,  // 22pt
          bold: true,
          color: "000000"
        },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 360,  // 18pt before
            after: 240,   // 12pt after
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 32,  // 16pt
          bold: true,
          color: "000000"
        },
        paragraph: {
          spacing: {
            before: 360,  // 18pt
            after: 200,   // 10pt
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 30,  // 15pt
          bold: true,
          color: "000000"
        },
        paragraph: {
          spacing: {
            before: 300,  // 15pt
            after: 160,   // 8pt
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "Heading4",
        name: "Heading 4",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 28,  // 14pt
          bold: true,
          color: "000000"
        },
        paragraph: {
          spacing: {
            before: 240,  // 12pt
            after: 120,   // 6pt
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "Heading5",
        name: "Heading 5",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 26,  // 13pt
          bold: true,
          color: "000000"
        },
        paragraph: {
          spacing: {
            before: 200,  // 10pt
            after: 100,   // 5pt
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "Heading6",
        name: "Heading 6",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "SimHei",  // 黑体
          size: 24,  // 12pt
          bold: true,
          color: "6B7280"
        },
        paragraph: {
          spacing: {
            before: 160,  // 8pt
            after: 80,    // 4pt
            line: 240     // 单倍行距
          },
          indent: {
            firstLine: 0  // 标题不缩进
          }
        }
      },
      {
        id: "CodeBlock",
        name: "Code Block",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "Consolas",
          size: 22,  // 11pt
          color: "1F2937"
        },
        paragraph: {
          shading: {
            fill: "F5F5F5"
          },
          border: {
            top: {
              color: "D1D5DB",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 4
            },
            bottom: {
              color: "D1D5DB",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 4
            },
            left: {
              color: "D1D5DB",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 4
            },
            right: {
              color: "D1D5DB",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 4
            }
          },
          spacing: {
            before: 240,
            after: 240,
            line: 300
          },
          indent: {
            left: 240,
            right: 240,
            firstLine: 0  // 代码块不缩进
          }
        }
      },
      {
        id: "Quote",
        name: "Quote",
        basedOn: "Normal",
        next: "Normal",
        run: {
          color: "4B5563"
        },
        paragraph: {
          shading: {
            fill: "F9FAFB"
          },
          border: {
            left: {
              color: "6B7280",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 20
            }
          },
          spacing: {
            before: 240,
            after: 240
          },
          indent: {
            left: charsToTwips(2),  // 引用块整体左缩进2字符
            firstLine: 0            // 取消首行额外缩进
          }
        }
      }
    ],
    characterStyles: [
      {
        id: "InlineCode",
        name: "Inline Code",
        basedOn: "DefaultParagraphFont",
        run: {
          font: "Consolas",
          size: 22,
          color: "DC2626",
          shading: {
            fill: "FEF2F2"
          }
        }
      },
      {
        id: "Strong",
        name: "Strong",
        basedOn: "DefaultParagraphFont",
        run: {
          bold: true
        }
      },
      {
        id: "Emphasis",
        name: "Emphasis",
        basedOn: "DefaultParagraphFont",
        run: {
          italics: true
        }
      }
    ]
  };
}

/**
 * 创建页边距配置
 * 符合中国标准文档格式
 */
export function createMargins() {
  return {
    top: 1417,     // 2.5cm
    bottom: 1417,  // 2.5cm
    left: 1417,    // 2.5cm
    right: 1417    // 2.5cm
  };
}

/**
 * 创建列表编号配置
 */
export function createNumbering(): INumberingOptions {

  return {
    config: [
      {
        reference: "bullet-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 }
              }
            }
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: "○",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 1440, hanging: 360 }
              }
            }
          },
          {
            level: 2,
            format: LevelFormat.BULLET,
            text: "▪",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 2160, hanging: 360 }
              }
            }
          },
          {
            level: 3,
            format: LevelFormat.BULLET,
            text: "▫",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 2880, hanging: 360 }
              }
            }
          },
          {
            level: 4,
            format: LevelFormat.BULLET,
            text: "–",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 3600, hanging: 360 }
              }
            }
          }
        ]
      },
      {
        reference: "numbered-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1、",  // 中文习惯使用顿号
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 480 },
                tabStops: [{ type: TabStopType.LEFT, position: 720 }]
              }
            }
          },
          {
            level: 1,
            format: LevelFormat.DECIMAL,
            text: "（%2）",  // 中文习惯：（1）（2）
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 1440, hanging: 720 },
                tabStops: [{ type: TabStopType.LEFT, position: 1440 }]
              }
            }
          },
          {
            level: 2,
            format: LevelFormat.LOWER_LETTER,
            text: "%3)",  // a) b) c)
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 2160, hanging: 420 },
                tabStops: [{ type: TabStopType.LEFT, position: 2160 }]
              }
            }
          },
          {
            level: 3,
            format: LevelFormat.DECIMAL,
            text: "%4.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 2880, hanging: 420 },
                tabStops: [{ type: TabStopType.LEFT, position: 2880 }]
              }
            }
          },
          {
            level: 4,
            format: LevelFormat.DECIMAL,
            text: "%5.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 3600, hanging: 420 },
                tabStops: [{ type: TabStopType.LEFT, position: 3600 }]
              }
            }
          }
        ]
      }
    ]
  } as INumberingOptions;
}


export function numberingLevels(ordered: boolean, start = 1): INumberingOptions['config'][number]['levels'] {
  return createNumbering().config[ordered ? 1 : 0].levels.map(level => ({ ...level, start }));
}
