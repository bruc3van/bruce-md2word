import temml from 'temml';
import { JSDOM } from 'jsdom';
import { Math as WordMath, XmlComponent, XmlAttributeComponent } from 'docx';

/** Only emit structures we understand. Never flatten unknown MathML to text. */
class Attributes extends XmlAttributeComponent<Record<string, string>> {}
class Element extends XmlComponent {
  constructor(tag: string, children: (XmlComponent | string)[] = [], attrs?: Record<string, string>) {
    super(tag);
    if (attrs) this.root.push(new Attributes(attrs));
    this.root.push(...children);
  }
}
const m = (tag: string, children: (XmlComponent | string)[] = []): Element => new Element(`m:${tag}`, children);
const val = (tag: string, value: string): Element => new Element(`m:${tag}`, [], { 'm:val': value });
const run = (text: string, plain = false, bold = false, italic = false): Element => m('r', [
  ...(plain || bold || italic ? [m('rPr', [val('sty', bold ? (italic ? 'bi' : 'b') : italic ? 'i' : 'p')])] : []),
  new Element('w:rPr', [new Element('w:rFonts', [], { 'w:ascii': 'Cambria Math', 'w:hAnsi': 'Cambria Math' })]),
  new Element('m:t', [text], { 'xml:space': 'preserve' }),
]);
const naryChars = /^[∑∏∐⋂⋃⋀⋁∫∬∭∮∯∰]$/u;

export function latexToWordMath(source: string, display: boolean): WordMath {
  if (!source.trim() || Buffer.byteLength(source) > 50_000) throw new Error('Formula is empty or too large');
  // These constructs require document-wide state or layout not represented by this mapper.
  // Do not let Temml omit labels, tags or styling and then report a complete conversion.
  if (/\\(?:textbf|textit|textsf|texttt|textrm|textnormal|label|ref|eqref|tag|notag|nonumber|def|gdef|edef|xdef|newcommand|renewcommand|providecommand|let|global|includegraphics|href|url|html\w*|class|style|color|textcolor|definecolor|phantom|hphantom|vphantom|smash|raisebox|rule|kern|mkern|hspace|vspace|fontsize|tiny|small|large|Large|huge|Huge)\b/.test(source)) throw new Error('Unsupported formula command');
  const mathml = temml.renderToString(source, { displayMode: display, throwOnError: true, xml: true, trust: false, maxExpand: 1000, maxSize: [20, 200], macros: {} });
  if (Buffer.byteLength(mathml) > 1_000_000) throw new Error('Expanded formula is too large');
  const dom = new JSDOM(mathml, { contentType: 'text/xml' });
  let count = 0;
  const unwrap = (node: globalThis.Element): globalThis.Element => {
    while (node.localName === 'mrow' && node.children.length === 1) node = node.children[0];
    return node;
  };
  const children = (node: globalThis.Element, depth: number): XmlComponent[] => sequence(Array.from(node.children), depth);
  function sequence(nodes: globalThis.Element[], depth: number): XmlComponent[] {
    const result: XmlComponent[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const current = unwrap(nodes[i]);
      const base = current.children[0] && unwrap(current.children[0]);
      const next = nodes[i + 1];
      if (/^(msub|msup|msubsup|munder|mover|munderover)$/.test(current.localName)
        && base?.localName === 'mo' && naryChars.test(base.textContent ?? '')
        && next && unwrap(next).localName !== 'mo' && unwrap(next).localName !== 'mspace') {
        result.push(...convert(current, depth + 1, next));
        i++;
      } else result.push(...convert(nodes[i], depth + 1));
    }
    return result;
  }
  function convert(node: globalThis.Element, depth: number, operand?: globalThis.Element): XmlComponent[] {
    if (++count > 10_000 || depth > 80) throw new Error('Formula complexity exceeded');
    const tag = node.localName;
    const parts = Array.from(node.children);
    const at = (i: number): XmlComponent[] => {
      if (!parts[i]) throw new Error('Missing MathML argument');
      return convert(parts[i], depth + 1);
    };
    // Temml's generated layout classes/padding are intentionally not copied to Word.
    // Semantic styles, foreign nodes and custom dimensions must never silently vanish.
    if (node.hasAttribute('href') || node.hasAttribute('mathcolor') || node.hasAttribute('mathbackground')
      || /(?:color|background|visibility|transform):/.test(node.getAttribute('style') ?? '')) throw new Error('Unsupported MathML style');
    switch (tag) {
      case 'mstyle': {
        if (Array.from(node.attributes).some(attr => !['displaystyle', 'scriptlevel'].includes(attr.name))
          || !['', '0'].includes(node.getAttribute('scriptlevel') ?? '')) throw new Error('Unsupported math style');
        // Word chooses display sizing from the containing paragraph/argument.
        // dfrac/tfrac retain their full fraction structure, without CSS sizing.
        return children(node, depth);
      }
      case 'math':
      case 'mrow': {
        if (parts.length >= 2 && parts[0].localName === 'mo' && parts[0].getAttribute('fence') === 'true'
          && parts.at(-1)!.localName === 'mo' && parts.at(-1)!.getAttribute('fence') === 'true') {
          return [m('d', [m('dPr', [val('begChr', parts[0].textContent ?? ''), val('endChr', parts.at(-1)!.textContent ?? ''), val('grow', '1')]), m('e', sequence(parts.slice(1, -1), depth))])];
        }
        return children(node, depth);
      }
      case 'mi': case 'mn': case 'mo': case 'mtext': {
        if (parts.length) throw new Error('Unexpected token children');
        const variant = node.getAttribute('mathvariant');
        if (variant && variant !== 'normal') throw new Error('Unsupported math variant');
        const style = node.getAttribute('style') ?? '';
        if (style.includes('font-family:')) throw new Error('Unsupported math font');
        return [run(node.textContent ?? '', tag === 'mtext' || tag === 'mo' || tag === 'mn' || variant === 'normal' || (node.textContent?.length ?? 0) > 1, /font-weight:\s*bold/.test(style), /font-style:\s*italic/.test(style))];
      }
      case 'mspace': {
        const width = node.getAttribute('width') ?? '0em';
        if (/^0(?:em|pt|px)?$/.test(width)) return [];
        const match = /^(-?[\d.]+)em$/.exec(width);
        if (!match || !Number.isFinite(Number(match[1])) || Math.abs(Number(match[1])) > 2) throw new Error('Unsupported math spacing');
        return Number(match[1]) > 0 ? [run(Number(match[1]) >= 1 ? '\u2003' : '\u2009', true)] : [];
      }
      case 'mfrac': {
        const thickness = node.getAttribute('linethickness');
        if (thickness && !/^0(?:px|pt|em)?$/.test(thickness)) throw new Error('Unsupported fraction thickness');
        return [m('f', [...(thickness ? [m('fPr', [val('type', 'noBar')])] : []), m('num', at(0)), m('den', at(1))])];
      }
      case 'msqrt': return [m('rad', [m('radPr', [val('degHide', '1')]), m('deg'), m('e', children(node, depth))])];
      case 'mroot': return [m('rad', [m('radPr', [val('degHide', '0')]), m('deg', at(1)), m('e', at(0))])];
      case 'msub': case 'msup': case 'msubsup':
      case 'munder': case 'mover': case 'munderover': {
        const base = unwrap(parts[0]);
        const glyph = base.textContent ?? '';
        const lower = ['msub', 'msubsup', 'munder', 'munderover'].includes(tag);
        const upper = ['msup', 'msubsup', 'mover', 'munderover'].includes(tag);
        if (base.localName === 'mo' && naryChars.test(glyph)) {
          return [m('nary', [m('naryPr', [val('chr', glyph), val('limLoc', tag.includes('under') || tag.includes('over') ? 'undOvr' : 'subSup'), val('subHide', lower ? '0' : '1'), val('supHide', upper ? '0' : '1')]), m('sub', lower ? at(1) : []), m('sup', upper ? at(lower ? 2 : 1) : []), m('e', operand ? convert(operand, depth + 1) : [])])];
        }
        if (tag === 'mover' && parts[1].localName === 'mo' && Array.from(parts[1].textContent ?? '').length === 1) {
          const accent = parts[1].textContent!;
          if ('→←↔ˆ^˜~˙¨‾¯˘ˇ´`'.includes(accent)) return [m('acc', [m('accPr', [val('chr', accent)]), m('e', at(0))])];
          if (accent === '⏞') return [m('groupChr', [m('groupChrPr', [val('chr', accent), val('pos', 'top'), val('vertJc', 'bot')]), m('e', at(0))])];
        }
        if (tag === 'munder' && parts[1].textContent === '⏟') return [m('groupChr', [m('groupChrPr', [val('chr', '⏟'), val('pos', 'bot'), val('vertJc', 'top')]), m('e', at(0))])];
        if (tag === 'msubsup') return [m('sSubSup', [m('e', at(0)), m('sub', at(1)), m('sup', at(2))])];
        if (tag === 'msub' || tag === 'msup') return [m(tag === 'msub' ? 'sSub' : 'sSup', [m('e', at(0)), m(tag === 'msub' ? 'sub' : 'sup', at(1))])];
        if (tag === 'munderover') return [m('limUpp', [m('e', [m('limLow', [m('e', at(0)), m('lim', at(1))])]), m('lim', at(2))])];
        return [m(tag === 'munder' ? 'limLow' : 'limUpp', [m('e', at(0)), m('lim', at(1))])];
      }
      case 'menclose': {
        const notation = node.getAttribute('notation');
        if (notation === 'top' || notation === 'bottom') return [m('bar', [m('barPr', [val('pos', notation === 'top' ? 'top' : 'bot')]), m('e', children(node, depth))])];
        throw new Error('Unsupported enclosure');
      }
      case 'mtable': {
        if (node.hasAttribute('columnlines') || node.hasAttribute('rowlines') || node.hasAttribute('frame') || parts.some(row => row.localName !== 'mtr' || Array.from(row.children).some(cell => cell.localName !== 'mtd'))) throw new Error('Unsupported equation table');
        const width = Math.max(0, ...parts.map(row => row.children.length));
        if (!width || width > 32 || parts.length > 100) throw new Error('Matrix dimensions exceeded');
        const columns = Array.from({ length: width }, (_, i) => {
          const cell = parts[0].children[i];
          const align = cell?.classList.contains('tml-left') ? 'left' : cell?.classList.contains('tml-right') ? 'right' : 'center';
          return m('mc', [m('mcPr', [val('count', '1'), val('mcJc', align)])]);
        });
        return [m('m', [m('mPr', [m('mcs', columns)]), ...parts.map(row => m('mr', Array.from({ length: width }, (_, i) => m('e', row.children[i] ? children(row.children[i], depth + 1) : []))))])];
      }
      default: throw new Error(`Unsupported MathML element: ${tag}`);
    }
  }
  try {
    // Validate even rows/cells and delimiter nodes handled directly by their parent.
    const allNodes = dom.window.document.querySelectorAll('*');
    if (allNodes.length > 10_000) throw new Error('Formula node budget exceeded');
    for (const node of allNodes) {
      if (/(?:border|color|background|visibility|transform):/.test(node.getAttribute('style') ?? '')
        || /border-/.test(node.getAttribute('style') ?? '')
        || ['rowspan', 'columnspan', 'rowlines', 'columnlines', 'frame', 'href', 'mathcolor', 'mathbackground'].some(attr => node.hasAttribute(attr))) throw new Error('Unsupported MathML layout');
    }
    const math = new WordMath({ children: [] });
    for (const child of convert(dom.window.document.documentElement, 0)) math.addChildElement(child);
    return display ? m('oMathPara', [m('oMathParaPr', [val('jc', 'center')]), math]) : math;
  } finally { dom.window.close(); }
}
