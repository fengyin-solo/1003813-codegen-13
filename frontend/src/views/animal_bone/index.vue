<template>
  <section class="page" data-module="animal_bone">
    <header class="page-head">
      <div>
        <h2>动物骨骼管理</h2>
        <p class="page-desc">同一出土单位的骨骼标本可在鉴定编组台组成鉴定批次，整批录入种属、部位与最小个体数，再逐件补充复核意见。</p>
      </div>
      <div class="page-actions">
        <button v-if="activeTab === 'ledger'" class="btn" type="button" @click="exportRows">导出动物骨骼清单</button>
        <button class="btn primary" type="button" @click="activeTab = 'workbench'">进入鉴定编组台</button>
      </div>
    </header>

    <nav class="tab-bar">
      <button
        class="tab-item"
        :class="{ active: activeTab === 'ledger' }"
        type="button"
        @click="activeTab = 'ledger'"
      >
        标本台账
      </button>
      <button
        class="tab-item"
        :class="{ active: activeTab === 'workbench' }"
        type="button"
        @click="activeTab = 'workbench'"
      >
        鉴定编组台
      </button>
    </nav>

    <!-- 标本台账 -->
    <div v-if="activeTab === 'ledger'">
      <div class="stat-row">
        <article v-for="item in ledgerStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reloadLedger">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <template v-if="boundBatchMap.get(Number(row.id))">
                <span class="locked-hint">
                  随批次「{{ boundBatchMap.get(Number(row.id))?.batchNo }}」流转
                </span>
              </template>
              <button
                v-for="action in freeActions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无动物骨骼数据，可先在发掘现场登记标本</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条动物骨骼记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <!-- 鉴定编组台 -->
    <div v-else class="workbench">
      <div class="stat-row">
        <article v-for="item in workbenchStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p v-if="notice" class="notice-banner" :class="noticeOk ? 'ok' : 'error'">{{ notice }}</p>

      <div class="workbench-grid">
        <!-- 左：批次列表 + 新建编组 -->
        <div class="batch-pane">
          <section class="panel">
            <h3 class="panel-title">新建鉴定编组</h3>
            <p class="panel-tip">仅可选择尚有未编组「已采集」标本的出土单位，编组后整单位标本进入同一批次。</p>
            <form class="stack-form" @submit.prevent="handleCreate">
              <label class="filter-item">
                <span>出土单位</span>
                <select v-model="createUnit" required>
                  <option value="" disabled>请选择出土单位</option>
                  <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
                </select>
              </label>
              <label class="filter-item">
                <span>鉴定人</span>
                <input v-model="createAppraiser" placeholder="如：陈默" />
              </label>
              <label class="filter-item">
                <span>编组备注</span>
                <input v-model="createRemark" placeholder="可留空" />
              </label>
              <button class="btn primary" type="submit" :disabled="!createUnit">编组</button>
            </form>
          </section>

          <section class="panel">
            <h3 class="panel-title">鉴定批次</h3>
            <ul class="batch-list">
              <li
                v-for="batch in batches"
                :key="batch.id"
                class="batch-card"
                :class="{ active: selectedId === batch.id }"
              >
                <button class="batch-card-btn" type="button" @click="selectBatch(batch.id)">
                  <span class="batch-no">{{ batch.batchNo }}</span>
                  <span class="batch-meta">{{ batch.unit }} · {{ batch.specimens.length }} 件 · v{{ batch.version }}</span>
                  <span class="status-tag" :data-status="batch.status">{{ batch.status }}</span>
                </button>
              </li>
              <li v-if="!batches.length" class="empty-state">暂无鉴定批次</li>
            </ul>
          </section>
        </div>

        <!-- 右：批次详情 -->
        <div class="detail-pane">
          <section v-if="!selected" class="panel empty-state">请在左侧选择或新建一个鉴定批次</section>

          <section v-else class="panel">
            <header class="detail-head">
              <div>
                <h3 class="panel-title">{{ selected.batchNo }}</h3>
                <p class="panel-tip">
                  出土单位 {{ selected.unit }} · {{ selected.specimens.length }} 件标本 ·
                  落库版本 v{{ selected.version }} · 当前
                  <span class="status-tag" :data-status="selected.status">{{ selected.status }}</span>
                </p>
              </div>
              <div v-if="selected.status === '编组中'" class="detail-actions">
                <button class="btn" type="button" @click="handleDisband">解散编组</button>
                <button
                  class="btn primary"
                  type="button"
                  :disabled="!selected.specimens.length"
                  @click="handleStart"
                >
                  开始鉴定
                </button>
              </div>
            </header>

            <!-- 编组中：增删标本 -->
            <div v-if="selected.status === '编组中'">
              <div class="add-specimens">
                <label class="filter-item add-select">
                  <span>补编同单位已采集标本</span>
                  <select v-model="addEntryId">
                    <option value="" disabled>选择标本</option>
                    <option v-for="row in addableRows" :key="row.id" :value="Number(row.id)">
                      {{ row['标本编号'] }}（{{ row['数量统计'] }} 件残片）
                    </option>
                  </select>
                </label>
                <button class="btn" type="button" :disabled="addEntryId === ''" @click="handleAdd">编入</button>
              </div>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>标本编号</th>
                    <th>出土单位</th>
                    <th>数量统计</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selected.specimens" :key="item.entryId">
                    <td>{{ entryNo(item.entryId) }}</td>
                    <td>{{ selected.unit }}</td>
                    <td>{{ entryField(item.entryId, '数量统计') || '—' }}</td>
                    <td>
                      <button class="link" type="button" @click="handleRemove(item.entryId)">移出</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="panel-tip">开始鉴定后批次锁定，标本不能再增删，也不能跳回已采集。</p>
            </div>

            <!-- 鉴定中：整批录入 + 单件人工结论 -->
            <div v-else-if="selected.status === '鉴定中'">
              <form class="conclusion-form" @submit.prevent="handleSaveConclusion">
                <label class="filter-item">
                  <span>整批种属判定</span>
                  <input v-model="conclusionSpecies" placeholder="如：家猪" />
                </label>
                <label class="filter-item">
                  <span>整批骨骼部位</span>
                  <input v-model="conclusionElement" placeholder="如：下颌骨" />
                </label>
                <label class="filter-item narrow">
                  <span>最小个体数（MNI）</span>
                  <input v-model.number="conclusionMni" type="number" min="0" />
                </label>
                <label class="filter-item">
                  <span>鉴定人</span>
                  <input v-model="conclusionAppraiser" placeholder="如：陈默" />
                </label>
                <label class="filter-item wide">
                  <span>批次备注</span>
                  <input v-model="conclusionRemark" placeholder="可留空" />
                </label>
                <div class="form-actions">
                  <button class="btn" type="submit">暂存整批结论</button>
                  <button class="btn primary" type="button" @click="handleSubmitIdent">提交鉴定（整批落库）</button>
                </div>
              </form>
              <p class="panel-tip conflict-rule">
                冲突处理顺序：<strong>单件人工结论优先</strong>。整批回填只填充空白项，不会覆盖已录入的单件结论。
              </p>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>标本编号</th>
                    <th>数量统计</th>
                    <th>单件种属（人工）</th>
                    <th>单件部位（人工）</th>
                    <th>当前采用结论</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selected.specimens" :key="item.entryId">
                    <td>{{ entryNo(item.entryId) }}</td>
                    <td>{{ entryField(item.entryId, '数量统计') || '—' }}</td>
                    <td>
                      <input v-model="manualDrafts[item.entryId].species" class="cell-input" placeholder="留空则用整批" />
                    </td>
                    <td>
                      <input v-model="manualDrafts[item.entryId].element" class="cell-input" placeholder="留空则用整批" />
                    </td>
                    <td>
                      <span :class="{ 'manual-flag': item.manualSpecies || item.manualElement }">
                        {{ effectiveSpecies(item, selected) || '—' }} /
                        {{ effectiveElement(item, selected) || '—' }}
                        <em v-if="item.manualSpecies || item.manualElement">人工优先</em>
                      </span>
                    </td>
                    <td>
                      <button class="link" type="button" @click="handleSaveManual(item.entryId)">保存单件结论</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 已鉴定：逐件补充复核意见 -->
            <div v-else-if="selected.status === '已鉴定'">
              <div class="review-progress">
                复核进度：{{ reviewedCount }}/{{ selected.specimens.length }}，全部补充复核意见后可整批完成复核。
              </div>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>标本编号</th>
                    <th>种属判定</th>
                    <th>骨骼部位</th>
                    <th>复核意见</th>
                    <th>复核人</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selected.specimens" :key="item.entryId">
                    <td>{{ entryNo(item.entryId) }}</td>
                    <td>{{ effectiveSpecies(item, selected) }}</td>
                    <td>{{ effectiveElement(item, selected) }}</td>
                    <td>
                      <textarea
                        v-model="reviewDrafts[item.entryId]"
                        class="cell-input review-input"
                        rows="2"
                        placeholder="逐件补充复核意见"
                      ></textarea>
                    </td>
                    <td>
                      <span v-if="item.reviewed">{{ item.reviewer }}<br /><small>{{ item.reviewedAt }}</small></span>
                      <span v-else>待复核</span>
                    </td>
                    <td>
                      <span class="status-tag" :data-status="item.reviewed ? '已复核' : '鉴定中'">
                        {{ item.reviewed ? '已复核' : '待复核' }}
                      </span>
                    </td>
                    <td>
                      <button class="link" type="button" @click="handleSaveReview(item.entryId)">保存复核意见</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="form-actions">
                <button
                  class="btn primary"
                  type="button"
                  :disabled="reviewedCount !== selected.specimens.length"
                  @click="handleFinishReview"
                >
                  完成整批复核
                </button>
              </div>
            </div>

            <!-- 已复核 / 已归档 -->
            <div v-else>
              <div class="review-summary">
                <p>
                  鉴定人 {{ selected.appraiser || '—' }}，最小个体数
                  <strong>{{ selected.mni }}</strong>；
                  鉴定提交于 {{ selected.submittedAt }}（落库版本 v{{ selected.submittedVersion }}），
                  复核完成于 {{ selected.reviewedAt || '—' }}。
                </p>
                <p v-if="selected.remark" class="panel-tip">批次备注：{{ selected.remark }}</p>
              </div>
              <table class="data-table">
                <thead>
                  <tr>
                    <th v-for="column in reviewColumns" :key="column">{{ column }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selected.specimens" :key="item.entryId">
                    <td>{{ entryNo(item.entryId) }}</td>
                    <td>{{ effectiveSpecies(item, selected) }}</td>
                    <td>{{ effectiveElement(item, selected) }}</td>
                    <td>{{ item.reviewed ? item.reviewer : '—' }}</td>
                    <td>{{ item.reviewNote || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="selected.status === '已复核'" class="form-actions">
                <button class="btn primary" type="button" @click="handleArchive">归档批次</button>
              </div>
              <p v-else class="panel-tip locked-tip">
                批次已于 {{ selected.archivedAt }} 归档并锁定：标本不允许重新编组，结论不允许再改动。
                待入藏记录已同步至库房管理页。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  archiveBatch,
  availableSpecimens,
  availableUnits,
  createBatch,
  disbandBatch,
  effectiveElement,
  effectiveSpecies,
  finishReview,
  listAccessionRecords,
  listBatches,
  removeSpecimen,
  saveBatchConclusion,
  saveManualConclusion,
  saveReviewNote,
  startIdentification,
  submitIdentification,
  addSpecimens,
} from '@/api/ident-service'
import type { BatchResult } from '@/api/ident-service'
import { downloadEntries, listEntries, runAction as applyAction } from '@/api/local-service'
import type { AccessionRecord, IdentBatch } from '@/data/ident-batch'
import type { EntryRow } from '@/data/types'

const columns = ['标本编号', '出土单位', '种属判定', '骨骼部位', '数量统计', '最小个体数', '鉴定人', '鉴定状态']
const reviewColumns = ['标本编号', '种属判定', '骨骼部位', '复核人', '复核意见']
const freeActions = ['开始鉴定', '提交鉴定', '复核鉴定']
const statuses = ['已采集', '鉴定中', '已鉴定', '已复核', '已归档']

const activeTab = ref<'ledger' | 'workbench'>('workbench')

// ---- 标本台账 ----
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const boundBatchMap = computed(() => {
  const map = new Map<number, IdentBatch>()
  for (const batch of batches.value) {
    for (const specimen of batch.specimens) {
      map.set(specimen.entryId, batch)
    }
  }
  return map
})

const ledgerStats = computed(() => [
  { label: '标本总数', value: rows.value.length },
  { label: '已鉴定/复核/归档', value: rows.value.filter((row) => row.status !== '已采集' && row.status !== '鉴定中').length },
  { label: '鉴定中数', value: rows.value.filter((row) => String(row.status) === '鉴定中').length },
  { label: '待入藏记录', value: pendingAccessionCount.value },
])

function resetFilters() {
  filters.value = {}
  reloadLedger()
}

function exportRows() {
  downloadEntries('animal_bone')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('animal_bone', Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reloadAll()
}

function reloadLedger() {
  errorMessage.value = ''
  try {
    const payload = listEntries('animal_bone', filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '动物骨骼列表读取失败'
  }
}

// ---- 鉴定编组台 ----
const batches = ref<IdentBatch[]>([])
const accessions = ref<AccessionRecord[]>([])
const allBoneRows = ref<EntryRow[]>([])
const selectedId = ref<number | null>(null)
const notice = ref('')
const noticeOk = ref(true)
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const createUnit = ref('')
const createAppraiser = ref('')
const createRemark = ref('')
const addEntryId = ref<number | ''>('')

const conclusionSpecies = ref('')
const conclusionElement = ref('')
const conclusionMni = ref<number>(0)
const conclusionAppraiser = ref('')
const conclusionRemark = ref('')
const manualDrafts = reactive<Record<number, { species: string; element: string }>>({})
const reviewDrafts = reactive<Record<number, string>>({})

const units = computed(() => availableUnits())
const selected = computed(() => batches.value.find((batch) => batch.id === selectedId.value) ?? null)

const workbenchStats = computed(() => {
  const count = (status: IdentBatch['status']) =>
    batches.value.filter((batch) => batch.status === status).length
  return [
    { label: '批次总数', value: batches.value.length },
    { label: '编组中', value: count('编组中') },
    { label: '鉴定/复核中', value: count('鉴定中') + count('已鉴定') },
    { label: '已归档', value: count('已归档') },
  ]
})

const pendingAccessionCount = computed(() => accessions.value.filter((record) => record.status === '待入藏').length)

const reviewedCount = computed(
  () => selected.value?.specimens.filter((item) => item.reviewed).length ?? 0,
)

const addableRows = computed(() =>
  selected.value ? availableSpecimens(selected.value.unit) : [],
)

function entryRow(entryId: number): EntryRow | undefined {
  return allBoneRows.value.find((row) => Number(row.id) === entryId)
}

function entryNo(entryId: number): string {
  return String(entryRow(entryId)?.['标本编号'] ?? `ANIM-${entryId}`)
}

function entryField(entryId: number, field: string): string | number {
  const row = entryRow(entryId)
  return row ? (row[field] as string | number) : ''
}

function flash(result: BatchResult, keepSelection = true) {
  notice.value = result.message
  noticeOk.value = result.ok
  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 5000)
  const previous = selectedId.value
  reloadAll()
  if (keepSelection && result.ok) {
    selectedId.value = previous
  }
}

function reloadWorkbench() {
  batches.value = listBatches()
  accessions.value = listAccessionRecords()
  allBoneRows.value = listEntries('animal_bone').items
}

function reloadAll() {
  reloadWorkbench()
  reloadLedger()
}

function selectBatch(id: number) {
  selectedId.value = id
  notice.value = ''
}

// 切换选中批次时，把表单回填成该批次的当前落库内容，草稿也用已有人工结论预填。
watch(selected, (batch) => {
  if (!batch) {
    return
  }
  conclusionSpecies.value = batch.species
  conclusionElement.value = batch.element
  conclusionMni.value = batch.mni
  conclusionAppraiser.value = batch.appraiser
  conclusionRemark.value = batch.remark
  for (const specimen of batch.specimens) {
    if (!manualDrafts[specimen.entryId]) {
      manualDrafts[specimen.entryId] = { species: '', element: '' }
    }
    manualDrafts[specimen.entryId].species = specimen.manualSpecies
    manualDrafts[specimen.entryId].element = specimen.manualElement
    reviewDrafts[specimen.entryId] = specimen.reviewNote
  }
  addEntryId.value = ''
})

function requireSelected(): IdentBatch | null {
  if (!selected.value) {
    flash({ ok: false, message: '请先选择一个鉴定批次' }, false)
    return null
  }
  return selected.value
}

function handleCreate() {
  const result = createBatch(createUnit.value, createAppraiser.value, createRemark.value)
  if (result.ok) {
    createUnit.value = ''
    createAppraiser.value = ''
    createRemark.value = ''
    reloadWorkbench()
    const newest = batches.value.reduce<IdentBatch | undefined>(
      (max, batch) => (!max || batch.id > max.id ? batch : max),
      undefined,
    )
    if (newest) {
      selectedId.value = newest.id
    }
    activeTab.value = 'workbench'
  }
  flash(result, false)
}

function handleAdd() {
  const batch = requireSelected()
  if (!batch || addEntryId.value === '') {
    return
  }
  const result = addSpecimens(batch.id, batch.version, [Number(addEntryId.value)])
  flash(result)
}

function handleRemove(entryId: number) {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(removeSpecimen(batch.id, batch.version, entryId))
}

function handleDisband() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  const result = disbandBatch(batch.id, batch.version)
  if (result.ok) {
    selectedId.value = null
  }
  flash(result, false)
}

function handleStart() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(startIdentification(batch.id, batch.version))
}

function handleSaveConclusion() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(
    saveBatchConclusion(batch.id, batch.version, {
      species: conclusionSpecies.value,
      element: conclusionElement.value,
      mni: Number(conclusionMni.value) || 0,
      appraiser: conclusionAppraiser.value,
      remark: conclusionRemark.value,
    }),
  )
}

function handleSaveManual(entryId: number) {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  const draft = manualDrafts[entryId]
  flash(saveManualConclusion(batch.id, batch.version, entryId, draft.species, draft.element))
}

function handleSubmitIdent() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  // 提交前先把表单上的整批结论落一版，保证提交时校验的是当前录入内容。
  const saved = saveBatchConclusion(batch.id, batch.version, {
    species: conclusionSpecies.value,
    element: conclusionElement.value,
    mni: Number(conclusionMni.value) || 0,
    appraiser: conclusionAppraiser.value,
    remark: conclusionRemark.value,
  })
  if (!saved.ok) {
    flash(saved)
    return
  }
  const fresh = batches.value.find((item) => item.id === batch.id)
  if (!fresh) {
    return
  }
  flash(submitIdentification(fresh.id, fresh.version))
}

function handleSaveReview(entryId: number) {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(saveReviewNote(batch.id, batch.version, entryId, reviewDrafts[entryId] ?? '', '值班管理员'))
}

function handleFinishReview() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(finishReview(batch.id, batch.version))
}

function handleArchive() {
  const batch = requireSelected()
  if (!batch) {
    return
  }
  flash(archiveBatch(batch.id, batch.version))
}

onMounted(() => {
  reloadAll()
  if (batches.value.length) {
    selectedId.value = batches.value[0].id
  }
})
</script>
