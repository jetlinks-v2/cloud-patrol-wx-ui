import { build } from 'esbuild'
import { createRequire } from 'node:module'
/** Bundle exactly as Vite does so tests do not require TypeScript-only import suffixes. */
export async function loadTs(entry) {
 const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'vue-router'] })
 const module = { exports: {} }
 new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports)
 return module.exports
}
