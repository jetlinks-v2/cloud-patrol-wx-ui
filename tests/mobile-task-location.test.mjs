import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const result = await build({
  stdin: { contents: `export { myTasks } from './mobile/api'; export { patrolProject } from './mobile/projectScope'; export { distanceTo } from './mobile/location'`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'],
  plugins: [{ name: 'task-location-boundary', setup(builder) {
    builder.onResolve({ filter: /^\.\/transport$/ }, args => args.importer.endsWith('/mobile/api.ts') ? { path: 'transport', namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const resolveContext = async () => ({ userId: 'user', applicationId: 'app' });
      export const request = (...args) => globalThis.__taskLocation.request(...args);
    ` }))
  }}],
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports)
const { myTasks, patrolProject, distanceTo } = loaded.exports
const pointId = 'e6892b7c-e9e6-4399-bc46-e71038437c92', projectId = '3a9191848d10430c985fbfb5a56f70e6'
const point = { id: pointId, projectId, longitude: 106.63382720947266, latitude: 29.491073608398438, locationAddress: '点位附近' }
const row = (id = 'task', reference = { longitude: null, latitude: null, address: null, rangeMeters: 100 }) => ({
  task: { id, pointId, projectId, locationReference: reference }, executable: true, reason: '',
})
function fixture(t, tasks, readPoint = async () => point) {
  const calls = []
  patrolProject.value = projectId
  globalThis.__taskLocation = { async request(path, method, body, scope, expected) {
    calls.push({ path, method, body, scope, expected })
    return path.endsWith('/tasks/_query') ? tasks : readPoint(path)
  } }
  t.after(() => { delete globalThis.__taskLocation; patrolProject.value = undefined })
  return calls
}

test('实际空坐标任务补读关联点位，保留100米范围，用真实设备坐标计算距离', async t => {
  const original = row(), calls = fixture(t, [original])
  const [resolved] = await myTasks('2026-11-18')
  assert.deepEqual(resolved.task.locationReference, { longitude: point.longitude, latitude: point.latitude, address: point.locationAddress, rangeMeters: 100 })
  assert.deepEqual(original.task.locationReference, { longitude: null, latitude: null, address: null, rangeMeters: 100 }, '不能改写原始响应/任务快照')
  assert.equal(resolved.executable, true)
  assert.equal(resolved.reason, '')
  assert.equal(resolved.locationReferenceError, undefined)
  const distance = distanceTo(resolved.task.locationReference, { longitude: 106.633818, latitude: 29.490998, accuracy: 39, collectedTime: 1794972646722, coordinateSystem: 'WGS84', source: 'device' })
  assert.ok(distance > 8 && distance < 9)
  assert.equal(calls[1].path, `/park/patrol/points/${pointId}`)
  assert.equal(calls[1].method, 'GET')
  assert.equal(calls[1].scope, projectId)
  assert.deepEqual(calls[1].expected, { userId: 'user', applicationId: 'app' })
})

test('同点位多个时段仅补读一次，各自范围、资格不变；有效任务快照不覆盖', async t => {
  const frozen = row('frozen', { longitude: 0, latitude: 0, rangeMeters: 50, address: '快照' })
  const calls = fixture(t, [row('a'), { ...row('b', { rangeMeters: 200 }), executable: false, reason: 'cooldown' }, frozen])
  const rows = await myTasks('2026-11-18', false, '1234')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].body, { date: '2026-11-18', mine: false, nfcCode: '1234' })
  assert.equal(rows[0].task.locationReference.rangeMeters, 100)
  assert.equal(rows[1].task.locationReference.rangeMeters, 200)
  assert.equal(rows[1].executable, false)
  assert.equal(rows[1].reason, 'cooldown')
  assert.strictEqual(rows[2], frozen)
})

test('点位仍缺坐标或任务范围无效时不伪造距离；有效快照不补查点位', async t => {
  fixture(t, [row('missing'), row('invalid-range', { longitude: null, latitude: null, rangeMeters: 0 })], async () => ({ ...point, latitude: null }))
  const rows = await myTasks('2026-11-18')
  assert.equal(rows[0].task.locationReference.latitude, null)
  assert.equal(rows[0].locationReferenceError, undefined)
  assert.equal(rows[1].task.locationReference.rangeMeters, 0)
  const calls = fixture(t, [row('complete', { ...point, rangeMeters: 100 })])
  await myTasks('2026-11-18')
  assert.equal(calls.length, 1)
})

test('点位查询网络/403失败保留任务，明确标记读取失败；401不吞掉', async t => {
  for (const status of [0, 403, 404]) {
    fixture(t, [row()], async () => { throw Object.assign(new Error('failed'), { status }) })
    const [resolved] = await myTasks('2026-11-18')
    assert.equal(resolved.executable, true)
    assert.equal(resolved.locationReferenceError, 'Mobile.geo.referenceLoadFailed')
    assert.equal(resolved.task.locationReference.longitude, undefined)
  }
  fixture(t, [row()], async () => { throw Object.assign(new Error('expired'), { status: 401 }) })
  await assert.rejects(myTasks('2026-11-18'), /expired/)
})

test('项目切换或点位响应ID/项目不符时拒绝迟到数据，不跨项目继续读取', async t => {
  let release
  const calls = fixture(t, Array.from({ length: 5 }, (_, n) => ({ ...row(String(n)), task: { ...row().task, pointId: `point-${n}` } })), path => new Promise(resolve => {
    const id = path.split('/').at(-1)
    if (id === 'point-0') release = () => resolve({ ...point, id })
    else resolve({ ...point, id })
  }))
  const pending = myTasks('2026-11-18')
  await new Promise(resolve => setImmediate(resolve))
  patrolProject.value = 'another-project'; release()
  await assert.rejects(pending, /Mobile.contextChanged/)
  assert.equal(calls.length, 5, '首批4个点位之后应停止')
  fixture(t, [row()], async () => ({ ...point, projectId: 'another-project' }))
  await assert.rejects(myTasks('2026-11-18'), /Mobile.contextChanged/)
  fixture(t, [row()], async () => ({ ...point, id: 'another-point' }))
  await assert.rejects(myTasks('2026-11-18'), /Mobile.contextChanged/)
})
