import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer } from 'vue'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

test('H5未选项目不查询，选定后按项目查询，清空项目后旧响应不回填', async () => {
  const scopePath = fileURLToPath(new URL('../mobile/projectScope.ts', import.meta.url))
  const result = await build({
    stdin: { contents: `export { useMobilePatrol } from './mobile/useMobilePatrol.ts'; export { patrolProject } from './mobile/projectScope.ts'`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, define: { 'import.meta.env.VITE_PATROL_LOCATION_MODE': '"demo"' }, write: false, platform: 'node', format: 'cjs', external: ['vue'],
    plugins: [{ name: 'project-query-boundary', setup(builder) {
      builder.onResolve({ filter: /^\.\/(api|transport)$/ }, args => args.importer.endsWith('useMobilePatrol.ts')
        ? { path: args.path, namespace: 'fixture' } : undefined)
      builder.onResolve({ filter: /projectScope\.ts$/, namespace: 'fixture' }, () => ({ path: scopePath, namespace: 'file' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === './transport'
        ? `export class MobileError extends Error {}; export const resolveContext = async () => globalThis.__patrolProjectFixture.context || ({ userId:'user', applicationId:'app', permissions:[] })`
        : `import { patrolProject } from ${JSON.stringify(scopePath)};
          const fixture = globalThis.__patrolProjectFixture;
          const record = name => fixture.calls.push([name, patrolProject.value]);
          export const myTasks = async () => { record('tasks'); return fixture.tasks ? await fixture.tasks : [] };
          export const myMissed = async () => { record('missed'); return [] };
          export const configurationOptions = async name => { record(name); return [] };
          export const myHistory = async () => { record('history'); return {data:[],total:0} };
          export const authorizedHistory = myHistory;
          export const submit = async () => ({}); export const upload = submit; export const preview = submit;` }))
    }}],
  })
  const previousStorage = globalThis.sessionStorage
  const fixture = { calls: [], tasks: undefined }
  globalThis.__patrolProjectFixture = fixture
  globalThis.sessionStorage = { getItem: () => null }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { useMobilePatrol, patrolProject } = module.exports
  const renderer = createRenderer({ insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}),
    createComment: () => ({}), setText() {}, setElementText() {}, parentNode() {}, nextSibling() {}, patchProp() {} })
  let state
  const app = renderer.createApp({ setup() { state = useMobilePatrol(); return () => null } })
  try {
    app.mount({})
    await state.load(); await state.loadHistoryOptions()
    await assert.rejects(state.scanPoint('point'), /Mobile.chooseProject/)
    assert.deepEqual(fixture.calls, [])
    patrolProject.value = 'project-a'
    await state.load(); await state.loadHistoryOptions()
    assert.deepEqual(fixture.calls.map(call => call[0]), ['tasks', 'missed', 'categories', 'levels'])
    assert.ok(fixture.calls.every(call => call[1] === 'project-a'))
    let resolveTasks
    fixture.tasks = new Promise(resolve => { resolveTasks = resolve })
    const oldRequest = state.load()
    await new Promise(resolve => setImmediate(resolve))
    patrolProject.value = undefined
    const count = fixture.calls.length
    await state.load(); await state.loadHistoryOptions()
    assert.equal(fixture.calls.length, count)
    resolveTasks([{ task: { id: 'old-project-task' } }])
    await oldRequest
    assert.deepEqual(state.rows.value, [])
    assert.equal(state.missedCount.value, undefined)
    assert.equal(state.loading.value, false)
    // 身份查询尚未完成就清空项目，也不能随后补发无项目的业务查询。
    let resolveContext
    fixture.context = new Promise(resolve => { resolveContext = resolve })
    patrolProject.value = 'project-b'
    const waitingContext = state.load()
    patrolProject.value = undefined
    await state.load()
    const beforeContext = fixture.calls.length
    resolveContext({ userId: 'user', applicationId: 'app', permissions: [] })
    await waitingContext
    assert.equal(fixture.calls.length, beforeContext)
  } finally {
    app.unmount()
    if (previousStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = previousStorage
    delete globalThis.__patrolProjectFixture
  }
})

test('离开首页后授权树迟到或失败不清空当前项目；留在首页时仍校验撤权', async () => {
  const { readFileSync } = await import('node:fs')
  const { parse, compileScript } = await import('vue/compiler-sfc')
  const { ref, nextTick } = await import('vue')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const result = await build({ entryPoints: [root + '/mobile/components/MobileProjectFilter.vue'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'], plugins: [{ name: 'project-filter-lifecycle', setup(builder) {
    builder.onResolve({ filter: /^(vant|\.\.\/i18n|\.\.\/transport|\.\.\/projectScope)$/ }, args => ({ path: args.path, namespace: 'filter-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'filter-fixture' }, args => ({ contents: {
      vant: `export const Button='button'`,
      '../i18n': `export const useI18n=()=>({t:key=>key})`,
      '../transport': `export const request=()=>globalThis.__projectFilter.response`,
      '../projectScope': `export const patrolProject=globalThis.__projectFilter.project`,
    }[args.path] }))
    builder.onLoad({ filter: /\.vue$/ }, args => {
      if (!args.path.endsWith('/MobileProjectFilter.vue')) return { contents: `export default {render:()=>null}` }
      const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
      return { contents: compileScript(descriptor, { id: 'project-filter-lifecycle', inlineTemplate: true }).content, loader: 'ts', resolveDir: root + '/mobile/components' }
    })
  }}] })
  const renderer = createRenderer({ insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode() {}, nextSibling() {}, patchProp() {} })
  try {
    for (const scenario of ['late-empty', 'late-failure', 'active-empty']) {
      let resolve, reject
      const project = ref('project-a'), response = new Promise((yes, no) => { resolve = yes; reject = no })
      globalThis.__projectFilter = { project, response }
      const loaded = { exports: {} }
      new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports)
      const app = renderer.createApp(loaded.exports.default); app.mount({})
      if (scenario !== 'active-empty') app.unmount()
      if (scenario === 'late-failure') reject(new Error('offline')); else resolve([])
      await new Promise(resolve => setImmediate(resolve)); await nextTick()
      assert.equal(project.value, scenario === 'active-empty' ? undefined : 'project-a', scenario)
      if (scenario === 'active-empty') app.unmount()
    }
  } finally { delete globalThis.__projectFilter }
})
