import { rmSync, chmodSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import path from 'node:path';
rmSync(new URL('../lib/', import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Adapt only the pinned renderer at build time; never modify node_modules or the host.
const rendererRoot = path.resolve('node_modules/beautiful-mermaid');
if (JSON.parse(readFileSync(path.join(rendererRoot, 'package.json'), 'utf8')).version !== '1.1.3') throw new Error('Review Mermaid adaptations before upgrading the renderer');
const adaptRenderer = {
  name: 'mermaid-layout-adaptations',
  setup(plugin) {
    plugin.onResolve({ filter: /^beautiful-mermaid$/ }, () => ({ path: path.join(rendererRoot, 'src/index.ts') }));
    plugin.onLoad({ filter: /beautiful-mermaid[/\\]src[/\\]theme\.ts$/ }, ({ path: file }) => {
      let contents = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      // Font resolution is local; omit the upstream web-font imports entirely.
      const imports = /  const fontImports = \[\n[\s\S]*?\n  \]/g;
      const matches = [...contents.matchAll(imports)];
      if (matches.length !== 1 || !matches[0][0].includes('fonts.googleapis.com')) throw new Error(`Mermaid font patch target changed: ${file}`);
      contents = contents.replace(imports, '  const fontImports: string[] = []');
      if (contents.includes('fonts.googleapis.com')) throw new Error(`Unexpected Mermaid web font reference: ${file}`);
      return { contents, loader: 'ts', resolveDir: path.dirname(file) };
    });
    plugin.onLoad({ filter: /beautiful-mermaid[/\\]src[/\\]parser\.ts$/ }, ({ path: file }) => {
      let contents = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      // The pinned state parser silently drops unmatched lines (including notes).
      // Reject at its actual fallthrough so unsupported content reaches our
      // source-preserving degradation path instead of producing a partial image.
      const before = "registerStateNode(graph, compositeStack, { id, label, shape: 'rounded' })\n      continue\n    }\n  }\n\n  return graph";
      if (contents.split(before).length !== 2) throw new Error(`Mermaid state parser patch target changed: ${file}`);
      contents = contents.replace(before, before.replace('    }\n  }', "    }\n    throw new Error('Unsupported state diagram statement: ' + line)\n  }"));
      return { contents, loader: 'ts', resolveDir: path.dirname(file) };
    });
    plugin.onLoad({ filter: /beautiful-mermaid[/\\]src[/\\](?:styles|index)\.ts$/ }, ({ path: file }) => {
      let contents = readFileSync(file, 'utf8');
      const before = path.basename(file) === 'styles.ts'
        ? 'return text.length * fontSize * 0.6'
        : 'const graph = parseMermaid(text)';
      const after = path.basename(file) === 'styles.ts'
        ? 'return measureTextWidth(text, fontSize, 400) + fontSize'
        : 'const graph = wrapGraphLabels(parseMermaid(text))';
      if (contents.split(before).length !== 2) throw new Error(`Mermaid patch target changed: ${file}`);
      contents = contents.replace(before, after);
      if (path.basename(file) === 'index.ts') contents = `import { wrapGraphLabels } from ${JSON.stringify(path.resolve('src/core/diagram-layout.ts'))};\n` + contents;
      return { contents, loader: 'ts', resolveDir: path.dirname(file) };
    });
  },
};
const rendererBundle = await build({
  entryPoints: ['src/core/mermaid-renderer.ts'], outfile: 'lib/core/mermaid-renderer.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
  plugins: [adaptRenderer],
  banner: { js: "import { createRequire as __rendererRequire } from 'node:module'; const require = __rendererRequire(import.meta.url);" },
});
// Native host modules keep their peer identities. The CLI is a separate process:
// bundle its DSH helper code so pnpm's non-auto-installed peers are not required
// in that child. Conversion libraries remain ordinary installed dependencies.
const bundled = await build({
  entryPoints: { cli: 'src/cli.ts', 'worker-entry': 'src/runtime/worker-entry.ts' },
  outdir: 'lib', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: Object.keys(manifest.dependencies), keepNames: true, sourcemap: true,
  metafile: true,
  plugins: [{ name: 'shared-renderer', setup(plugin) {
    plugin.onResolve({ filter: /mermaid-renderer\.js$/ }, () => ({ path: './core/mermaid-renderer.js', external: true }));
  } }],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
const packages = new Set(Object.keys(bundled.metafile.inputs).filter(file => file.startsWith('node_modules/')).map(file => {
  const parts = file.split('/');
  return parts[1].startsWith('@') ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/');
}));
const licenses = [];
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const file = readdirSync(directory).find(name => /^licen[sc]e(?:\.md|\.txt)?$/i.test(name));
  if (!file) throw new Error(`Bundled dependency lacks a license file: ${metadata.name}`);
  licenses.push(`${metadata.name}@${metadata.version}\n\n${readFileSync(path.join(directory, file), 'utf8')}`);
}
writeFileSync('lib/CLI-LICENSES.txt', licenses.join('\n\n----------------------------------------\n\n'));
chmodSync(new URL('../lib/cli.js', import.meta.url), 0o755);

const rendererPackages = new Set();
for (const file of Object.keys(rendererBundle.metafile.inputs).filter(file => file.includes('node_modules/'))) {
  let dir = path.dirname(path.resolve(file));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name) break;
    dir = path.dirname(dir);
  }
  rendererPackages.add(dir);
}
const rendererLicenses = [...rendererPackages].sort().map(dir => {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = readdirSync(dir).find(name => /^licen[sc]e(?:\.md|\.txt)?$/i.test(name));
  if (!license) throw new Error(`Renderer dependency lacks a license: ${pkg.name}`);
  return `${pkg.name}@${pkg.version}\n${JSON.stringify(pkg.repository)}\n\n${readFileSync(path.join(dir, license), 'utf8')}`;
});
writeFileSync('lib/MERMAID-LICENSES.txt', rendererLicenses.join('\n\n----------------------------------------\n\n'));
