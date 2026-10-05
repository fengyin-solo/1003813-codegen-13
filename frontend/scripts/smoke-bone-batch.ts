// 冒烟测试：直接驱动 local-service 的编组台业务函数，验证关键规则。
// 运行方式见 package 脚本或手工：esbuild 打包后 node 执行（无 window，走内存缓存 + 种子数据）。
import {
  addToBoneBatch,
  archiveBoneBatch,
  backfillBoneBatch,
  completeBoneBatch,
  createBoneBatch,
  listBoneBatchMembers,
  listBoneBatches,
  listUngroupedBones,
  removeFromBoneBatch,
  runAction,
  saveBoneReview,
  startBoneBatch,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${name} ${extra}`)
  }
}

// —— 编组 ——
const ungrouped = listUngroupedBones()
const h5 = ungrouped.filter((r) => r['出土单位'] === 'H5灰坑').map((r) => Number(r.id))
check('种子数据里 H5灰坑 有 1 件未编组标本（另 2 件已入 ABTC-0001）', h5.length === 1, `got ${h5.length}`)

const badUnit = createBoneBatch('H5灰坑', [h5[0], ...listUngroupedBones().filter((r) => r['出土单位'] === 'F2房址').map((r) => Number(r.id)).slice(0, 1)])
check('跨出土单位编组被拒绝', !badUnit.ok)

const dup = createBoneBatch('H5灰坑', [4])
check('已入批标本重复编组被拒绝', !dup.ok && dup.message.includes('ABTC-0001'))

const f2 = listUngroupedBones().filter((r) => r['出土单位'] === 'F2房址').map((r) => Number(r.id))
const created = createBoneBatch('F2房址', f2)
check('同出土单位编组成功', created.ok && created.batchId !== undefined)
const batchId = created.batchId as number
const batch = () => listBoneBatches().find((b) => Number(b.id) === batchId)!
check('新批次状态为编组中、版本 1', batch().status === '编组中' && Number(batch()['版本号']) === 1)

// —— 编组中成员调整 ——
const added = addToBoneBatch(batchId, h5, Number(batch()['版本号']))
check('编组中不能加入其他出土单位的标本', !added.ok)
const removed = removeFromBoneBatch(batchId, f2[1], Number(batch()['版本号']))
check('编组中可移出标本', removed.ok && Number(batch()['标本件数']) === 1)
const readd = addToBoneBatch(batchId, [f2[1]], Number(batch()['版本号']))
check('编组中可加回同单位标本', readd.ok && Number(batch()['标本件数']) === 2)

// —— 开始鉴定 ——
const staleStart = startBoneBatch(batchId, 1)
check('过期版本的开始鉴定被拒绝（只允许一个版本落库）', !staleStart.ok && staleStart.message.includes('版本'))
const started = startBoneBatch(batchId, Number(batch()['版本号']))
check('开始鉴定成功，批次进入鉴定中', started.ok && batch().status === '鉴定中')
check('批内标本同步转为鉴定中', listBoneBatchMembers(String(batch()['批次编号'])).every((r) => r.status === '鉴定中'))

// —— 状态回跳与动作守卫 ——
const sameStatus = runAction('animal_bone', f2[0], '开始鉴定')
check('同状态动作被通用去重拦截', !sameStatus.ok)
const back = runAction('animal_bone', f2[0], '提交鉴定')
check('鉴定中批次的标本不能走通用动作流转', !back.ok && back.message.includes('编组台'), back.message)
const memberAfter = listRows('animal_bone').find((r) => Number(r.id) === f2[0])!
check('标本未被通用动作改动，仍是鉴定中', memberAfter.status === '鉴定中')

// —— 批量回填 + 人工结论优先 ——
const memberIds = listBoneBatchMembers(String(batch()['批次编号'])).map((r) => Number(r.id))
const manualFirst = saveBoneReview(memberIds[0], { 种属判定: '黄牛', 骨骼部位: '右侧下颌', 复核意见: '人工复看为黄牛', 复核人: '张三' })
check('鉴定中可逐件登记人工结论', manualFirst.ok)
const fill = backfillBoneBatch(batchId, { 种属判定: '猪', 骨骼部位: '左侧肱骨', 最小个体数: 2, 鉴定人: '李四' }, Number(batch()['版本号']))
check('批量回填成功', fill.ok)
const rowsNow = listRows('animal_bone')
const manualRow = rowsNow.find((r) => Number(r.id) === memberIds[0])!
const autoRow = rowsNow.find((r) => Number(r.id) === memberIds[1])!
check('人工结论不被批量回填覆盖', manualRow['种属判定'] === '黄牛' && manualRow['结论来源'] === '人工')
check('未人工判定的标本被批量回填', autoRow['种属判定'] === '猪' && autoRow['结论来源'] === '批量回填' && Number(autoRow['最小个体数']) === 2)
const manualLater = saveBoneReview(memberIds[1], { 种属判定: '羊', 骨骼部位: '', 复核意见: '改判为羊', 复核人: '王五' })
check('回填后再登记人工结论可覆盖批量值', manualLater.ok && listRows('animal_bone').find((r) => Number(r.id) === memberIds[1])!['种属判定'] === '羊')

// —— 完成鉴定：版本与库房联动 ——
const staleComplete = completeBoneBatch(batchId, 1)
check('过期版本的完成鉴定被拒绝', !staleComplete.ok)
const storageBefore = listRows('storage').length
const completed = completeBoneBatch(batchId, Number(batch()['版本号']))
check('完成鉴定成功', completed.ok && batch().status === '已鉴定')
check('批内标本同步转为已鉴定', listBoneBatchMembers(String(batch()['批次编号'])).every((r) => r.status === '已鉴定'))
const storageRows = listRows('storage')
const pendings = storageRows.filter((r) => r['来源批次'] === batch()['批次编号'])
check('库房台账同步生成每件标本的待入藏记录', pendings.length === memberIds.length && storageRows.length === storageBefore + memberIds.length, `got ${pendings.length}`)
check('待入藏记录状态与类别正确', pendings.every((r) => r.status === '待入藏' && r['存放器物类别'] === '动物骨骼标本'))
const reviewAfterComplete = saveBoneReview(memberIds[0], { 种属判定: '', 骨骼部位: '', 复核意见: '迟到的意见', 复核人: '张三' })
check('已鉴定批次不能再补复核意见', !reviewAfterComplete.ok)

// —— 归档与重新编组 ——
const archived = archiveBoneBatch(batchId, Number(batch()['版本号']))
check('归档成功', archived.ok && batch().status === '已归档')
check('批内标本同步归档', listBoneBatchMembers(String(batch()['批次编号'])).every((r) => r.status === '已归档'))
const regroup = createBoneBatch('F2房址', memberIds)
check('已归档批次不允许重新编组', !regroup.ok && regroup.message.includes('已归档'))
const locked = runAction('animal_bone', memberIds[0], '复核鉴定')
check('已归档批次的标本动作被锁定', !locked.ok && locked.message.includes('已归档'))

// —— 种子批次 ABTC-0001 全流程 ——
const seedBatch = listBoneBatches().find((b) => b['批次编号'] === 'ABTC-0001')!
const s1 = startBoneBatch(Number(seedBatch.id), Number(seedBatch['版本号']))
const s2 = backfillBoneBatch(Number(seedBatch.id), { 种属判定: '猪', 骨骼部位: '肱骨', 最小个体数: 1, 鉴定人: '赵六' }, s1.ok ? 2 : -1)
const s3 = completeBoneBatch(Number(seedBatch.id), s2.ok ? 3 : -1)
check('种子批次可走完 开始鉴定→批量回填→完成鉴定', s1.ok && s2.ok && s3.ok, [s1.message, s2.message, s3.message].join(' | '))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
