import {
  type AccessionRecord,
  type BatchSpecimen,
  type IdentBatch,
  findBatchByEntry,
  readAccessions,
  readBatches,
  writeAccessions,
  writeBatches,
} from '@/data/ident-batch'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 鉴定编组台业务规则：
// 1. 同一批次同一时刻只允许一个版本落库 —— 所有写操作带 expectedVersion 乐观锁，版本不一致即拒绝。
// 2. 状态只进不退：编组中 → 鉴定中 → 已鉴定 → 已复核 → 已归档；进入鉴定后禁止增删标本，已归档永久锁定。
// 3. 同一种属批量回填与单件人工结论冲突时：单件人工结论优先，批量回填只填空、不覆盖。

export type BatchResult = { ok: boolean; message: string }

const BATCH_STATUSES: IdentBatch['status'][] = ['编组中', '鉴定中', '已鉴定', '已复核', '已归档']

function nowStamp(): string {
  const d = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function todayStamp(): string {
  return nowStamp().slice(0, 10)
}

// 单件最终采用结论：人工结论 > 整批回填。
export function effectiveSpecies(specimen: BatchSpecimen, batch: IdentBatch): string {
  return specimen.manualSpecies.trim() || batch.species.trim()
}

export function effectiveElement(specimen: BatchSpecimen, batch: IdentBatch): string {
  return specimen.manualElement.trim() || batch.element.trim()
}

// 标本在批次内时的台账状态标注。
function specimenStateText(batch: IdentBatch, specimen: BatchSpecimen): string {
  if (batch.status === '已鉴定') {
    const manual = specimen.manualSpecies || specimen.manualElement ? '·单件人工结论' : ''
    return `批次 ${batch.batchNo}（已鉴定${manual}）`
  }
  if (batch.status === '已复核' || batch.status === '已归档') {
    return `批次 ${batch.batchNo}（${batch.status}）`
  }
  return `批次 ${batch.batchNo}（${batch.status}）`
}

// 把批次状态/结论同步回动物骨骼标本台账，保证跨页面读到的是同一份结果。
function syncSpecimenRows(batch: IdentBatch): void {
  const rows = [...listRows('animal_bone')]
  const reviewedCount = batch.specimens.filter((item) => item.reviewed).length
  for (const specimen of batch.specimens) {
    const index = rows.findIndex((row) => Number(row.id) === specimen.entryId)
    if (index < 0) {
      continue
    }
    const inIdentification = batch.status !== '编组中'
    rows[index] = {
      ...rows[index],
      status: batch.status === '编组中' ? '已采集' : batch.status,
      pending: batch.status !== '已归档',
      abnormal: false,
      种属判定: inIdentification ? effectiveSpecies(specimen, batch) : '',
      骨骼部位: inIdentification ? effectiveElement(specimen, batch) : '',
      最小个体数: inIdentification ? batch.mni : '',
      鉴定人: inIdentification ? batch.appraiser : '',
      鉴定状态:
        batch.status === '已复核'
          ? `批次 ${batch.batchNo}（已复核 ${reviewedCount}/${batch.specimens.length}）`
          : specimenStateText(batch, specimen),
    }
  }
  saveRows('animal_bone', rows)
}

// 标本退出批次（仅限编组中）时，把标本恢复成未编组的已采集状态。
function releaseSpecimenRow(entryId: number): void {
  const rows = [...listRows('animal_bone')]
  const index = rows.findIndex((row) => Number(row.id) === entryId)
  if (index < 0) {
    return
  }
  rows[index] = {
    ...rows[index],
    status: '已采集',
    pending: true,
    abnormal: false,
    种属判定: '',
    骨骼部位: '',
    最小个体数: '',
    鉴定人: '',
    鉴定状态: '',
  }
  saveRows('animal_bone', rows)
}

type MutateOutcome = { ok: boolean; message: string; batch?: IdentBatch }

// 统一的批次落库入口：现读 localStorage → 校验乐观锁版本 → 应用变更 → 版本 +1 落库。
function mutateBatch(
  batchId: number,
  expectedVersion: number,
  allowedStatuses: IdentBatch['status'][],
  mutate: (batch: IdentBatch) => string | void,
): MutateOutcome {
  const batches = readBatches()
  const index = batches.findIndex((item) => item.id === batchId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const current = batches[index]
  if (current.version !== expectedVersion) {
    return {
      ok: false,
      message: `批次「${current.batchNo}」已有新版本落库（v${current.version}），当前持有的是 v${expectedVersion}，请刷新后重试，禁止覆盖提交`,
    }
  }
  if (!allowedStatuses.includes(current.status)) {
    return { ok: false, message: `批次「${current.batchNo}」当前为「${current.status}」，不能执行该操作` }
  }
  const error = mutate(current)
  if (error) {
    return { ok: false, message: error }
  }
  const updated: IdentBatch = { ...current, version: current.version + 1, updatedAt: nowStamp() }
  batches[index] = updated
  writeBatches(batches)
  return { ok: true, message: '', batch: updated }
}

// ---------- 编组 ----------

// 可编组的标本：未编入任何批次（含已归档批次——归档标本永久锁定，不允许重新编组）的已采集标本。
function uncollectedEntries(): EntryRow[] {
  return listRows('animal_bone').filter(
    (row) => String(row.status) === '已采集' && !findBatchByEntry(Number(row.id)),
  )
}

export function availableUnits(): string[] {
  return [...new Set(uncollectedEntries().map((row) => String(row['出土单位'] ?? '').trim()).filter(Boolean))]
}

export function availableSpecimens(unit: string): EntryRow[] {
  return uncollectedEntries().filter((row) => String(row['出土单位'] ?? '') === unit)
}

export function nextBatchNo(): string {
  const today = todayStamp().replace(/-/g, '')
  const prefix = `JDPC-${today}-`
  const seq = readBatches()
    .filter((batch) => batch.batchNo.startsWith(prefix))
    .reduce((max, batch) => {
      const tail = Number(batch.batchNo.slice(prefix.length))
      return Number.isFinite(tail) ? Math.max(max, tail) : max
    }, 0)
  return `${prefix}${String(seq + 1).padStart(3, '0')}`
}

export function createBatch(unit: string, appraiser: string, remark: string): BatchResult {
  const targetUnit = unit.trim()
  const candidates = availableSpecimens(targetUnit)
  if (!targetUnit) {
    return { ok: false, message: '请选择出土单位后再编组' }
  }
  if (!candidates.length) {
    return { ok: false, message: `出土单位「${targetUnit}」没有可编组的已采集标本` }
  }
  const batches = readBatches()
  const batch: IdentBatch = {
    id: batches.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    batchNo: nextBatchNo(),
    unit: targetUnit,
    status: '编组中',
    version: 1,
    specimens: candidates.map((row) => ({
      entryId: Number(row.id),
      manualSpecies: '',
      manualElement: '',
      reviewNote: '',
      reviewed: false,
      reviewer: '',
      reviewedAt: '',
    })),
    species: '',
    element: '',
    mni: 0,
    appraiser: appraiser.trim(),
    remark: remark.trim(),
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
    submittedAt: '',
    submittedVersion: 0,
    reviewedAt: '',
    archivedAt: '',
  }
  writeBatches([...batches, batch])
  syncSpecimenRows(batch)
  return { ok: true, message: `批次「${batch.batchNo}」已创建，编入 ${batch.specimens.length} 件标本` }
}

export function addSpecimens(batchId: number, expectedVersion: number, entryIds: number[]): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['编组中'], (batch) => {
    const existing = new Set(batch.specimens.map((item) => item.entryId))
    const additions = availableSpecimens(batch.unit).filter((row) => {
      const id = Number(row.id)
      return entryIds.includes(id) && !existing.has(id)
    })
    if (!additions.length) {
      return '所选标本都不可编入（须为同一出土单位、未编组的已采集标本）'
    }
    batch.specimens.push(
      ...additions.map((row) => ({
        entryId: Number(row.id),
        manualSpecies: '',
        manualElement: '',
        reviewNote: '',
        reviewed: false,
        reviewer: '',
        reviewedAt: '',
      })),
    )
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '标本已编入批次' }
}

export function removeSpecimen(batchId: number, expectedVersion: number, entryId: number): BatchResult {
  let removed = false
  const outcome = mutateBatch(batchId, expectedVersion, ['编组中'], (batch) => {
    const next = batch.specimens.filter((item) => item.entryId !== entryId)
    removed = next.length !== batch.specimens.length
    if (!removed) {
      return '该标本不在批次内'
    }
    batch.specimens = next
  })
  if (!outcome.ok) {
    return { ok: false, message: outcome.message }
  }
  if (removed) {
    releaseSpecimenRow(entryId)
  }
  return { ok: true, message: '标本已移出批次，回到已采集' }
}

export function disbandBatch(batchId: number, expectedVersion: number): BatchResult {
  const entryIds: number[] = []
  const batches = readBatches()
  const index = batches.findIndex((item) => item.id === batchId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的鉴定批次` }
  }
  const current = batches[index]
  if (current.version !== expectedVersion) {
    return { ok: false, message: '批次版本已变化，请刷新后重试' }
  }
  if (current.status !== '编组中') {
    return { ok: false, message: '批次已进入鉴定流程，不能解散，鉴定状态不允许跳回已采集' }
  }
  entryIds.push(...current.specimens.map((item) => item.entryId))
  writeBatches(batches.filter((item) => item.id !== batchId))
  entryIds.forEach(releaseSpecimenRow)
  return { ok: true, message: `编组批次「${current.batchNo}」已解散，标本全部回到已采集` }
}

// ---------- 鉴定 ----------

export function startIdentification(batchId: number, expectedVersion: number): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['编组中'], (batch) => {
    if (!batch.specimens.length) {
      return '批次里没有标本，不能开始鉴定'
    }
    batch.status = '鉴定中'
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '批次已进入鉴定，之后只能前进，不能退回已采集或重新编组' }
}

export type BatchConclusionInput = {
  species: string
  element: string
  mni: number
  appraiser: string
  remark: string
}

// 整批录入：只写批次级结论；单件行的最终值在同步时按「人工优先」合并，批量回填不覆盖人工结论。
export function saveBatchConclusion(
  batchId: number,
  expectedVersion: number,
  input: BatchConclusionInput,
): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['鉴定中'], (batch) => {
    batch.species = input.species.trim()
    batch.element = input.element.trim()
    batch.mni = Number.isFinite(input.mni) ? input.mni : 0
    batch.appraiser = input.appraiser.trim()
    batch.remark = input.remark.trim()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '整批鉴定结论已暂存（单件人工结论优先保留）' }
}

export function saveManualConclusion(
  batchId: number,
  expectedVersion: number,
  entryId: number,
  species: string,
  element: string,
): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['鉴定中'], (batch) => {
    const specimen = batch.specimens.find((item) => item.entryId === entryId)
    if (!specimen) {
      return '该标本不在批次内'
    }
    specimen.manualSpecies = species.trim()
    specimen.manualElement = element.trim()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '单件人工结论已保存，优先级高于整批回填' }
}

// 提交鉴定：状态落为已鉴定，并向库房架位台账幂等生成待入藏记录。
export function submitIdentification(batchId: number, expectedVersion: number): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['鉴定中'], (batch) => {
    if (!batch.species.trim() || !batch.element.trim()) {
      return '请先整批录入种属判定与骨骼部位'
    }
    if (!batch.appraiser.trim()) {
      return '请填写鉴定人后再提交'
    }
    if (!Number.isFinite(batch.mni) || batch.mni < 1) {
      return '请填写有效的最小个体数（≥1）后再提交'
    }
    batch.status = '已鉴定'
    batch.submittedAt = nowStamp()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  const batch = outcome.batch
  const finalized: IdentBatch = { ...batch, submittedVersion: batch.version }
  const batches = readBatches()
  const batchIndex = batches.findIndex((item) => item.id === batch.id)
  if (batchIndex >= 0) {
    batches[batchIndex] = finalized
    writeBatches(batches)
  }
  syncSpecimenRows(finalized)

  // 跨页面同步：按「批次+标本」幂等生成待入藏记录，重复提交不会产生第二条。
  const rows = listRows('animal_bone')
  const records = readAccessions()
  const have = new Set(records.map((record) => record.idemKey))
  let nextId = records.reduce((max, record) => Math.max(max, record.id), 0)
  for (const specimen of batch.specimens) {
    const idemKey = `${batch.id}:${specimen.entryId}`
    if (have.has(idemKey)) {
      continue
    }
    const row = rows.find((item) => Number(item.id) === specimen.entryId)
    records.push({
      id: ++nextId,
      idemKey,
      batchId: batch.id,
      batchNo: batch.batchNo,
      unit: batch.unit,
      entryId: specimen.entryId,
      specimenNo: row ? String(row['标本编号'] ?? `ANIM-${specimen.entryId}`) : `ANIM-${specimen.entryId}`,
      species: effectiveSpecies(specimen, batch),
      element: effectiveElement(specimen, batch),
      appraiser: batch.appraiser,
      identifiedAt: todayStamp(),
      status: '待入藏',
      shelfNo: '',
      storageName: '',
      accessionAt: '',
    })
  }
  writeAccessions(records)
  return {
    ok: true,
    message: `批次「${batch.batchNo}」鉴定完成（落库版本 v${batch.version}），已向库房架位台账同步 ${batch.specimens.length} 条待入藏记录`,
  }
}

// ---------- 逐件复核 ----------

export function saveReviewNote(
  batchId: number,
  expectedVersion: number,
  entryId: number,
  note: string,
  reviewer: string,
): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['已鉴定'], (batch) => {
    const specimen = batch.specimens.find((item) => item.entryId === entryId)
    if (!specimen) {
      return '该标本不在批次内'
    }
    if (!note.trim()) {
      return '复核意见不能为空'
    }
    specimen.reviewNote = note.trim()
    specimen.reviewed = true
    specimen.reviewer = reviewer.trim() || '值班管理员'
    specimen.reviewedAt = nowStamp()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '单件复核意见已补充' }
}

export function finishReview(batchId: number, expectedVersion: number): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['已鉴定'], (batch) => {
    const pending = batch.specimens.filter((item) => !item.reviewed)
    if (pending.length) {
      return `还有 ${pending.length} 件标本未补充复核意见，不能完成整批复核`
    }
    batch.status = '已复核'
    batch.reviewedAt = nowStamp()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '批次已完成复核' }
}

export function archiveBatch(batchId: number, expectedVersion: number): BatchResult {
  const outcome = mutateBatch(batchId, expectedVersion, ['已复核'], (batch) => {
    batch.status = '已归档'
    batch.archivedAt = nowStamp()
  })
  if (!outcome.ok || !outcome.batch) {
    return { ok: false, message: outcome.message }
  }
  syncSpecimenRows(outcome.batch)
  return { ok: true, message: '批次已归档，归档批次锁定，不允许重新编组或再改动' }
}

// ---------- 库房架位台账（跨页面） ----------

export function listBatches(): IdentBatch[] {
  return readBatches()
}

export function listAccessionRecords(): AccessionRecord[] {
  return readAccessions()
}

export function assignShelf(recordId: number, shelfNo: string, storageName: string): BatchResult {
  const targetShelf = shelfNo.trim()
  if (!targetShelf) {
    return { ok: false, message: '请填写架位编号后再登记入藏' }
  }
  const records = readAccessions()
  const index = records.findIndex((record) => record.id === recordId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${recordId} 的待入藏记录` }
  }
  if (records[index].status === '已入藏') {
    return { ok: false, message: '该记录已入藏，不能重复登记' }
  }
  records[index] = {
    ...records[index],
    status: '已入藏',
    shelfNo: targetShelf,
    storageName: storageName.trim(),
    accessionAt: todayStamp(),
  }
  writeAccessions(records)
  return { ok: true, message: `标本 ${records[index].specimenNo} 已登记入藏到架位 ${targetShelf}` }
}

export function batchStatuses(): IdentBatch['status'][] {
  return [...BATCH_STATUSES]
}
