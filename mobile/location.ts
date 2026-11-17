import { computed, onScopeDispose, ref } from 'vue'
import type { LocationEvidence, LocationReference, Task } from '../api/types'

/** 当前APP真实定位能力不可用（尚未提供定位桥接），默认演示采样；此限制仅记录于代码，不在业务页面展示。
 * 真机接入使用 VITE_PATROL_LOCATION_MODE=device；禁止将 demo 当作到场证明。
 */
const DEMO_MODE = import.meta.env.VITE_PATROL_LOCATION_MODE !== 'device'
const DEMO_CENTER = { longitude: 106.551556, latitude: 29.563009 }
export function referenceFor(task: Task): LocationReference {
  return { ...task.locationReference, rangeMeters: task.locationReference?.rangeMeters ?? 100 }
}
export function demoLocation(reference: LocationReference, now = Date.now()): LocationEvidence {
  const latitude = reference.latitude ?? DEMO_CENTER.latitude
  const longitude = reference.longitude ?? DEMO_CENTER.longitude
  // 稳定约28米偏移，重定位不会随机跳出范围；缺失参考只在演示中使用重庆中心坐标。
  return { longitude: longitude + 0.00018, latitude: latitude + 0.00020, accuracy: 18,
    collectedTime: now, coordinateSystem: 'WGS84', source: 'demo', address: reference.address || '点位附近' }
}
export function distanceTo(reference: LocationReference, evidence?: LocationEvidence | null): number | undefined {
  if (!evidence) return undefined
  const latitude = reference.latitude ?? (evidence.source === 'demo' ? DEMO_CENTER.latitude : undefined)
  const longitude = reference.longitude ?? (evidence.source === 'demo' ? DEMO_CENTER.longitude : undefined)
  if (latitude == null || longitude == null) return undefined
  const rad = Math.PI / 180, dLat = (evidence.latitude - latitude) * rad, dLng = (evidence.longitude - longitude) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latitude * rad) * Math.cos(evidence.latitude * rad) * Math.sin(dLng / 2) ** 2
  return Math.round(6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) * 10) / 10
}
export function locationStatus(reference: LocationReference, evidence?: LocationEvidence | null) {
  const distance = distanceTo(reference, evidence)
  if (!evidence || distance == null) return 'unknown'
  // 精度大于半径时不把范围计算当作可靠到点判断。
  if (evidence.accuracy > reference.rangeMeters) return 'inaccurate'
  return distance <= reference.rangeMeters ? 'inside' : 'outside'
}
function validEvidence(value: LocationEvidence): boolean {
  return value.coordinateSystem === 'WGS84' && value.source === 'device'
    && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
    && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 100000
    && Number.isFinite(value.collectedTime) && value.collectedTime > 0
}
async function deviceLocation(): Promise<LocationEvidence> {
  if (window.patrolHost?.getLocation) {
    const sample = await window.patrolHost.getLocation()
    if (!validEvidence(sample)) throw new Error('Invalid location')
    return sample
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location unavailable')); return }
    navigator.geolocation.getCurrentPosition(position => resolve({
      longitude: position.coords.longitude, latitude: position.coords.latitude, accuracy: position.coords.accuracy,
      collectedTime: position.timestamp, coordinateSystem: 'WGS84', source: 'device',
    }), reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
  })
}
/** 采样属于当前表单，离开/切换点位后丢弃迟到结果；网络重试沿用已冻结样本。 */
export function usePatrolLocation() {
  const evidence = ref<LocationEvidence>(), reference = ref<LocationReference>({ rangeMeters: 100 }), locating = ref(false)
  let generation = 0, disposed = false
  async function refresh() {
    const current = ++generation
    locating.value = true
    try {
      const sample = DEMO_MODE ? demoLocation(reference.value) : await deviceLocation()
      if (!disposed && current === generation) evidence.value = sample
    } catch {
      // 真实模式定位失败只作“待定位”，不回退成模拟到场数据，不阻断本轮辅助巡更。
      if (!disposed && current === generation) evidence.value = undefined
    } finally { if (!disposed && current === generation) locating.value = false }
  }
  function open(task: Task, sample?: LocationEvidence | null, frozen = false) {
    generation++; evidence.value = sample ?? undefined; reference.value = referenceFor(task)
    if (!frozen) void refresh()
  }
  function clear() { generation++; evidence.value = undefined; locating.value = false }
  onScopeDispose(() => { disposed = true; generation++ })
  return { evidence, reference, locating, open, clear, refresh,
    distance: computed(() => distanceTo(reference.value, evidence.value)),
    status: computed(() => locationStatus(reference.value, evidence.value)) }
}
