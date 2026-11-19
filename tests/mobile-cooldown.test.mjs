import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { effectScope } from 'vue'
import { cooldownRemaining, cooldownClock } from '../mobile/points.ts'

const base = 1794972646000
const cooling = () => ({ executable: false, reason: 'error.patrol.execution.cooldown', task: {
  id: 'task', pointId: 'point', projectId: 'project', standardSnapshot: [{ id: 'item', type: 'text' }],
  startTime: base - 60000, endTime: base + 7200000, completedCount: 1, requiredCount: 3,
  lastExecutionTime: base, cooldownMinutes: 60,
} })
test('倒计时沿真实上次打卡时间与分钟间隔计算，逐秒向上取整且不出现负数', () => {
  const row = cooling()
  assert.equal(cooldownClock(cooldownRemaining(row, base)), '01:00:00')
  assert.equal(cooldownClock(cooldownRemaining(row, base + 1000)), '00:59:59')
  assert.equal(cooldownClock(cooldownRemaining(row, base + 3599999)), '00:00:01')
  assert.equal(cooldownClock(cooldownRemaining(row, base + 3600000)), '00:00:00')
  assert.equal(cooldownRemaining(row, base + 3601000), 0)
  // 恢复后台直接按绝对时间重算，而非补计每个错过的 tick。
  assert.equal(cooldownClock(cooldownRemaining(row, base + 1800000)), '00:30:00')
  assert.equal(row.executable, false, '计时归零不能本地授予执行资格')
  const otherRole = { ...row, task: { ...row.task, cooldownMinutes: 120 } }
  assert.equal(cooldownClock(cooldownRemaining(otherRole, base + 1000)), '01:59:59')
})
test('缺失/无效冷却信息、非冷却状态、已完成或时段已过时不猜测倒计时', () => {
  const row = cooling()
  for (const extra of [{ lastExecutionTime: null }, { lastExecutionTime: undefined }, { lastExecutionTime: NaN }, { cooldownMinutes: undefined }, { cooldownMinutes: 0 }, { cooldownMinutes: -1 }, { cooldownMinutes: Infinity }, { completedCount: 3 }, { endTime: base }, { startTime: base + 1 }]) {
    assert.equal(cooldownRemaining({ ...row, task: { ...row.task, ...extra } }, base), undefined)
  }
  assert.equal(cooldownRemaining({ ...row, executable: true }, base), undefined)
  assert.equal(cooldownRemaining({ ...row, reason: 'error.patrol.execution.unassigned' }, base), undefined)
})

const compiled = await build({ stdin: { contents: `export {useMobilePatrol} from './mobile/useMobilePatrol';export {patrolProject} from './mobile/projectScope'`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'], plugins: [{ name: 'cooldown-refresh', setup(builder) {
    builder.onResolve({ filter: /^\.\/(api|transport)$/ }, args => args.importer.endsWith('/useMobilePatrol.ts') ? { path: args.path, namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === './transport'
      ? `export class MobileError extends Error{};export const resolveContext=async()=>({userId:'user',applicationId:'app'})`
      : `export const myTasks=(...args)=>globalThis.__cooldownRefresh.query(...args);export const myMissed=async()=>[];export const configurationOptions=async()=>[];export const myHistory=async()=>({data:[],total:0});export const authorizedHistory=myHistory;export const submit=async()=>({});export const upload=submit,preview=submit;` }))
  }}] })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports)
const { useMobilePatrol, patrolProject } = loaded.exports
function fixture(t, query) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } })
  globalThis.__cooldownRefresh = { query }
  patrolProject.value = 'project'
  const scope = effectScope(), state = scope.run(() => useMobilePatrol())
  state.selected.value = cooling()
  state.draft.value = { answers: [{ itemId: 'item', value: '未提交答案' }], remark: '草稿' }
  state.location.evidence.value = { longitude: 106, latitude: 29, source: 'device', coordinateSystem: 'WGS84', accuracy: 15, collectedTime: base }
  t.after(() => { scope.stop(); patrolProject.value = undefined; delete globalThis.__cooldownRefresh; if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage })
  return state
}
test('冷却归零后重新读取后端资格和次数，保留检查快照、答案、草稿和定位', async t => {
  const latest = { ...cooling(), executable: true, reason: '', task: { ...cooling().task, completedCount: 2, standardSnapshot: [{ id: 'new-standard' }] } }
  const state = fixture(t, async () => [latest])
  const draft = state.draft.value, sample = state.location.evidence.value, standard = state.selected.value.task.standardSnapshot
  await state.refreshEligibility()
  assert.equal(state.selected.value.executable, true)
  assert.equal(state.selected.value.reason, '')
  assert.equal(state.selected.value.task.completedCount, 2)
  assert.strictEqual(state.selected.value.task.standardSnapshot, standard)
  assert.strictEqual(state.draft.value, draft)
  assert.strictEqual(state.location.evidence.value, sample)
  assert.equal(state.loading.value, false)
})
test('后端仍冷却、读取失败或任务不可用不能按客户端时钟放开提交', async t => {
  const state = fixture(t, async () => [cooling()])
  await state.refreshEligibility(); assert.equal(state.selected.value.executable, false)
  globalThis.__cooldownRefresh.query = async () => { throw new Error('网络失败') }
  await state.refreshEligibility(); assert.equal(state.selected.value.executable, false); assert.equal(state.error.value, '网络失败')
  globalThis.__cooldownRefresh.query = async () => []
  await state.refreshEligibility(); assert.equal(state.selected.value.executable, false); assert.equal(state.selected.value.reason, 'error.patrol.reference.unavailable')
})
test('待确认提交不查询；重复点击只查询一次；切项目和离开后的迟到响应不覆盖新状态', async t => {
  let calls = 0, release
  const state = fixture(t, () => { calls++; return new Promise(resolve => { release = resolve }) })
  state.draft.value.pending = { requestId: 'frozen' }
  await state.refreshEligibility(); assert.equal(calls, 0)
  state.draft.value.pending = undefined
  const pending = state.refreshEligibility(); await state.refreshEligibility(); assert.equal(calls, 1)
  patrolProject.value = 'another'
  release([{ ...cooling(), executable: true }]); await pending
  assert.equal(state.selected.value.executable, false)
  patrolProject.value = 'project'
  const leaving = state.refreshEligibility()
  state.leave()
  release([{ ...cooling(), executable: true }]); await leaving
  assert.equal(state.selected.value, undefined)
})
