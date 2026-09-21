import path from 'node:path';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { ExportError } from './errors.js';
/** Validate generated OPC parts, XML and all internal relationships before saving. */
export async function validateArtifact(data: Uint8Array, maxBytes: number): Promise<void> {
  if (data.byteLength > maxBytes) throw new ExportError('DOCX exceeds the output limit.', 'LIMIT_EXCEEDED');
  try {
    const zip = await JSZip.loadAsync(data, { checkCRC32: true });
    for (const file of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']) if (!zip.file(file)) throw new Error('Missing DOCX part');
    const relationships = new Map<string, Set<string>>();
    const documents = new Map<string, string>();
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.(xml|rels)$/.test(entry.name)) continue;
      const xml = await entry.async('string');
      const dom = new JSDOM(xml, { contentType: 'application/xml' });
      try {
        if (entry.name.endsWith('.rels')) {
          const base = entry.name === '_rels/.rels' ? '' : path.posix.dirname(path.posix.dirname(entry.name));
          const owner = entry.name === '_rels/.rels' ? '' : path.posix.join(base, path.posix.basename(entry.name, '.rels'));
          const ids = new Set<string>();
          for (const rel of dom.window.document.getElementsByTagName('Relationship')) {
            const id = rel.getAttribute('Id'); const target = rel.getAttribute('Target');
            if (!id || !target || ids.has(id)) throw new Error('Invalid relationship');
            ids.add(id);
            if (rel.getAttribute('TargetMode') !== 'External') {
              const resolved = path.posix.normalize(path.posix.join(base, target));
              if (resolved.startsWith('../') || !zip.file(resolved)) throw new Error('Missing relationship target');
            }
          }
          relationships.set(owner, ids);
        } else documents.set(entry.name, xml);
      } finally { dom.window.close(); }
    }
    for (const [name, xml] of documents) for (const match of xml.matchAll(/\br:(?:embed|id|link)="([^"]+)"/g)) if (!relationships.get(name)?.has(match[1])) throw new Error('Missing relationship identifier');
  } catch (cause) { throw new ExportError('Generated DOCX failed integrity validation.', 'CONVERSION_FAILED', { cause }); }
}
