<template>
  <section class="page" data-module="animal_bone_batch">
    <header class="page-head">
      <div>
        <h2>动物骨骼鉴定编组台</h2>
        <p class="page-desc">
          把同一出土单位的骨骼标本组成鉴定批次，整批录入种属判定、骨骼部位与最小个体数，再逐件补充复核意见；
          批次只按「编组中 → 鉴定中 → 已鉴定 → 已归档」单向流转。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/animal_bone">返回动物骨骼</RouterLink>
        <button class="btn" type="button" @click="reload">刷新</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3>① 选择同一出土单位的未编组标本</h3>
      <p class="hint">只有「已采集」且未入批的标本可以编组；已归档批次的标本不允许重新编组。</p>
      <div class="form-row">
        <label>
          <span>出土单位</span>
          <select v-model="selectedUnit">
            <option value="" disabled>请选择出土单位</option>
            <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
          </select>
        </label>
        <button
          class="btn primary"
          type="button"
          :disabled="!checkedIds.length"
          @click="createBatch"
        >
          组成鉴定批次（已选 {{ checkedIds.length }} 件）
        </button>
      </div>
      <table v-if="selectedUnit" class="data-table">
        <thead>
          <tr>
            <th>选择</th>
            <th>标本编号</th>
            <th>出土单位</th>
            <th>种属判定</th>
            <th>骨骼部位</th>
            <th>数量统计</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in unitSpecimens" :key="String(row.id)">
            <td>
              <input v-model="checkedIds" type="checkbox" :value="Number(row.id)" />
            </td>
            <td>{{ row['标本编号'] }}</td>
            <td>{{ row['出土单位'] }}</td>
            <td>{{ row['种属判定'] ?? '—' }}</td>
            <td>{{ row['骨骼部位'] ?? '—' }}</td>
            <td>{{ row['数量统计'] ?? '—' }}</td>
            <td>{{ row.status }}</td>
          </tr>
          <tr v-if="!unitSpecimens.length">
            <td colspan="7" class="empty-state">该出土单位暂无待编组的标本</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">暂无出土单位可选时，请先在动物骨骼页面登记已采集标本。</p>
    </section>

    <section class="panel">
      <h3>② 鉴定批次</h3>
      <p class="hint">同一批次同时提交只允许一个版本落库：提交时携带页面所见版本号，版本不一致会被拒绝，需刷新后重试。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th>
            <th>出土单位</th>
            <th>标本件数</th>
            <th>种属判定</th>
            <th>骨骼部位</th>
            <th>最小个体数</th>
            <th>鉴定人</th>
            <th>版本号</th>
            <th>批次状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="batch in batches"
            :key="String(batch.id)"
            :class="{ 'row-selected': selectedBatchId === Number(batch.id) }"
          >
            <td>{{ batch['批次编号'] }}</td>
            <td>{{ batch['出土单位'] }}</td>
            <td>{{ batch['标本件数'] }}</td>
            <td>{{ batch['种属判定'] || '—' }}</td>
            <td>{{ batch['骨骼部位'] || '—' }}</td>
            <td>{{ batch['最小个体数'] || '—' }}</td>
            <td>{{ batch['鉴定人'] || '—' }}</td>
            <td>{{ batch['版本号'] }}</td>
            <td>{{ batch.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="selectBatch(Number(batch.id))">
                {{ selectedBatchId === Number(batch.id) ? '收起' : '查看' }}
              </button>
            </td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="10" class="empty-state">暂无鉴定批次，可先在上方编组</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="currentBatch" class="panel">
      <h3>
        ③ 批次详情：{{ currentBatch['批次编号'] }}（{{ currentBatch.status }}，版本 {{ currentBatch['版本号'] }}）
      </h3>

      <template v-if="currentBatch.status === '编组中'">
        <p class="hint">
          编组阶段可继续加入同一出土单位（{{ currentBatch['出土单位'] }}）的未编组标本或移出标本；
          开始鉴定后成员锁定，标本不能跳回已采集。
        </p>
        <div v-if="candidatesForAdd.length" class="form-row">
          <label>
            <span>可加入的标本</span>
            <select v-model="addCheckedIds" multiple size="3">
              <option v-for="row in candidatesForAdd" :key="String(row.id)" :value="Number(row.id)">
                {{ row['标本编号'] }}
              </option>
            </select>
          </label>
          <button class="btn" type="button" :disabled="!addCheckedIds.length" @click="addMembers">
            加入批次
          </button>
        </div>
        <p v-else class="hint">该出土单位暂无更多可加入的未编组标本。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>标本编号</th>
              <th>种属判定</th>
              <th>骨骼部位</th>
              <th>数量统计</th>
              <th>当前状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in members" :key="String(row.id)">
              <td>{{ row['标本编号'] }}</td>
              <td>{{ row['种属判定'] || '—' }}</td>
              <td>{{ row['骨骼部位'] || '—' }}</td>
              <td>{{ row['数量统计'] ?? '—' }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="removeMember(Number(row.id))">移出批次</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="form-row" style="margin-top: 10px">
          <button class="btn primary" type="button" @click="startBatch">开始鉴定</button>
        </div>
      </template>

      <template v-else-if="currentBatch.status === '鉴定中'">
        <p class="hint">
          先整批回填种属判定、骨骼部位与最小个体数，再逐件补充复核意见；
          冲突处理：单件人工结论优先，批量回填不会覆盖已人工判定的标本。
        </p>
        <form class="form-row" @submit.prevent="backfill">
          <label>
            <span>种属判定</span>
            <input v-model="backfillForm.种属判定" placeholder="如：猪（Sus scrofa）" />
          </label>
          <label>
            <span>骨骼部位</span>
            <input v-model="backfillForm.骨骼部位" placeholder="如：左侧肱骨" />
          </label>
          <label>
            <span>最小个体数</span>
            <input v-model.number="backfillForm.最小个体数" type="number" min="1" step="1" />
          </label>
          <label>
            <span>鉴定人</span>
            <input v-model="backfillForm.鉴定人" placeholder="鉴定人姓名" />
          </label>
          <button class="btn primary" type="submit">批量回填</button>
        </form>
        <table class="data-table">
          <thead>
            <tr>
              <th>标本编号</th>
              <th>种属判定</th>
              <th>骨骼部位</th>
              <th>结论来源</th>
              <th>人工种属（留空不改）</th>
              <th>人工部位（留空不改）</th>
              <th>复核意见</th>
              <th>复核人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in members" :key="String(row.id)">
              <td>{{ row['标本编号'] }}</td>
              <td>{{ row['种属判定'] || '—' }}</td>
              <td>{{ row['骨骼部位'] || '—' }}</td>
              <td>{{ row['结论来源'] || '—' }}</td>
              <td>
                <input v-model="reviewForms[Number(row.id)].种属判定" class="cell-input" placeholder="留空保持现结论" />
              </td>
              <td>
                <input v-model="reviewForms[Number(row.id)].骨骼部位" class="cell-input" placeholder="留空保持现结论" />
              </td>
              <td>
                <input v-model="reviewForms[Number(row.id)].复核意见" class="cell-input" placeholder="逐件复核意见" />
              </td>
              <td>
                <input v-model="reviewForms[Number(row.id)].复核人" class="cell-input" placeholder="复核人" />
              </td>
              <td class="row-actions">
                <button class="link" type="button" @click="saveReview(Number(row.id))">保存复核</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="form-row" style="margin-top: 10px">
          <button class="btn primary" type="button" @click="completeBatch">
            完成鉴定（同步生成库房待入藏记录）
          </button>
        </div>
      </template>

      <template v-else-if="currentBatch.status === '已鉴定'">
        <p class="hint">批次已完成鉴定，库房架位台账已生成待入藏记录；归档后批次与标本锁定，不允许重新编组。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>标本编号</th>
              <th>种属判定</th>
              <th>骨骼部位</th>
              <th>结论来源</th>
              <th>复核意见</th>
              <th>复核人</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in members" :key="String(row.id)">
              <td>{{ row['标本编号'] }}</td>
              <td>{{ row['种属判定'] || '—' }}</td>
              <td>{{ row['骨骼部位'] || '—' }}</td>
              <td>{{ row['结论来源'] || '—' }}</td>
              <td>{{ row['复核意见'] || '—' }}</td>
              <td>{{ row['复核人'] || '—' }}</td>
              <td>{{ row.status }}</td>
            </tr>
          </tbody>
        </table>
        <div class="form-row" style="margin-top: 10px">
          <button class="btn primary" type="button" @click="archiveBatch">归档批次</button>
        </div>
      </template>

      <template v-else>
        <p class="hint">批次已归档：标本与结论只读，已归档批次不允许重新编组。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>标本编号</th>
              <th>种属判定</th>
              <th>骨骼部位</th>
              <th>结论来源</th>
              <th>复核意见</th>
              <th>复核人</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in members" :key="String(row.id)">
              <td>{{ row['标本编号'] }}</td>
              <td>{{ row['种属判定'] || '—' }}</td>
              <td>{{ row['骨骼部位'] || '—' }}</td>
              <td>{{ row['结论来源'] || '—' }}</td>
              <td>{{ row['复核意见'] || '—' }}</td>
              <td>{{ row['复核人'] || '—' }}</td>
              <td>{{ row.status }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <footer class="page-foot">
      <span>共 {{ batches.length }} 个鉴定批次</span>
      <span v-if="message" :class="isError ? 'error-text' : 'ok-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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
  saveBoneReview,
  startBoneBatch,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

type ReviewForm = {
  种属判定: string
  骨骼部位: string
  复核意见: string
  复核人: string
}

const batches = ref<EntryRow[]>([])
const ungrouped = ref<EntryRow[]>([])
const members = ref<EntryRow[]>([])
const selectedBatchId = ref<number | null>(null)
const selectedUnit = ref('')
const checkedIds = ref<number[]>([])
const addCheckedIds = ref<number[]>([])
const backfillForm = ref({ 种属判定: '', 骨骼部位: '', 最小个体数: 1, 鉴定人: '' })
const reviewForms = ref<Record<number, ReviewForm>>({})
const message = ref('')
const isError = ref(false)

const units = computed(() =>
  [...new Set(ungrouped.value.map((row) => String(row['出土单位'])))].filter((unit) => unit !== ''),
)
const unitSpecimens = computed(() =>
  ungrouped.value.filter((row) => String(row['出土单位']) === selectedUnit.value),
)
const currentBatch = computed(
  () => batches.value.find((row) => Number(row.id) === selectedBatchId.value) ?? null,
)
const candidatesForAdd = computed(() =>
  currentBatch.value
    ? ungrouped.value.filter((row) => String(row['出土单位']) === String(currentBatch.value?.['出土单位']))
    : [],
)
const stats = computed(() => [
  { label: '批次总数', value: batches.value.length },
  { label: '编组中', value: batches.value.filter((row) => row.status === '编组中').length },
  { label: '鉴定中', value: batches.value.filter((row) => row.status === '鉴定中').length },
  { label: '已鉴定', value: batches.value.filter((row) => row.status === '已鉴定').length },
  { label: '已归档', value: batches.value.filter((row) => row.status === '已归档').length },
])

function report(ok: boolean, text: string) {
  message.value = text
  isError.value = !ok
}

function reload() {
  batches.value = listBoneBatches()
  ungrouped.value = listUngroupedBones()
  if (selectedUnit.value && !units.value.includes(selectedUnit.value)) {
    selectedUnit.value = ''
    checkedIds.value = []
  }
  if (selectedBatchId.value !== null) {
    loadMembers()
  }
}

function loadMembers() {
  const batch = currentBatch.value
  if (!batch) {
    members.value = []
    return
  }
  members.value = listBoneBatchMembers(String(batch['批次编号']))
  const forms: Record<number, ReviewForm> = {}
  for (const row of members.value) {
    forms[Number(row.id)] = {
      种属判定: '',
      骨骼部位: '',
      复核意见: String(row['复核意见'] ?? ''),
      复核人: String(row['复核人'] ?? ''),
    }
  }
  reviewForms.value = forms
  backfillForm.value = {
    种属判定: String(batch['种属判定'] ?? ''),
    骨骼部位: String(batch['骨骼部位'] ?? ''),
    最小个体数: Number(batch['最小个体数']) || 1,
    鉴定人: String(batch['鉴定人'] ?? ''),
  }
}

function selectBatch(id: number) {
  selectedBatchId.value = selectedBatchId.value === id ? null : id
  addCheckedIds.value = []
  if (selectedBatchId.value !== null) {
    loadMembers()
  }
}

function createBatch() {
  const result = createBoneBatch(selectedUnit.value, checkedIds.value)
  report(result.ok, result.message)
  checkedIds.value = []
  reload()
  if (result.ok && result.batchId !== undefined) {
    selectedBatchId.value = result.batchId
    loadMembers()
  }
}

function addMembers() {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = addToBoneBatch(Number(batch.id), addCheckedIds.value, Number(batch['版本号']))
  report(result.ok, result.message)
  addCheckedIds.value = []
  reload()
}

function removeMember(specimenId: number) {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = removeFromBoneBatch(Number(batch.id), specimenId, Number(batch['版本号']))
  report(result.ok, result.message)
  reload()
}

function startBatch() {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = startBoneBatch(Number(batch.id), Number(batch['版本号']))
  report(result.ok, result.message)
  reload()
}

function backfill() {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = backfillBoneBatch(
    Number(batch.id),
    { ...backfillForm.value },
    Number(batch['版本号']),
  )
  report(result.ok, result.message)
  reload()
}

function saveReview(specimenId: number) {
  const form = reviewForms.value[specimenId]
  if (!form) {
    return
  }
  const result = saveBoneReview(specimenId, { ...form })
  report(result.ok, result.message)
  reload()
}

function completeBatch() {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = completeBoneBatch(Number(batch.id), Number(batch['版本号']))
  report(result.ok, result.message)
  reload()
}

function archiveBatch() {
  const batch = currentBatch.value
  if (!batch) {
    return
  }
  const result = archiveBoneBatch(Number(batch.id), Number(batch['版本号']))
  report(result.ok, result.message)
  reload()
}

onMounted(reload)
</script>
