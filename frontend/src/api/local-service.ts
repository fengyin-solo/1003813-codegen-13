import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// ===== 动物骨骼鉴定编组台：模块键与业务约定 =====
const ANIMAL_BONE_KEY = 'animal_bone'
const BONE_BATCH_KEY = 'animal_bone_batch'
const STORAGE_MODULE_KEY = 'storage'

// 批次状态机：编组中 → 鉴定中 → 已鉴定 → 已归档，只允许单向流转，不能跳回上一态。
// 冲突处理约定：单件人工结论优先于同种属批量回填。
// 批量回填只覆盖「结论来源」不是「人工」的标本；人工结论无论登记在回填之前还是之后，都以人工为准。
const MANUAL_SOURCE = '人工'
const BACKFILL_SOURCE = '批量回填'

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function findBatch(batchId: number): { batches: EntryRow[]; batch: EntryRow } | null {
  const batches = listRows(BONE_BATCH_KEY)
  const batch = batches.find((row) => Number(row.id) === batchId)
  return batch ? { batches, batch } : null
}

// 批次级提交都要带页面看到的版本号：不一致说明别人已先落库，本次提交作废。
function checkBatchVersion(batch: EntryRow, expectedVersion: number): ActionResult | null {
  if (Number(batch['版本号']) !== expectedVersion) {
    return {
      ok: false,
      message: `批次${batch['批次编号']}已有新版本落库（当前版本${batch['版本号']}），本次提交被拒绝，请刷新后重试`,
    }
  }
  return null
}

function boneBatchMembers(code: string): EntryRow[] {
  return listRows(ANIMAL_BONE_KEY).filter((row) => String(row['所属批次'] ?? '') === code)
}

// 标本能不能编组：已采集、未入批；已归档批次的标本不允许重新编组。
function checkGroupable(row: EntryRow, unit: string): string | null {
  if (String(row['出土单位']) !== unit) {
    return `标本${row['标本编号']}不属于出土单位「${unit}」，同一批次只能编入同一出土单位`
  }
  const code = String(row['所属批次'] ?? '')
  if (code) {
    const owner = listRows(BONE_BATCH_KEY).find((batch) => String(batch['批次编号']) === code)
    if (owner && String(owner.status) === '已归档') {
      return `标本${row['标本编号']}所属的批次${code}已归档，已归档批次不允许重新编组`
    }
    return `标本${row['标本编号']}已属于批次${code}，不能重复编组`
  }
  if (String(row.status) !== '已采集') {
    return `标本${row['标本编号']}当前状态为「${row.status}」，只有已采集的标本可以编组`
  }
  return null
}

export function listBoneBatches(): EntryRow[] {
  return listRows(BONE_BATCH_KEY)
}

export function listUngroupedBones(): EntryRow[] {
  return listRows(ANIMAL_BONE_KEY).filter(
    (row) => !row['所属批次'] && String(row.status) === '已采集',
  )
}

export function listBoneBatchMembers(code: string): EntryRow[] {
  return boneBatchMembers(code)
}

export function createBoneBatch(unit: string, specimenIds: number[]): ActionResult & { batchId?: number } {
  const trimmed = unit.trim()
  if (!trimmed) {
    return { ok: false, message: '先选择出土单位再编组' }
  }
  if (specimenIds.length === 0) {
    return { ok: false, message: '至少选择一件标本才能组成鉴定批次' }
  }
  const bones = listRows(ANIMAL_BONE_KEY)
  const idSet = new Set(specimenIds)
  const picked = bones.filter((row) => idSet.has(Number(row.id)))
  if (picked.length !== specimenIds.length) {
    return { ok: false, message: '选中的标本里有已不存在的记录，请刷新后重选' }
  }
  for (const row of picked) {
    const problem = checkGroupable(row, trimmed)
    if (problem) {
      return { ok: false, message: problem }
    }
  }
  const batches = listRows(BONE_BATCH_KEY)
  const id = nextId(batches)
  const code = `ABTC-${String(id).padStart(4, '0')}`
  const batch: EntryRow = {
    id,
    status: '编组中',
    pending: true,
    abnormal: false,
    批次编号: code,
    出土单位: trimmed,
    标本件数: picked.length,
    种属判定: '',
    骨骼部位: '',
    最小个体数: '',
    鉴定人: '',
    批次状态: '编组中',
    版本号: 1,
  }
  const nextBones = bones.map((row) =>
    idSet.has(Number(row.id))
      ? { ...row, 所属批次: code, 结论来源: '', 复核意见: '', 复核人: '' }
      : row,
  )
  saveRows(ANIMAL_BONE_KEY, nextBones)
  saveRows(BONE_BATCH_KEY, [...batches, batch])
  return { ok: true, message: `已组成鉴定批次${code}，共${picked.length}件标本，当前状态「编组中」`, batchId: id }
}

export function addToBoneBatch(batchId: number, specimenIds: number[], expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '编组中') {
    return { ok: false, message: `批次${batch['批次编号']}已进入「${batch.status}」，编组已锁定，不能再加入标本` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  if (specimenIds.length === 0) {
    return { ok: false, message: '先勾选要加入批次的标本' }
  }
  const unit = String(batch['出土单位'])
  const bones = listRows(ANIMAL_BONE_KEY)
  const idSet = new Set(specimenIds)
  const picked = bones.filter((row) => idSet.has(Number(row.id)))
  if (picked.length !== specimenIds.length) {
    return { ok: false, message: '选中的标本里有已不存在的记录，请刷新后重选' }
  }
  for (const row of picked) {
    const problem = checkGroupable(row, unit)
    if (problem) {
      return { ok: false, message: problem }
    }
  }
  const nextBones = bones.map((row) =>
    idSet.has(Number(row.id))
      ? { ...row, 所属批次: batch['批次编号'], 结论来源: '', 复核意见: '', 复核人: '' }
      : row,
  )
  const nextBatch: EntryRow = {
    ...batch,
    标本件数: Number(batch['标本件数']) + picked.length,
    版本号: Number(batch['版本号']) + 1,
  }
  saveRows(ANIMAL_BONE_KEY, nextBones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  return { ok: true, message: `已把${picked.length}件标本加入批次${batch['批次编号']}` }
}

export function removeFromBoneBatch(batchId: number, specimenId: number, expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '编组中') {
    return { ok: false, message: `批次${batch['批次编号']}已进入「${batch.status}」，编组已锁定，不能移出标本` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  const members = boneBatchMembers(String(batch['批次编号']))
  const target = members.find((row) => Number(row.id) === specimenId)
  if (!target) {
    return { ok: false, message: `批次${batch['批次编号']}里没有编号为 ${specimenId} 的标本` }
  }
  if (members.length <= 1) {
    return { ok: false, message: '批次至少保留一件标本，不能全部移出' }
  }
  const bones = listRows(ANIMAL_BONE_KEY).map((row) =>
    Number(row.id) === specimenId
      ? { ...row, 所属批次: '', 结论来源: '', 复核意见: '', 复核人: '' }
      : row,
  )
  const nextBatch: EntryRow = {
    ...batch,
    标本件数: members.length - 1,
    版本号: Number(batch['版本号']) + 1,
  }
  saveRows(ANIMAL_BONE_KEY, bones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  return { ok: true, message: `已把标本${target['标本编号']}移出批次${batch['批次编号']}` }
}

export function startBoneBatch(batchId: number, expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '编组中') {
    return { ok: false, message: `批次${batch['批次编号']}当前状态为「${batch.status}」，只有编组中的批次可以开始鉴定` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  const members = boneBatchMembers(String(batch['批次编号']))
  if (members.length === 0) {
    return { ok: false, message: `批次${batch['批次编号']}里还没有标本，不能开始鉴定` }
  }
  const memberIds = new Set(members.map((row) => Number(row.id)))
  const bones = listRows(ANIMAL_BONE_KEY).map((row) =>
    memberIds.has(Number(row.id)) ? { ...row, status: '鉴定中', pending: true } : row,
  )
  const nextBatch: EntryRow = {
    ...batch,
    status: '鉴定中',
    批次状态: '鉴定中',
    版本号: Number(batch['版本号']) + 1,
  }
  saveRows(ANIMAL_BONE_KEY, bones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  return { ok: true, message: `批次${batch['批次编号']}已进入鉴定，${members.length}件标本转为「鉴定中」，进入鉴定后不能跳回已采集` }
}

export type BackfillPayload = {
  种属判定: string
  骨骼部位: string
  最小个体数: number
  鉴定人: string
}

export function backfillBoneBatch(batchId: number, payload: BackfillPayload, expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '鉴定中') {
    return { ok: false, message: `批次${batch['批次编号']}当前状态为「${batch.status}」，只有鉴定中的批次可以批量回填` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  if (!payload.种属判定.trim() || !payload.骨骼部位.trim() || !payload.鉴定人.trim()) {
    return { ok: false, message: '批量回填需要同时填写种属判定、骨骼部位与鉴定人' }
  }
  if (!Number.isInteger(payload.最小个体数) || payload.最小个体数 < 1) {
    return { ok: false, message: '最小个体数需要是不小于 1 的整数' }
  }
  const members = boneBatchMembers(String(batch['批次编号']))
  const memberIds = new Set(members.map((row) => Number(row.id)))
  let filled = 0
  let skipped = 0
  const bones = listRows(ANIMAL_BONE_KEY).map((row) => {
    if (!memberIds.has(Number(row.id))) {
      return row
    }
    // 人工单件结论优先：已有人工结论的标本不被批量回填覆盖
    if (String(row['结论来源'] ?? '') === MANUAL_SOURCE) {
      skipped += 1
      return row
    }
    filled += 1
    return {
      ...row,
      种属判定: payload.种属判定.trim(),
      骨骼部位: payload.骨骼部位.trim(),
      最小个体数: payload.最小个体数,
      鉴定人: payload.鉴定人.trim(),
      结论来源: BACKFILL_SOURCE,
    }
  })
  const nextBatch: EntryRow = {
    ...batch,
    种属判定: payload.种属判定.trim(),
    骨骼部位: payload.骨骼部位.trim(),
    最小个体数: payload.最小个体数,
    鉴定人: payload.鉴定人.trim(),
    版本号: Number(batch['版本号']) + 1,
  }
  saveRows(ANIMAL_BONE_KEY, bones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  const skipNote = skipped > 0 ? `，跳过${skipped}件已有人工结论的标本（人工结论优先）` : ''
  return { ok: true, message: `批次${batch['批次编号']}批量回填完成：覆盖${filled}件${skipNote}` }
}

export type ReviewPayload = {
  种属判定: string
  骨骼部位: string
  复核意见: string
  复核人: string
}

export function saveBoneReview(specimenId: number, payload: ReviewPayload): ActionResult {
  const bones = listRows(ANIMAL_BONE_KEY)
  const specimen = bones.find((row) => Number(row.id) === specimenId)
  if (!specimen) {
    return { ok: false, message: `没有找到编号为 ${specimenId} 的动物骨骼标本` }
  }
  const code = String(specimen['所属批次'] ?? '')
  if (!code) {
    return { ok: false, message: `标本${specimen['标本编号']}还没有编入鉴定批次，不能登记复核意见` }
  }
  const found = listRows(BONE_BATCH_KEY).find((row) => String(row['批次编号']) === code)
  if (!found) {
    return { ok: false, message: `标本${specimen['标本编号']}所属的批次${code}不存在，请刷新后重试` }
  }
  if (String(found.status) !== '鉴定中') {
    return { ok: false, message: `批次${code}当前状态为「${found.status}」，只有鉴定中的批次可以逐件补充复核意见` }
  }
  if (!payload.复核意见.trim() || !payload.复核人.trim()) {
    return { ok: false, message: '复核意见与复核人都需要填写' }
  }
  const manual = payload.种属判定.trim() !== '' || payload.骨骼部位.trim() !== ''
  const nextBones = bones.map((row) => {
    if (Number(row.id) !== specimenId) {
      return row
    }
    const updated: EntryRow = {
      ...row,
      复核意见: payload.复核意见.trim(),
      复核人: payload.复核人.trim(),
    }
    if (manual) {
      // 单件人工结论：登记后标记为「人工」，之后的批量回填不再覆盖这件
      if (payload.种属判定.trim() !== '') {
        updated['种属判定'] = payload.种属判定.trim()
      }
      if (payload.骨骼部位.trim() !== '') {
        updated['骨骼部位'] = payload.骨骼部位.trim()
      }
      updated['结论来源'] = MANUAL_SOURCE
    }
    return updated
  })
  const batches = listRows(BONE_BATCH_KEY).map((row) =>
    String(row['批次编号']) === code ? { ...row, 版本号: Number(row['版本号']) + 1 } : row,
  )
  saveRows(ANIMAL_BONE_KEY, nextBones)
  saveRows(BONE_BATCH_KEY, batches)
  return { ok: true, message: `标本${specimen['标本编号']}的复核意见已登记${manual ? '，单件人工结论已优先保留' : ''}` }
}

export function completeBoneBatch(batchId: number, expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '鉴定中') {
    return { ok: false, message: `批次${batch['批次编号']}当前状态为「${batch.status}」，只有鉴定中的批次可以完成鉴定` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  if (!batch['种属判定'] || !batch['骨骼部位'] || !batch['最小个体数']) {
    return { ok: false, message: `批次${batch['批次编号']}还没有批量回填种属判定、骨骼部位与最小个体数，先回填再完成鉴定` }
  }
  const members = boneBatchMembers(String(batch['批次编号']))
  const unconcluded = members.filter((row) => !row['种属判定'] || !row['骨骼部位'])
  if (unconcluded.length > 0) {
    const codes = unconcluded.map((row) => row['标本编号']).join('、')
    return { ok: false, message: `标本${codes}还缺少种属判定或骨骼部位，先批量回填或逐件人工结论` }
  }
  const memberIds = new Set(members.map((row) => Number(row.id)))
  const bones = listRows(ANIMAL_BONE_KEY).map((row) =>
    memberIds.has(Number(row.id)) ? { ...row, status: '已鉴定', pending: true } : row,
  )
  const nextBatch: EntryRow = {
    ...batch,
    status: '已鉴定',
    批次状态: '已鉴定',
    版本号: Number(batch['版本号']) + 1,
  }
  // 跨页面同步：库房架位台账为每件标本生成一条待入藏记录，已存在的跳过，保证重复提交不产生重复台账
  const storageRows = listRows(STORAGE_MODULE_KEY)
  let storageId = nextId(storageRows)
  const pendingRows: EntryRow[] = []
  for (const member of members) {
    const exists = storageRows.some(
      (row) =>
        String(row['来源批次'] ?? '') === String(batch['批次编号']) &&
        String(row['标本编号'] ?? '') === String(member['标本编号']),
    )
    if (exists) {
      continue
    }
    pendingRows.push({
      id: storageId,
      status: '待入藏',
      pending: true,
      abnormal: false,
      架位编号: `PEND-${member['标本编号']}`,
      库房名称: '待分配',
      存放器物类别: '动物骨骼标本',
      架位层数: '待上架',
      容纳件数: 1,
      当前件数: 0,
      管理人: String(batch['鉴定人'] ?? ''),
      架位状态: '待入藏',
      来源批次: String(batch['批次编号']),
      标本编号: String(member['标本编号']),
      出土单位: String(batch['出土单位']),
    })
    storageId += 1
  }
  saveRows(ANIMAL_BONE_KEY, bones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  if (pendingRows.length > 0) {
    saveRows(STORAGE_MODULE_KEY, [...storageRows, ...pendingRows])
  }
  return {
    ok: true,
    message: `批次${batch['批次编号']}已完成鉴定，${members.length}件标本转为「已鉴定」，库房架位台账同步生成${pendingRows.length}条待入藏记录`,
  }
}

export function archiveBoneBatch(batchId: number, expectedVersion: number): ActionResult {
  const found = findBatch(batchId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const { batches, batch } = found
  if (String(batch.status) !== '已鉴定') {
    return { ok: false, message: `批次${batch['批次编号']}当前状态为「${batch.status}」，只有已鉴定的批次可以归档` }
  }
  const versionError = checkBatchVersion(batch, expectedVersion)
  if (versionError) {
    return versionError
  }
  const members = boneBatchMembers(String(batch['批次编号']))
  const memberIds = new Set(members.map((row) => Number(row.id)))
  const bones = listRows(ANIMAL_BONE_KEY).map((row) =>
    memberIds.has(Number(row.id)) ? { ...row, status: '已归档', pending: false } : row,
  )
  const nextBatch: EntryRow = {
    ...batch,
    status: '已归档',
    pending: false,
    批次状态: '已归档',
    版本号: Number(batch['版本号']) + 1,
  }
  saveRows(ANIMAL_BONE_KEY, bones)
  saveRows(BONE_BATCH_KEY, batches.map((row) => (Number(row.id) === batchId ? nextBatch : row)))
  return { ok: true, message: `批次${batch['批次编号']}已归档，${members.length}件标本同步归档，归档后不允许重新编组` }
}

// 已编组标本的动作守卫：批次进入鉴定后不能跳回已采集，已归档批次的标本整体锁定。
function boneActionGuard(row: EntryRow, action: string, target: string): ActionResult | null {
  const code = String(row['所属批次'] ?? '')
  if (!code) {
    return null
  }
  const batch = listRows(BONE_BATCH_KEY).find((item) => String(item['批次编号']) === code)
  if (!batch) {
    return null
  }
  const batchStatus = String(batch.status)
  if (batchStatus === '已归档') {
    return { ok: false, message: `标本所属批次${code}已归档，标本已锁定，不能再执行「${action}」` }
  }
  if (target === '已采集') {
    return { ok: false, message: `批次${code}已进入鉴定流程，标本不能跳回已采集` }
  }
  if (batchStatus === '编组中' || batchStatus === '鉴定中') {
    return { ok: false, message: `标本已编入批次${code}（${batchStatus}），请通过鉴定编组台流转` }
  }
  return null
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === ANIMAL_BONE_KEY) {
    const guard = boneActionGuard(rows[index], action, target)
    if (guard) {
      return guard
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
