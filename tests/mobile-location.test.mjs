import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const compiled = await build({ stdin: { contents: `export * from './mobile/location'; export * from './mobile/model'; export * from './mobile/offline/model'`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, define: { 'import.meta.env.VITE_PATROL_LOCATION_MODE': '"demo"' }, bundle: true, write: false, platform: 'node', format: 'cjs' })
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { demoLocation, distanceTo, locationStatus, submissionFor, queueEntry } = module.exports
const reference = { longitude: 106.551556, latitude: 29.563009, rangeMeters: 100, address: '园区东门' }
test('定位区分距离、半径与精度；边界内外及精度不足均有独立状态', () => {
 const sample = demoLocation(reference, 100)
 assert.equal(sample.source, 'demo'); assert.equal(sample.coordinateSystem, 'WGS84')
 assert.ok(distanceTo(reference, sample) > 20 && distanceTo(reference, sample) < 40)
 assert.equal(locationStatus(reference, sample), 'inside')
 assert.equal(locationStatus(reference, { ...sample, latitude: reference.latitude + .002 }), 'outside')
 assert.equal(locationStatus(reference, { ...sample, accuracy: 200 }), 'inaccurate')
 assert.equal(distanceTo(reference, { ...sample, longitude: reference.longitude, latitude: reference.latitude }), 0)
 assert.equal(locationStatus(reference), 'unknown')
})
test('演示缺坐标可展示；真实定位缺参考不伪造距离', () => {
 const target = { rangeMeters: 100 }, demo = demoLocation(target)
 assert.ok(distanceTo(target, demo) > 0)
 assert.equal(distanceTo(target, { ...demo, source: 'device' }), undefined)
})
test('提交及离线队列冻结原定位，后续重定位不覆盖证据', () => {
 const task = { id: 'task', standardSnapshot: [] }, location = demoLocation(reference, 100)
 const body = submissionFor(task, [], '', 'request', { collectedTime: 110, location })
 const saved = queueEntry({ task }, [], '', {}, 'offline', 110, location)
 location.latitude = 10
 assert.notEqual(body.location.latitude, 10); assert.notEqual(saved.submission.location.latitude, 10)
 assert.equal(body.location.collectedTime, 100)
 assert.equal(saved.submission.location.source, 'demo')
 assert.equal(saved.submission.networkStatus, 'offline')
})
