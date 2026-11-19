import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { effectScope } = require('vue')
// 故意保留旧 demo 构建变量：新版也必须调用真实定位，不再受该开关影响。
const compiled = await build({ stdin: { contents: `export * from './mobile/location'; export * from './mobile/model'; export * from './mobile/offline/model'`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, define: { 'import.meta.env.VITE_PATROL_LOCATION_MODE': '"demo"' }, external: ['vue'], bundle: true, write: false, platform: 'node', format: 'cjs' })
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports)
const { distanceTo, locationStatus, isDeviceLocation, usePatrolLocation, submissionFor, queueEntry } = module.exports
const reference = { longitude: 106.551556, latitude: 29.563009, rangeMeters: 100, address: '园区东门' }
const sample = { longitude: 106.552, latitude: 29.5635, accuracy: 12, collectedTime: 1794960000000, coordinateSystem: 'WGS84', source: 'device' }
function environment(t, geolocation, host, secure = true) {
 const before = Object.fromEntries(['window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: secure, patrolHost: host } })
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation } })
 const scope = effectScope(), location = scope.run(() => usePatrolLocation())
 location.reference.value = reference
 t.after(() => {
  scope.stop()
  for (const [key, descriptor] of Object.entries(before)) {
   if (descriptor) Object.defineProperty(globalThis, key, descriptor)
   else delete globalThis[key]
  }
 })
 return { location, scope }
}
test('距离使用真实WGS84坐标，区分范围和精度', () => {
 assert.ok(distanceTo(reference, sample) > 60 && distanceTo(reference, sample) < 80)
 assert.equal(locationStatus(reference, sample), 'inside')
 assert.equal(locationStatus(reference, { ...sample, latitude: reference.latitude + .002 }), 'outside')
 assert.equal(locationStatus(reference, { ...sample, accuracy: 200 }), 'inaccurate')
 assert.equal(distanceTo(reference, { ...sample, longitude: reference.longitude, latitude: reference.latitude }), 0)
 assert.equal(locationStatus(reference), 'unknown')
})
test('缺少或无效参考坐标、非WGS84、无效设备样本及旧demo不生成距离', () => {
 for (const target of [{ rangeMeters: 100 }, { ...reference, longitude: NaN }, { ...reference, latitude: 91 }, { ...reference, rangeMeters: 0 }]) {
  assert.equal(distanceTo(target, sample), undefined)
  assert.equal(locationStatus(target, sample), 'unknown')
 }
 for (const value of [{ ...sample, source: 'demo' }, { ...sample, coordinateSystem: 'GCJ02' }, { ...sample, accuracy: -1 }, { ...sample, latitude: NaN }, { ...sample, longitude: 181 }, { ...sample, collectedTime: 0 }]) {
  assert.equal(isDeviceLocation(value), false)
  assert.equal(distanceTo(reference, value), undefined)
 }
})
test('默认调用浏览器真实定位，保留经纬度、精度及实际采集时间', async t => {
 let options
 const { location } = environment(t, { getCurrentPosition(success, failure, config) {
  options = config
  success({ coords: sample, timestamp: sample.collectedTime })
 } })
 await location.refresh()
 assert.deepEqual({ ...location.evidence.value }, sample)
 assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
 assert.equal(location.error.value, '')
 assert.equal(location.locating.value, false)
})
test('已有宿主定位优先，返回样本分离且不请求浏览器定位', async t => {
 let calls = 0
 const value = { ...sample }
 const { location } = environment(t, { getCurrentPosition() { calls++ } }, { getLocation: async () => value })
 await location.refresh()
 value.latitude = 10
 assert.equal(location.evidence.value.latitude, sample.latitude)
 assert.equal(calls, 0)
})
test('重新定位拒绝授权、不可用和超时后清除旧样本，不产生范围内或模拟数据', async t => {
 let failure
 const { location } = environment(t, { getCurrentPosition(success, reject) { failure = reject } })
 for (const [code, key] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
  location.evidence.value = { ...sample }
  const pending = location.refresh()
  assert.equal(location.evidence.value, undefined)
  assert.equal(location.status.value, 'unknown')
  failure({ code })
  await pending
  assert.equal(location.evidence.value, undefined)
  assert.equal(location.error.value, `Mobile.geo.${key}`)
 }
})
test('不支持定位或非安全上下文时给出原因，不能伪造到场', async t => {
 const { location } = environment(t)
 await location.refresh()
 assert.equal(location.error.value, 'Mobile.geo.unsupported')
 window.isSecureContext = false
 await location.refresh()
 assert.equal(location.error.value, 'Mobile.geo.insecure')
 assert.equal(location.evidence.value, undefined)
})
test('浏览器或宿主返回非法位置时拒绝使用，不回退模拟位置', async t => {
 const { location } = environment(t, { getCurrentPosition(success) { success({ coords: { ...sample, latitude: NaN }, timestamp: sample.collectedTime }) } })
 await location.refresh()
 assert.equal(location.error.value, 'Mobile.geo.invalid')
 window.patrolHost = { getLocation: async () => ({ ...sample, source: 'demo' }) }
 await location.refresh()
 assert.equal(location.error.value, 'Mobile.geo.invalid')
 assert.equal(location.evidence.value, undefined)
})
test('宿主一直不响应也会超时，迟到样本不能恢复范围内', async t => {
 let resolve
 t.mock.timers.enable({ apis: ['setTimeout'] })
 const { location } = environment(t, undefined, { getLocation: () => new Promise(done => { resolve = done }) })
 const pending = location.refresh()
 t.mock.timers.tick(12000)
 await pending
 assert.equal(location.error.value, 'Mobile.geo.timeout')
 resolve({ ...sample })
 await Promise.resolve()
 assert.equal(location.evidence.value, undefined)
})
test('切换点位、清除和卸载后，迟到定位不能覆盖当前表单', async t => {
 const requests = []
 const { location, scope } = environment(t, { getCurrentPosition(success) { requests.push(success) } })
 const old = location.refresh(), current = location.refresh()
 requests[1]({ coords: sample, timestamp: sample.collectedTime })
 await current
 requests[0]({ coords: { ...sample, longitude: 10 }, timestamp: sample.collectedTime })
 await old
 assert.equal(location.evidence.value.longitude, sample.longitude)
 for (const dispose of [() => location.clear(), () => scope.stop()]) {
  const pending = location.refresh()
  dispose()
  requests.at(-1)({ coords: sample, timestamp: sample.collectedTime })
  await pending
  assert.equal(location.evidence.value, undefined)
 }
})
test('冻结重试不重新采样；旧演示样本仅显示提示，不当作真实位置', t => {
 let calls = 0
 const { location } = environment(t, { getCurrentPosition() { calls++ } })
 location.open({ locationReference: reference }, { ...sample }, true)
 assert.deepEqual({ ...location.evidence.value }, sample)
 location.open({ locationReference: reference }, { ...sample, source: 'demo' }, true)
 assert.equal(location.evidence.value, undefined)
 assert.equal(location.error.value, 'Mobile.geo.legacyDemo')
 assert.equal(calls, 0)
})
test('提交及离线队列冻结真实采样，重定位不修改原采集时间和坐标', () => {
 const task = { id: 'task', standardSnapshot: [] }, location = { ...sample }
 const body = submissionFor(task, [], '', 'request', { collectedTime: 1794960000010, location })
 const saved = queueEntry({ task }, [], '', {}, 'offline', 1794960000010, location)
 location.latitude = 10
 assert.equal(body.location.latitude, sample.latitude)
 assert.equal(saved.submission.location.latitude, sample.latitude)
 assert.equal(body.location.collectedTime, sample.collectedTime)
 assert.equal(saved.submission.location.source, 'device')
 assert.equal(saved.submission.networkStatus, 'offline')
})

// 渲染实际定位面板，核对没有设备样本时不会露出模拟距离、精度或到点标记。
const { readFileSync } = await import('node:fs')
const { parse, compileScript } = await import('vue/compiler-sfc')
const panelBuild = await build({
 entryPoints: [fileURLToPath(new URL('../mobile/components/LocationPanel.vue', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'],
 plugins: [{ name: 'location-panel-test', setup(builder) {
  builder.onResolve({ filter: /^vant$/ }, () => ({ path: 'vant', namespace: 'controls' }))
  builder.onLoad({ filter: /.*/, namespace: 'controls' }, () => ({ contents: `export const Button='button',Icon='i',Tag='span'` }))
  builder.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: 'i18n', namespace: 'locale' }))
  builder.onLoad({ filter: /.*/, namespace: 'locale' }, () => ({ resolveDir: fileURLToPath(new URL('../mobile/', import.meta.url)), contents: `import { zh } from ${JSON.stringify(fileURLToPath(new URL('../mobile/messages.ts', import.meta.url)))};export const useI18n=()=>({t:(key,args={})=>{let result=key.startsWith('Mobile.')?key.slice(7).split('.').reduce((obj,k)=>obj?.[k],zh):key;return Object.entries(args).reduce((s,[k,v])=>s.replace('{'+k+'}',String(v)),result||key)}})` }))
  builder.onLoad({ filter: /\.vue$/ }, args => {
   const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
   return { contents: compileScript(descriptor, { id: 'location-test', inlineTemplate: true }).content, loader: 'ts' }
  })
 } }],
})
const panelModule = { exports: {} }
new Function('require', 'module', 'exports', panelBuild.outputFiles[0].text)(require, panelModule, panelModule.exports)
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const renderPanel = props => renderToString(createSSRApp({ render: () => h(panelModule.exports.default, { reference, ...props }) }))
test('定位面板显示实际坐标与精度；拒绝授权后只显示原因，不显示虚假范围内', async () => {
 const actual = await renderPanel({ evidence: sample })
 assert.ok(actual.includes('范围内'))
 assert.ok(actual.includes('106.552000, 29.563500'))
 assert.ok(actual.includes('±12'))
 const failed = await renderPanel({ error: 'Mobile.geo.denied' })
 assert.ok(failed.includes('定位权限未开启'))
 assert.ok(failed.includes('未定位'))
 assert.ok(!failed.includes('范围内'))
 assert.ok(!failed.includes('±18'))
 assert.ok(!failed.includes('location-coordinates'))
 assert.equal((failed.match(/<circle/g) || []).length, 2)
})
test('面板拒绝将旧演示定位展示为真实位置；点位缺坐标时不画范围内标记', async () => {
 const legacy = await renderPanel({ evidence: { ...sample, source: 'demo' } })
 assert.ok(!legacy.includes('location-coordinates'))
 assert.ok(!legacy.includes('范围内'))
 const missing = await renderPanel({ evidence: sample, reference: { rangeMeters: 100 } })
 assert.ok(missing.includes('点位坐标或范围未配置'))
 assert.ok(missing.includes('无法测距'))
 assert.ok(!missing.includes('未定位'))
 assert.ok(!missing.includes('范围内'))
 assert.equal((missing.match(/<circle/g) || []).length, 2)
 const failed = await renderPanel({ evidence: sample, reference: { rangeMeters: 100 }, referenceError: 'Mobile.geo.referenceLoadFailed' })
 assert.ok(failed.includes('点位坐标读取失败'))
 assert.ok(!failed.includes('点位坐标或范围未配置'))
})
