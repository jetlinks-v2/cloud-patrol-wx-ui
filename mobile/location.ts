import { computed, onScopeDispose, ref } from 'vue'
import type { LocationEvidence, LocationReference, Task } from '../api/types'

export function referenceFor(task: Task): LocationReference {
  return { ...task.locationReference, rangeMeters: task.locationReference?.rangeMeters ?? 100 }
}
/** 只把设备返回的 WGS84 样本作为定位依据；旧演示记录不参与实际距离判断。 */
export function isDeviceLocation(value?: LocationEvidence | null): value is LocationEvidence {
  return !!value && value.coordinateSystem === 'WGS84' && value.source === 'device'
    && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
    && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 100000
    && Number.isFinite(value.collectedTime) && value.collectedTime > 0
}
export function hasLocationCoordinates(reference?: Pick<LocationReference, 'latitude' | 'longitude'> | null): reference is { latitude: number; longitude: number } {
  return !!reference && typeof reference.latitude === 'number' && Number.isFinite(reference.latitude) && Math.abs(reference.latitude) <= 90
    && typeof reference.longitude === 'number' && Number.isFinite(reference.longitude) && Math.abs(reference.longitude) <= 180
}
export function hasLocationReference(reference: LocationReference): reference is LocationReference & { latitude: number; longitude: number } {
  return hasLocationCoordinates(reference) && Number.isFinite(reference.rangeMeters) && reference.rangeMeters > 0
}
export function distanceTo(reference: LocationReference, evidence?: LocationEvidence | null): number | undefined {
  if (!isDeviceLocation(evidence) || !hasLocationReference(reference)) return undefined
  const latitude = reference.latitude, longitude = reference.longitude
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
/** 优先使用宿主已有定位；无宿主能力时使用浏览器定位，不生成替代坐标。 */
async function deviceLocation(): Promise<LocationEvidence> {
  if (window.patrolHost?.getLocation) {
    const sample = await window.patrolHost.getLocation()
    if (!isDeviceLocation(sample)) throw new Error('Mobile.geo.invalid')
    return { ...sample }
  }
  if (!window.isSecureContext) throw new Error('Mobile.geo.insecure')
  if (!navigator.geolocation) throw new Error('Mobile.geo.unsupported')
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const sample: LocationEvidence = {
        longitude: position.coords.longitude, latitude: position.coords.latitude, accuracy: position.coords.accuracy,
        collectedTime: position.timestamp, coordinateSystem: 'WGS84', source: 'device',
      }
      if (isDeviceLocation(sample)) resolve(sample)
      else reject(new Error('Mobile.geo.invalid'))
    }, cause => reject(new Error(cause.code === 1 ? 'Mobile.geo.denied' : cause.code === 3 ? 'Mobile.geo.timeout' : 'Mobile.geo.unavailable')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
  })
}
/** 采样属于当前表单，离开/切换点位后丢弃迟到结果；网络重试沿用已冻结样本。 */
export function usePatrolLocation() {
  const evidence = ref<LocationEvidence>(), reference = ref<LocationReference>({ rangeMeters: 100 }), locating = ref(false)
  const error = ref('')
  let generation = 0, disposed = false
  async function refresh() {
    const current = ++generation
    // 重定位期间清空上一份样本，避免失败后继续显示旧的‘范围内’或提交旧坐标。
    evidence.value = undefined; error.value = ''; locating.value = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const sample = await Promise.race([deviceLocation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mobile.geo.timeout')), 12000)
      })])
      if (!disposed && current === generation) evidence.value = sample
    } catch (cause) {
      if (!disposed && current === generation) {
        evidence.value = undefined
        const key = cause instanceof Error ? cause.message : ''
        error.value = ['Mobile.geo.invalid', 'Mobile.geo.insecure', 'Mobile.geo.unsupported', 'Mobile.geo.denied', 'Mobile.geo.timeout', 'Mobile.geo.unavailable'].includes(key)
          ? key : 'Mobile.geo.unavailable'
      }
    } finally { clearTimeout(timer); if (!disposed && current === generation) locating.value = false }
  }
  function open(task: Task, sample?: LocationEvidence | null, frozen = false) {
    generation++; evidence.value = isDeviceLocation(sample) ? { ...sample } : undefined; reference.value = referenceFor(task)
    error.value = sample && !isDeviceLocation(sample) ? 'Mobile.geo.legacyDemo' : ''; locating.value = false
    if (!frozen) void refresh()
  }
  function clear() { generation++; evidence.value = undefined; error.value = ''; locating.value = false }
  onScopeDispose(() => { disposed = true; generation++ })
  return { evidence, reference, locating, error, open, clear, refresh,
    distance: computed(() => distanceTo(reference.value, evidence.value)),
    status: computed(() => locationStatus(reference.value, evidence.value)) }
}
