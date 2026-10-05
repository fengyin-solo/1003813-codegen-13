<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理</h2>
        <p class="page-desc">维护库房架位，动物骨骼鉴定完成后会在此同步生成待入藏记录，逐件登记架位完成入藏。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
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
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无库房管理数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <!-- 跨页面台账：动物骨骼鉴定批次提交后同步生成 -->
    <section class="accession-ledger">
      <header class="ledger-head">
        <h3>动物骨骼待入藏台账</h3>
        <p class="page-desc">鉴定编组台提交鉴定的标本在此生成待入藏记录，每条只允许登记一次。</p>
      </header>

      <p v-if="accessionMessage" class="notice-banner" :class="accessionOk ? 'ok' : 'error'">
        {{ accessionMessage }}
      </p>

      <div class="ledger-filter">
        <label class="filter-item">
          <span>按入藏状态筛选</span>
          <select v-model="accessionFilter">
            <option value="待入藏">只看待入藏</option>
            <option value="已入藏">只看已入藏</option>
            <option value="">全部</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="reloadAccessions">刷新台账</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>入藏编号</th>
            <th>标本编号</th>
            <th>鉴定批次</th>
            <th>出土单位</th>
            <th>种属判定</th>
            <th>骨骼部位</th>
            <th>鉴定人</th>
            <th>鉴定日期</th>
            <th>入藏状态</th>
            <th>架位编号 / 库房</th>
            <th>入藏操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in filteredAccessions" :key="record.id">
            <td>ACCE-{{ String(record.id).padStart(4, '0') }}</td>
            <td>{{ record.specimenNo }}</td>
            <td>{{ record.batchNo }}</td>
            <td>{{ record.unit }}</td>
            <td>{{ record.species }}</td>
            <td>{{ record.element }}</td>
            <td>{{ record.appraiser }}</td>
            <td>{{ record.identifiedAt }}</td>
            <td>
              <span class="status-tag" :data-status="record.status === '已入藏' ? '已复核' : '鉴定中'">
                {{ record.status }}
              </span>
            </td>
            <td>
              <template v-if="record.status === '已入藏'">
                {{ record.shelfNo }}<span v-if="record.storageName"> / {{ record.storageName }}</span>
                <br /><small>{{ record.accessionAt }}</small>
              </template>
              <span v-else class="muted">待登记</span>
            </td>
            <td>
              <div v-if="record.status === '待入藏'" class="accession-form">
                <input v-model="shelfDrafts[record.id].shelfNo" class="cell-input" placeholder="架位编号" />
                <input v-model="shelfDrafts[record.id].storageName" class="cell-input" placeholder="库房名称（可留空）" />
                <button class="btn primary small" type="button" @click="handleAccession(record.id)">登记入藏</button>
              </div>
              <span v-else class="muted">已完成</span>
            </td>
          </tr>
          <tr v-if="!filteredAccessions.length">
            <td colspan="11" class="empty-state">暂无匹配的入藏记录，动物骨骼批次完成鉴定后会自动同步到此</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房架位记录 · {{ pendingCount }} 条待入藏记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { assignShelf, listAccessionRecords } from '@/api/ident-service'
import type { AccessionRecord } from '@/data/ident-batch'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ['架位编号', '库房名称', '存放器物类别', '架位层数', '容纳件数', '当前件数', '管理人', '架位状态']
const actions = ['存放器物', '调整整理', '临时封存']
const statuses = ['正常使用', '已满', '待整理', '临时封存']

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

const accessions = ref<AccessionRecord[]>([])
const accessionFilter = ref('待入藏')
const accessionMessage = ref('')
const accessionOk = ref(true)
const shelfDrafts = reactive<Record<number, { shelfNo: string; storageName: string }>>({})

const pendingCount = computed(() => accessions.value.filter((record) => record.status === '待入藏').length)
const archivedCount = computed(() => accessions.value.filter((record) => record.status === '已入藏').length)

const stats = computed(() => [
  { label: '架位总数', value: rows.value.length },
  { label: '已满架位', value: rows.value.filter((row) => String(row.status) === '已满').length },
  { label: '可用架位', value: rows.value.filter((row) => String(row.status) === '正常使用').length },
  { label: '待入藏记录', value: pendingCount.value },
  { label: '本月已入藏', value: archivedCount.value },
])

const filteredAccessions = computed(() =>
  accessionFilter.value
    ? accessions.value.filter((record) => record.status === accessionFilter.value)
    : accessions.value,
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '库房架位登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

function reloadAccessions() {
  accessionMessage.value = ''
  accessions.value = listAccessionRecords()
  for (const record of accessions.value) {
    if (!shelfDrafts[record.id]) {
      shelfDrafts[record.id] = { shelfNo: '', storageName: '' }
    }
  }
}

function handleAccession(recordId: number) {
  const draft = shelfDrafts[recordId]
  const result = assignShelf(recordId, draft.shelfNo, draft.storageName)
  accessionOk.value = result.ok
  accessionMessage.value = result.message
  if (result.ok) {
    draft.shelfNo = ''
    draft.storageName = ''
    reloadAccessions()
  }
}

onMounted(() => {
  reload()
  reloadAccessions()
})
</script>
