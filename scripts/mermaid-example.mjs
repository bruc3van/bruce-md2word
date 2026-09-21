/** Generate the real CLI document and extract its embedded PNGs for visual QA. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import sharp from 'sharp';
const result = JSON.parse(execFileSync(process.execPath, ['lib/cli.js', 'fixtures/Mermaid中文.md', '--strict', '-o', 'output/Mermaid中文测试.docx'], { encoding: 'utf8' }));
const zip = await JSZip.loadAsync(await readFile(result.path));
const media = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith('word/media/'));
await mkdir('output/mermaid-preview', { recursive: true });
for (const [index, file] of media.entries()) {
  const data = await file.async('nodebuffer');
  const { width, height } = await sharp(data).metadata();
  const path = `output/mermaid-preview/${index + 1}.png`;
  await writeFile(path, data);
  console.log(JSON.stringify({ path, width, height, bytes: data.byteLength }));
}
console.log(JSON.stringify(result));
