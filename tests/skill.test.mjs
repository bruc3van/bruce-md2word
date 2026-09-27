import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { renderSkillLayout, skillLayoutPath } from '../scripts/sync-skill-docs.mjs';
import { harness } from './harness.mjs';

const skillRoot = 'skills/bruce-md2word';

test('skill layout guide matches docs/document-layout.md', () => {
  assert.equal(readFileSync(skillLayoutPath, 'utf8'), renderSkillLayout(), 'run npm run build to refresh the skill copy');
});

test('skill links stay inside the installed skill directory', () => {
  // `npx skills add` copies only this directory, so every relative link must resolve within it.
  const files = [path.join(skillRoot, 'SKILL.md'), ...readdirSync(path.join(skillRoot, 'references')).map(name => path.join(skillRoot, 'references', name))];
  for (const file of files) {
    const prose = readFileSync(file, 'utf8').split(/^```[\s\S]*?^```$/m).join('');
    for (const [, target] of prose.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(resolved.startsWith(path.resolve(skillRoot) + path.sep) && existsSync(resolved), `${file}: ${target}`);
    }
  }
});

for (const delivery of ['project', 'attachment']) {
  test(`runtime guidance matches ${delivery} delivery and resolves package resources`, async () => {
    const h = await harness({ delivery }, undefined, delivery === 'project' ? { attachments: false } : {});
    try {
      if (delivery === 'project') {
        const { default: LocalSubprocess } = await import('@deepseek-ai/dsh-subprocess-local');
        const { default: provider } = await import(process.platform === 'win32' ? '@deepseek-ai/dsh-pwsh-local' : '@deepseek-ai/dsh-bash-local');
        await h.ctx.plugin(LocalSubprocess);
        await h.ctx.plugin(provider, { cwd: h.root });
      }
      const skill = await h.ctx.skills.get('bruce-md2word');
      assert.ok(skill?.whenToUse);
      assert.equal(skill.resourceBase?.kind, 'directory');
      assert.ok(existsSync(path.join(skill.resourceBase.path, 'docs/document-layout.md')));
      assert.equal(skill.content.includes('output/ directory'), delivery === 'project');
      assert.equal(skill.content.includes('attachment'), delivery === 'attachment');
    } finally { await h.close(); }
  });
}
