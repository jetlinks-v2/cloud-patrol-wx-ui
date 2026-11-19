import type { ConfigEntity } from '../api/types'
import type { MobileTask } from './model'
export interface PointGroup { id: string; name: string; rows: MobileTask[]; state: 'ready' | 'cooldown' | 'completed' | 'unavailable' }

/** 冷却截止沿后端的上次执行时间+间隔计算；字段缺失时不猜测剩余时间。 */
export function cooldownRemaining(row: MobileTask, now: number): number | undefined {
  const { lastExecutionTime, cooldownMinutes, startTime, endTime, completedCount, requiredCount } = row.task
  if (row.executable || row.reason !== 'error.patrol.execution.cooldown' || now < startTime || now >= endTime
    || completedCount >= requiredCount || typeof lastExecutionTime !== 'number' || !Number.isFinite(lastExecutionTime)
    || typeof cooldownMinutes !== 'number' || !Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return
  return Math.max(0, Math.ceil((lastExecutionTime + cooldownMinutes * 60000 - now) / 1000))
}
export function cooldownClock(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

/** 默认只展示当前时间窗；今日完成下钻允许已结束时段。点位内各角色、时段保留在详情。 */
export function pointGroups(rows: MobileTask[], keyword: string, category: string, categories: ConfigEntity[], now = Date.now(), includeEnded = false): PointGroup[] {
  const groups = new Map<string, PointGroup>()
  for (const row of rows) {
    const task = row.task, name = task.pointName || task.name
    if ((!includeEnded && (now < task.startTime || now >= task.endTime)) || !name.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())
      || !withinCategory(task.categoryId, category, categories)) continue
    const group = groups.get(task.pointId) || { id: task.pointId, name, rows: [], state: 'unavailable' }
    group.rows.push(row); groups.set(task.pointId, group)
  }
  for (const group of groups.values()) {
    group.state = group.rows.some(row => row.executable) ? 'ready'
      : group.rows.every(row => row.task.completedCount >= row.task.requiredCount) ? 'completed'
      : group.rows.some(row => row.reason === 'error.patrol.execution.cooldown') ? 'cooldown' : 'unavailable'
  }
  return [...groups.values()]
}
function withinCategory(id: string | undefined, selected: string, categories: ConfigEntity[]): boolean {
  if (!selected) return true
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    if (id === selected) return true
    seen.add(id); id = categories.find(item => item.id === id)?.parentId
  }
  return false
}
