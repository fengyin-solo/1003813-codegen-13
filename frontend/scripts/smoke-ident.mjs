// 业务规则冒烟测试：在 Node 里用内存版 localStorage 跑通编组 → 鉴定 → 复核 → 归档 → 入藏全流程。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
}

const dir = mkdtempSync(join(tmpdir(), 'ident-smoke-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `
import {
  archiveBatch, availableUnits, availableSpecimens, createBatch, disbandBatch,
  finishReview, listAccessionRecords, listBatches, removeSpecimen,
  saveBatchConclusion, saveManualConclusion, saveReviewNote,
  startIdentification, submitIdentification, addSpecimens, assignShelf,
} from '@/api/ident-service'
import { runAction } from '@/api/local-service'

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } else console.log('PASS:', msg) }
const unit = availableUnits()[0]
assert(unit === 'H1', '可编组单位包含 H1（实际: ' + unit + '）')

// 1. 创建批次
const c1 = createBatch('H1', '陈默', '')
assert(c1.ok, '创建 H1 批次成功: ' + c1.message)
let batch = listBatches().find(b => b.status === '编组中')
const id = batch.id
assert(batch.specimens.length === 3, 'H1 编入 3 件标本')

// 2. 编组规则：不同单位不能补编
const other = availableSpecimens('H2')[0]
const addOther = addSpecimens(id, batch.version, [Number(other.id)])
assert(!addOther.ok, '拒绝跨出土单位补编')

// 3. 进入鉴定后不能增删/解散
assert(startIdentification(id, batch.version).ok, '开始鉴定')
batch = listBatches().find(b => b.id === id)
assert(batch.status === '鉴定中', '批次状态为鉴定中')
assert(!removeSpecimen(id, batch.version, batch.specimens[0].entryId).ok, '鉴定中禁止移出标本')
assert(!disbandBatch(id, batch.version).ok, '鉴定中禁止解散（不能跳回已采集）')

// 4. 通用单件动作被拦截
assert(!runAction('animal_bone', batch.specimens[0].entryId, '开始鉴定').ok, '通用单件动作对在编标本被拦截')

// 5. 旧版本提交被拒绝（模拟同一时刻两个版本落库）
const staleVersion = batch.version
assert(saveBatchConclusion(id, staleVersion, { species: '家猪', element: '股骨', mni: 1, appraiser: '陈默', remark: '' }).ok, '整批结论暂存 v+1')
const staleSubmit = submitIdentification(id, staleVersion)
assert(!staleSubmit.ok, '旧版本落库被乐观锁拒绝')

// 6. 单件人工结论优先
batch = listBatches().find(b => b.id === id)
const spec2 = batch.specimens[1].entryId
assert(saveManualConclusion(id, batch.version, spec2, '黄牛', '').ok, '保存单件人工结论=黄牛')
batch = listBatches().find(b => b.id === id)
// 再改整批回填，人工结论不应被覆盖
assert(saveBatchConclusion(id, batch.version, { species: '家猪', element: '股骨', mni: 2, appraiser: '陈默', remark: '' }).ok, '整批回填改为家猪')
batch = listBatches().find(b => b.id === id)
const target = batch.specimens.find(s => s.entryId === spec2)
assert(target.manualSpecies === '黄牛', '回填不覆盖人工结论（仍为黄牛）')

// 7. 提交鉴定
const submit = submitIdentification(id, batch.version)
assert(submit.ok, '提交鉴定成功: ' + submit.message)
batch = listBatches().find(b => b.id === id)
assert(batch.status === '已鉴定' && batch.submittedVersion === batch.version, '落库版本号已记录')
// 重复提交幂等/非法
assert(!submitIdentification(id, batch.version).ok, '已鉴定批次不能再次提交')
let accessions = listAccessionRecords()
const mine = accessions.filter(a => a.batchId === id)
assert(mine.length === 3, '台账同步生成 3 条待入藏记录')
assert(mine.find(a => a.entryId === spec2)?.species === '黄牛', '黄牛那条按人工结论同步')
// 幂等：手动构造二次提交不应产生重复（状态已阻止，这里再验证记录数）
assert(listAccessionRecords().filter(a => a.batchId === id).length === 3, '待入藏记录幂等不重复')

// 8. 逐件复核
assert(!finishReview(id, batch.version).ok, '未全部复核时禁止完成复核')
for (const s of batch.specimens) {
  assert(saveReviewNote(id, listBatches().find(b => b.id === id).version, s.entryId, '复核意见-' + s.entryId, '王敏').ok, '补充复核意见 ' + s.entryId)
}
batch = listBatches().find(b => b.id === id)
assert(finishReview(id, batch.version).ok, '全部复核后完成整批复核')

// 9. 归档
batch = listBatches().find(b => b.id === id)
assert(archiveBatch(id, batch.version).ok, '归档批次')
batch = listBatches().find(b => b.id === id)
assert(batch.status === '已归档', '状态为已归档')

// 10. 归档标本不能重新编组（availableSpecimens 不应包含）
const h1Avail = availableSpecimens('H1')
assert(h1Avail.length === 0, '已归档批次的 H1 标本不允许重新编组')

// 11. 入藏登记
const rec = mine[0]
assert(!assignShelf(rec.id, '', '').ok, '未填架位拒绝入藏')
assert(assignShelf(rec.id, 'STOR-0001', '一号库房').ok, '登记入藏成功')
assert(!assignShelf(rec.id, 'STOR-0002', '').ok, '已入藏记录禁止重复登记')

// 12. 编组中的批次可以解散并退回已采集
const c2 = createBatch('H2', '', '')
let b2 = listBatches().find(b => b.status === '编组中' && b.unit === 'H2')
assert(c2.ok && b2.specimens.length === 2, 'H2 编组 2 件')
assert(disbandBatch(b2.id, b2.version).ok, '解散编组中批次')
assert(availableSpecimens('H2').length === 2, '解散后 H2 标本回到可编组')
`,
)

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'out.mjs'),
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'silent',
})

await import(pathToFileURL(join(dir, 'out.mjs')).href)
