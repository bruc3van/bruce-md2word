import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `npx skills add` copies only skills/bruce-md2word/, so the skill carries its
// own copy of the layout guide. Links outside the skill point to the repository.
const root = fileURLToPath(new URL('..', import.meta.url));
const source = 'docs/document-layout.md';
export const skillLayoutPath = 'skills/bruce-md2word/references/document-layout.md';
const repository = 'https://github.com/bruc3van/bruce-md2word/blob/main/';

export function renderSkillLayout() {
  const text = readFileSync(path.join(root, source), 'utf8').replace(/\r\n/g, '\n');
  // Odd segments are fenced examples, whose paths belong to the reader's document.
  const body = text.split(/(^```[\s\S]*?^```$)/m).map((part, index) => index % 2 ? part : part.replace(/\]\(((?!https?:|#)[^)\s]+)\)/g, (_, target) =>
    `](${repository}${path.posix.normalize(path.posix.join(path.posix.dirname(source), target))})`)).join('');
  return `<!-- 由 ${source} 生成，请修改源文件后运行 npm run build。 -->\n\n${body}`;
}

export function syncSkillDocs() {
  writeFileSync(path.join(root, skillLayoutPath), renderSkillLayout());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncSkillDocs();
