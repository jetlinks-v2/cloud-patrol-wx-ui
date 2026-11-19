import type { Execution, Page, Query, AttachmentReceipt, ConfigEntity } from '../api/types'
import type { MobileTask, Submission } from './model'
import { request, resolveContext, type MobileContext } from './transport'
import { patrolProject } from './projectScope'
import { hasLocationCoordinates, referenceFor } from './location'

/** 旧任务可能冻结了空坐标；仅补读其关联点位，不覆盖有效快照或改变执行资格。 */
export async function myTasks(date: string, mine = true, nfcCode?: string): Promise<MobileTask[]> {
  const projectId = patrolProject.value, context = await resolveContext()
  const assertCurrent = () => {
    if (patrolProject.value !== projectId) throw new Error('Mobile.contextChanged')
  }
  assertCurrent()
  const rows = await request<MobileTask[]>('/park/patrol/mobile/tasks/_query', 'POST',
    { date, mine, ...(nfcCode == null ? {} : { nfcCode }) }, projectId, context)
  assertCurrent()
  // 范围仍以任务快照为准，包括显式无效范围；不能用点位读取重置巡更标准。
  const missing = rows.filter(row => !hasLocationCoordinates(row.task.locationReference))
  const ids = [...new Set(missing.map(row => row.task.pointId))]
  const points = new Map<string, ConfigEntity>()
  const failed = new Set<string>()
  for (let offset = 0; offset < ids.length; offset += 4) {
    assertCurrent()
    await Promise.all(ids.slice(offset, offset + 4).map(async id => {
      try {
        if (!projectId || !id || missing.some(row => row.task.pointId === id && row.task.projectId !== projectId))
          throw new Error('Mobile.contextChanged')
        const point = await request<ConfigEntity>(`/park/patrol/points/${encodeURIComponent(id)}`, 'GET', undefined, projectId, context)
        if (point.id !== id || point.projectId !== projectId) throw new Error('Mobile.contextChanged')
        points.set(id, point)
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'Mobile.contextChanged'
          || (cause as { status?: number })?.status === 401) throw cause
        failed.add(id)
      }
    }))
    assertCurrent()
  }
  return rows.map(row => {
    if (!missing.includes(row)) return row
    const point = points.get(row.task.pointId)
    return { ...row, locationReferenceError: failed.has(row.task.pointId) ? 'Mobile.geo.referenceLoadFailed' : undefined,
      task: { ...row.task, locationReference: { ...referenceFor(row.task),
        longitude: point?.longitude, latitude: point?.latitude, address: point?.locationAddress } } }
  })
}
/** 按授权分页读取完整选项；分类超过一页时不能静默丢失候选。 */
export async function configurationOptions(resource: 'categories' | 'levels' | 'tags' | 'roles' | 'standards' | 'persons', projectId: string | undefined = patrolProject.value): Promise<ConfigEntity[]> {
  const rows: ConfigEntity[] = []
  for (let pageIndex = 0; ; pageIndex++) {
    const page = await request<Page<ConfigEntity>>(`/park/patrol/${resource}/_query`, 'POST',
      { pageIndex, pageSize: 200, sorts: [{ name: 'name', order: 'asc' }, { name: 'id', order: 'asc' }] }, projectId)
    rows.push(...page.data)
    if (rows.length >= page.total) return rows
    if (!page.data.length) throw new Error('Mobile.requestFailed')
  }
}
export const myHistory = (query: Query) => request<Page<Execution>>('/park/patrol/mobile/history/_query', 'POST', query)
/** 管理人员的历史查询沿用PC资产过滤接口，不能用移动端本人接口冒充全员记录。 */
export const authorizedHistory = (query: Query) => request<Page<Execution>>('/park/patrol/executions/_query', 'POST', query)
export const submit = (body: Submission, projectId?: string, expected?: Pick<MobileContext, 'applicationId' | 'userId'>) => request<Execution>('/park/patrol/executions', 'POST', body, projectId, expected)
export const upload = (file: File, projectId?: string, expected?: Pick<MobileContext, 'applicationId' | 'userId'>) => {
  const body = new FormData(); body.append('file', file)
  return request<AttachmentReceipt>('/park/patrol/attachments/evidence', 'POST', body, projectId, expected)
}
export const preview = (id: string, projectId?: string) => request<{ dataUrl: string }>(`/park/patrol/attachments/${encodeURIComponent(id)}/preview`, 'GET', undefined, projectId)

export const myMissed = (from: string, to: string) => request<import('../model/missed').MissedItem[]>('/park/patrol/mobile/missed/_query', 'POST', { from, to })
export const applyMyMissed = (itemIds: string[], reason: string) => request<number>('/park/patrol/mobile/missed/apply', 'POST', { itemIds, reason })
export const withdrawMyMissed = (item: import('../model/missed').MissedItem) => request<number>('/park/patrol/mobile/missed/withdraw', 'POST', { itemId: item.id, applicationId: item.applicationId })
export const myMissedHistory = (id: string) => request<import('../model/missed').MissedEvent[]>(`/park/patrol/mobile/missed/${encodeURIComponent(id)}/history`, 'GET')
