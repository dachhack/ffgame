// Babel plugin: `import(x)` → `Promise.resolve().then(() => require(x))`.
//
// WHY: Metro turns every import() into an async-require, which in a dev build
// fetches a split bundle from the dev server at runtime. In the iOS dev build
// that path broke on core's `import('@supabase/supabase-js')`
// (packages/core/src/data/supabaseClient.ts): "Requiring unknown module" and
// then "Cannot set property 'importedAll' of undefined", which left sign-in
// dead. A plain require() puts the module in the main bundle — which is what
// release builds end up doing anyway — so the app loads the same way in dev
// and release. The lazy import() stays in core for the web, where Vite code-
// splits it; this rewrite only exists in the native app's Babel config.
//
// Namespace semantics are kept: `import()` resolves to the module namespace,
// so a CommonJS module without __esModule gets wrapped with a `default`.
module.exports = function inlineDynamicImports({ types: t, template }) {
  const build = template.expression(`
    Promise.resolve().then(() => {
      const m = require(SOURCE);
      return m && m.__esModule ? m : Object.assign({}, m, { default: m });
    })
  `);
  return {
    name: 'inline-dynamic-imports',
    visitor: {
      CallExpression(path) {
        if (!t.isImport(path.node.callee)) return;
        const [source] = path.node.arguments;
        if (!source || !t.isStringLiteral(source)) return; // only static specifiers
        path.replaceWith(build({ SOURCE: t.stringLiteral(source.value) }));
      },
    },
  };
};
