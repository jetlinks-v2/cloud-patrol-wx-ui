import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createRenderer, ref, nextTick } from 'vue'

const root = fileURLToPath(new URL('..', import.meta.url))
const result = await build({ entryPoints: [root + '/mobile/App.vue'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'],
  plugins: [{ name: 'project-navigation', setup(builder) {
    builder.onResolve({ filter: /^vant$/ }, () => ({ path: 'vant', namespace: 'fixture' }))
    builder.onResolve({ filter: /^\.\/(useMobilePatrol|projectScope|useWebView|transport|i18n|auth\/session|shell\/runtime)$/ }, args => args.importer.endsWith('/mobile/App.vue') ? { path: args.path, namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      const contents = {
        vant: `import {h} from 'vue';export const Button={setup:(_,ctx)=>()=>h('button',ctx.attrs,ctx.slots.default?.())},Field='input',Loading='loading';export const ConfigProvider={setup:(_,ctx)=>()=>h('provider',null,ctx.slots.default?.())}`,
        './useMobilePatrol': `export const useMobilePatrol=()=>globalThis.__projectNav.state`,
        './projectScope': `export const patrolProject=globalThis.__projectNav.project`,
        './useWebView': `import {ref} from 'vue';export const useWebView=(screen,busy,back)=>{globalThis.__projectNav.navigation={screen,back};return {keyboardOpen:ref(false)}}`,
        './transport': `export const host={},hostState={}`,
        './i18n': `export const useI18n=()=>({t:key=>key,te:()=>true})`,
        './auth/session': `export const authState={}`,
        './shell/runtime': `export const inShell=()=>false`,
      }[args.path]
      return { contents }
    })
    builder.onLoad({ filter: /\.vue$/ }, args => {
      if (!args.path.endsWith('/mobile/App.vue')) return { contents: `import {h} from 'vue';export const __esModule=true;export default {inheritAttrs:false,setup:(_,ctx)=>()=>h(${JSON.stringify(args.path.split('/').at(-1).replace('.vue', ''))},ctx.attrs,ctx.slots.default?.())}` }
      const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
      return { contents: compileScript(descriptor, { id: 'project-navigation', inlineTemplate: true }).content, loader: 'ts', resolveDir: root + '/mobile' }
    })
  }}],
})
const renderer = createRenderer({
  createElement: tag => ({ tag, props: {}, children: [] }), createText: text => ({ text, children: [] }), createComment: text => ({ text, children: [] }),
  insert(n, p, a) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = p; const i = a ? p.children.indexOf(a) : -1; p.children.splice(i < 0 ? p.children.length : i, 0, n) },
  remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1) },
  setText(n, text) { n.text = text }, setElementText(n, text) { n.text = text; n.children = [] }, patchProp(n, key, _, value) { n.props[key] = value }, parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
})
const tick = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick() }

test('实际巡更页面仅首页有项目选择；所有业务子页沿用项目，返回首页恢复选择', async t => {
  let clock = 1794972646000
  const intervals = []
  t.mock.method(Date, 'now', () => clock)
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { intervals.push({ callback, delay }); return intervals.length })
  t.mock.method(globalThis, 'clearInterval', () => {})
  const before = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, history: { length: 1 } } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  const state = {}
  for (const key of ['date', 'tab', 'mine', 'missedCount', 'missedError', 'historyScope', 'canReadProjectHistory', 'people', 'categories', 'levels', 'historyFilters', 'filterError', 'rows', 'records', 'selected', 'record', 'success', 'loading', 'sending', 'uploading', 'error', 'draft', 'errors', 'images', 'total', 'locked']) state[key] = ref(undefined)
  Object.assign(state, { date: ref('2026-11-18'), tab: ref('home'), rows: ref([]), categories: ref([]), levels: ref([]), people: ref([]), records: ref([]), historyFilters: ref({}), draft: ref({ answers: [], remark: '' }),
    location: { reference: ref({ rangeMeters: 100 }), evidence: ref(), locating: ref(false), error: ref(''), refresh() {} } })
  for (const key of ['searchHistory', 'loadHistoryOptions', 'reason', 'load', 'refreshEligibility', 'open', 'changeAnswer', 'upload', 'preview', 'submit', 'scanPoint', 'scanNfc']) state[key] = () => {}
  state.refreshEligibility = () => { globalThis.__projectNav.refreshes = (globalThis.__projectNav.refreshes || 0) + 1 }
  state.leave = () => { state.selected.value = undefined; state.record.value = undefined }
  const project = ref('project-a')
  globalThis.__projectNav = { state, project }
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports)
  const container = { children: [] }, app = renderer.createApp(loaded.exports.default)
  app.mount(container)
  t.after(() => {
    app.unmount(); delete globalThis.__projectNav
    for (const [key, descriptor] of Object.entries(before)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  })
  const find = (tag, node = container) => node.tag === tag ? node : node.children?.map(child => find(tag, child)).find(Boolean)
  const back = async () => { globalThis.__projectNav.navigation.back(); await tick() }
  const enter = async page => { find('PatrolHome').props.onEnter(page); await tick() }
  assert.ok(find('MobileProjectFilter'))
  for (const page of ['tasks', 'history', 'manage', 'missed', 'offline']) {
    await enter(page)
    assert.equal(find('MobileProjectFilter'), undefined, page)
    assert.equal(project.value, 'project-a')
    if (page === 'manage') {
      find('PointManagement').props.onScreen({ key: 'manage:new', depth: 2, title: 'Mobile.addPoint' }); await tick()
      assert.equal(find('MobileProjectFilter'), undefined, '新增点位页')
      find('PointManagement').props.onScreen({ key: 'manage', depth: 1, title: 'Mobile.entries.manage' }); await tick()
    }
    if (page === 'tasks') {
      const toolbar = (() => { const walk = n => n.props?.class === 'point-scan-toolbar' ? n : n.children?.map(walk).find(Boolean); return walk(container) })()
      assert.equal(toolbar.children[1].children[0].text, 'Mobile.nfcTitle')
      toolbar.children[1].props.onClick(); await tick()
      assert.equal(find('MobileProjectFilter'), undefined, 'NFC页')
      await back()
      state.selected.value = { task: { id: 'task', standardSnapshot: [] } }; await tick()
      assert.equal(find('MobileProjectFilter'), undefined, '检查页')
      await back()
    }
    await back()
    assert.ok(find('MobileProjectFilter'), `从${page}返回首页`)
    assert.equal(project.value, 'project-a')
  }
  // 同一页面实际渲染两处倒计时，每秒更新；恢复后台按绝对时间追平，归零只核验一次。
  const row = { executable: false, reason: 'error.patrol.execution.cooldown', task: {
    id: 'cooling', pointId: 'point', pointName: '冷却点位', startTime: clock - 1000, endTime: clock + 120000,
    lastExecutionTime: clock, cooldownMinutes: 1, requiredCount: 3, completedCount: 1, standardSnapshot: [],
  } }
  state.rows.value = [row]
  globalThis.__projectNav.refreshes = 0
  await enter('tasks')
  find('PointGrid').props.onSelect({ id: 'point', name: '冷却点位', rows: [row], state: 'cooldown' }); await tick()
  const text = (node = container) => (node.text || '') + (node.children || []).map(child => text(child)).join('')
  const secondTick = intervals.find(item => item.delay === 1000).callback
  assert.ok(text().includes('00:01:00'))
  clock += 1000; secondTick(); await tick(); assert.ok(text().includes('00:00:59'))
  state.selected.value = row; await tick(); assert.ok(text().includes('00:00:59'), '检查页同步显示倒计时')
  globalThis.document.hidden = true
  clock += 30000; secondTick(); await tick(); assert.ok(text().includes('00:00:59'))
  globalThis.document.hidden = false
  secondTick(); await tick(); assert.ok(text().includes('00:00:29'))
  clock += 29000; secondTick(); await tick(); assert.ok(text().includes('Mobile.cooldownElapsed'))
  assert.equal(globalThis.__projectNav.refreshes, 1)
  clock += 1000; secondTick(); await tick(); assert.equal(globalThis.__projectNav.refreshes, 1)
})
