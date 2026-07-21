import { defineConfig, transformWithEsbuild } from 'vite';

// The BPMNOS properties panel (bpmnos-js) is authored in preact JSX inside .js files (via
// @bpmn-io/properties-panel) and published as source, so it must be JSX-transformed both in our own
// src and where it is consumed from node_modules/bpmnos-js. Vite/Rollup do not parse JSX in .js by
// default — run those files through esbuild's jsx loader with the preact automatic runtime first.
function preactJsxInJs() {
  return {
    name: 'bpmnos-preact-jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      const [ path ] = id.split('?');
      if (!/\.js$/.test(path)) {
        return null;
      }
      const ownSrc = /\/src\/.*\.js$/.test(path) && !path.includes('/node_modules/');
      const bpmnosDep = /\/node_modules\/bpmnos-js\/.*\.js$/.test(path);
      if (!ownSrc && !bpmnosDep) {
        return null;
      }
      return transformWithEsbuild(code, path, {
        loader: 'jsx',
        jsx: 'automatic',
        jsxImportSource: '@bpmn-io/properties-panel/preact'
      });
    }
  };
}

// Builds the demo app (src/app.js + index.html), deployed to GitHub Pages. `base` is the gh-pages
// sub-path (https://bpmn-os.github.io/bpmnos-workbench/) in CI. `react` is aliased to the
// properties-panel preact compat build so any `react` import resolves to preact.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/bpmnos-workbench/' : '/',
  plugins: [ preactJsxInJs() ],
  resolve: {
    alias: {
      react: '@bpmn-io/properties-panel/preact/compat'
    }
  },
  // bpmnos-js ships JSX-in-.js source. In dev, force it (and its transitive deps) through the esbuild
  // pre-bundler with the jsx loader: esbuild transforms its JSX *and* interop-wraps its CommonJS deps
  // (inherits, …) so their default imports resolve. (Excluding it instead breaks that CJS interop.)
  // The plugin above still covers the production rollup build, where optimizeDeps does not apply.
  optimizeDeps: {
    include: [ 'bpmnos-js' ],
    // the BPMN-OS wasm engine's emscripten glue loads bpmnos.wasm via new URL('bpmnos.wasm',
    // import.meta.url); keep it out of the dep pre-bundler so that relative resolution survives.
    exclude: [ '@bpmn-os/bpmnos-wasm' ],
    esbuildOptions: {
      loader: { '.js': 'jsx' },
      jsx: 'automatic',
      jsxImportSource: '@bpmn-io/properties-panel/preact'
    }
  }
});
