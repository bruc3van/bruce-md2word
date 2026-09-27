// Build replaces this public entry with a pinned, locally adapted renderer.
// See scripts/build.mjs and lib/MERMAID-LICENSES.txt in the distributed package.
export { renderMermaidSVG } from 'beautiful-mermaid';
// Re-exported so callers share the renderer bundle's scale state.
export { withDiagramFontScale } from './diagram-style.js';
