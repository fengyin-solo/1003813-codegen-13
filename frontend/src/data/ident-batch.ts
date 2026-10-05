// 鉴定编组台专用数据：鉴定批次 + 跨页面同步给库房架位台账的待入藏记录。
// 与通用 EntryRow 存储分开：批次里挂着单件结构，不能被通用列表接口压扁或误改。

export type IdentBatchStatus = '编组中' | '鉴定中' | '已鉴定' | '已复核' | '已归档'

// 批次内的单件标本：entryId 对应 animal_bone 表里的标本行。
export type BatchSpecimen = {
  entryId: number
  // 单件人工结论：与整批回填冲突时，以人工结论为准（最高优先级）。
  manualSpecies: string
  manualElement: string
  // 提交鉴定之后逐件补充的复核意见。
  reviewNote: string
  reviewed: boolean
  reviewer: string
  reviewedAt: string
}

export type IdentBatch = {
  id: number
  batchNo: string
  unit: string
  status: IdentBatchStatus
  // 乐观锁版本号：每次落库 +1，提交时校验调用方持有的版本，同一时刻只允许一个版本落库。
  version: number
  specimens: BatchSpecimen[]
  // 整批录入的种属判定、骨骼部位、最小个体数（最小个体数按出土单位在批次级判定）。
  species: string
  element: string
  mni: number
  appraiser: string
  remark: string
  createdAt: string
  updatedAt: string
  submittedAt: string
  submittedVersion: number
  reviewedAt: string
  archivedAt: string
}

export type AccessionStatus = '待入藏' | '已入藏'

// 库房架位台账里的待入藏记录：鉴定完成时按「批次+标本」幂等生成。
export type AccessionRecord = {
  id: number
  idemKey: string
  batchId: number
  batchNo: string
  unit: string
  entryId: number
  specimenNo: string
  species: string
  element: string
  appraiser: string
  identifiedAt: string
  status: AccessionStatus
  shelfNo: string
  storageName: string
  accessionAt: string
}

const BATCH_STORAGE_KEY = 'field-archaeology-digital:ident-batches'
const ACCESSION_STORAGE_KEY = 'field-archaeology-digital:accession-records'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 首次打开时的演示批次：H3 已鉴定完成，3 件标本、2 条待入藏复核意见，台账里挂着 3 条待入藏记录。
export const SEED_BATCHES: IdentBatch[] = [
  {
    id: 1,
    batchNo: 'JDPC-20261005-001',
    unit: 'H3',
    status: '已鉴定',
    version: 3,
    specimens: [
      {
        entryId: 1,
        manualSpecies: '',
        manualElement: '',
        reviewNote: '下颌左侧，M3 已完全萌出但磨耗较轻，判定为成年个体，同意家猪。',
        reviewed: true,
        reviewer: '王敏',
        reviewedAt: '2026-10-05 11:02',
      },
      {
        entryId: 2,
        // 与批量回填（家猪）冲突，按规则保留人工结论「黄牛」。
        manualSpecies: '黄牛',
        manualElement: '',
        reviewNote: '',
        reviewed: false,
        reviewer: '',
        reviewedAt: '',
      },
      {
        entryId: 3,
        manualSpecies: '',
        manualElement: '',
        reviewNote: '',
        reviewed: false,
        reviewer: '',
        reviewedAt: '',
      },
    ],
    species: '家猪',
    element: '下颌骨',
    mni: 2,
    appraiser: '陈默',
    remark: 'H3 灰坑出土骨骼整批鉴定，ANIM-0002 经单件复核改为黄牛。',
    createdAt: '2026-10-05 08:40',
    updatedAt: '2026-10-05 10:05',
    submittedAt: '2026-10-05 10:05',
    submittedVersion: 3,
    reviewedAt: '',
    archivedAt: '',
  },
]

export const SEED_ACCESSIONS: AccessionRecord[] = [
  {
    id: 1,
    idemKey: '1:1',
    batchId: 1,
    batchNo: 'JDPC-20261005-001',
    unit: 'H3',
    entryId: 1,
    specimenNo: 'ANIM-0001',
    species: '家猪',
    element: '下颌骨',
    appraiser: '陈默',
    identifiedAt: '2026-10-05',
    status: '待入藏',
    shelfNo: '',
    storageName: '',
    accessionAt: '',
  },
  {
    id: 2,
    idemKey: '1:2',
    batchId: 1,
    batchNo: 'JDPC-20261005-001',
    unit: 'H3',
    entryId: 2,
    specimenNo: 'ANIM-0002',
    species: '黄牛',
    element: '下颌骨',
    appraiser: '陈默',
    identifiedAt: '2026-10-05',
    status: '待入藏',
    shelfNo: '',
    storageName: '',
    accessionAt: '',
  },
  {
    id: 3,
    idemKey: '1:3',
    batchId: 1,
    batchNo: 'JDPC-20261005-001',
    unit: 'H3',
    entryId: 3,
    specimenNo: 'ANIM-0003',
    species: '家猪',
    element: '下颌骨',
    appraiser: '陈默',
    identifiedAt: '2026-10-05',
    status: '待入藏',
    shelfNo: '',
    storageName: '',
    accessionAt: '',
  },
]

function readCollection<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T[]
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeCollection<T>(key: string, value: T[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

// 每次都从 localStorage 现读：乐观锁版本号必须以最新落库数据为准，不能用内存缓存。
export function readBatches(): IdentBatch[] {
  return readCollection(BATCH_STORAGE_KEY, SEED_BATCHES)
}

export function writeBatches(batches: IdentBatch[]): void {
  writeCollection(BATCH_STORAGE_KEY, batches)
}

export function readAccessions(): AccessionRecord[] {
  return readCollection(ACCESSION_STORAGE_KEY, SEED_ACCESSIONS)
}

export function writeAccessions(records: AccessionRecord[]): void {
  writeCollection(ACCESSION_STORAGE_KEY, records)
}

export function findBatchByEntry(entryId: number): IdentBatch | undefined {
  return readBatches().find((batch) => batch.specimens.some((item) => item.entryId === entryId))
}
