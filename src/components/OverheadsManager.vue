<template>
  <div class="oh">
    <div class="oh-head">
      <div>
        <h2 class="section-title">Overheads</h2>
        <p class="section-note">Business costs and who they apply to. Yearly ÷ 2080 hrs, monthly ÷ (days-in-month × 8) gives the per-hour figure. Overheads don't change salary slips.</p>
      </div>
      <button class="add-btn" @click="openCreate">
        <span class="material-symbols-outlined">add</span>
        Add Overhead
      </button>
    </div>

    <div class="table-card">
      <table class="oh-table">
        <thead>
          <tr>
            <th>Overhead #</th>
            <th>Description</th>
            <th class="right">Cost</th>
            <th>Period</th>
            <th class="right">Hourly</th>
            <th>Applies to</th>
            <th class="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="7" class="empty">Loading…</td></tr>
          <tr v-else-if="!overheads.length"><td colspan="7" class="empty">No overheads yet. Click "Add Overhead" to create one.</td></tr>
          <tr v-for="o in overheads" :key="o.id">
            <td class="mono">{{ o.number }}</td>
            <td>{{ o.description }}</td>
            <td class="right mono">₹{{ fmt(o.cost) }}</td>
            <td><span class="pill" :class="o.period_type">{{ o.period_type === 'yearly' ? 'Yearly' : 'Monthly' }}</span></td>
            <td class="right mono">₹{{ fmt(o.hourly) }}/hr</td>
            <td>
              <span v-if="!o.employees.length" class="muted">—</span>
              <span v-else class="emp-chips">
                <span v-for="e in o.employees" :key="e.id" class="emp-chip">{{ e.name }}</span>
              </span>
            </td>
            <td class="right">
              <button class="link-btn" @click="openEdit(o)">Edit</button>
              <button class="link-btn danger" @click="confirmDelete(o)">Delete</button>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="overheads.length">
          <tr class="total-row">
            <td colspan="4" class="total-label">TOTAL OVERHEADS</td>
            <td class="right mono total-val">₹{{ fmt(totalHourly) }}/hr</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Create / Edit modal -->
    <Teleport to="body">
      <div v-if="modalOpen" class="modal-backdrop" @click.self="modalOpen = false">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">{{ editing ? 'Edit Overhead' : 'Add Overhead' }}</h3>
            <button class="modal-close" @click="modalOpen = false"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div class="modal-body">
            <label class="fld">
              <span>Description *</span>
              <input v-model="form.description" type="text" placeholder="e.g. Office rent, software licenses" />
            </label>
            <div class="fld-row">
              <label class="fld">
                <span>Cost (₹) *</span>
                <CurrencyInput v-model="form.cost" class="cost-input" placeholder="0.00" />
              </label>
              <label class="fld">
                <span>Period</span>
                <select v-model="form.period_type">
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
            </div>
            <p class="hourly-preview" v-if="form.cost > 0">
              ≈ <strong>₹{{ fmt(previewHourly) }}/hr</strong>
              <span class="muted">({{ form.period_type === 'yearly' ? 'cost ÷ 2080' : `cost ÷ (${daysThisMonth} × 8)` }})</span>
            </p>

            <div class="fld">
              <span class="fld-label-row">
                Applies to
                <button v-if="employees.length" type="button" class="select-all-btn" @click="toggleAll">
                  {{ allSelected ? 'Clear all' : 'Select all' }}
                </button>
              </span>
              <div class="emp-picker">
                <label v-for="e in employees" :key="e.id" class="emp-opt">
                  <input type="checkbox" :value="e.id" v-model="form.employee_ids" />
                  <span>{{ e.name }}</span>
                </label>
                <p v-if="!employees.length" class="muted">No employees.</p>
              </div>
            </div>
            <p v-if="error" class="err">{{ error }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" @click="modalOpen = false">Cancel</button>
            <button class="btn-submit" :disabled="!canSave || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
        <div class="modal modal-sm">
          <div class="modal-header"><h3 class="modal-title">Delete Overhead</h3></div>
          <div class="modal-body"><p>Delete <strong>{{ deleteTarget.number }} — {{ deleteTarget.description }}</strong>?</p></div>
          <div class="modal-footer">
            <button class="btn-cancel" @click="deleteTarget = null">Cancel</button>
            <button class="btn-danger" :disabled="saving" @click="doDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { overheadsAPI } from '../api/overheads'
import { usersAPI } from '../api/users'
import CurrencyInput from './CurrencyInput.vue'

const overheads = ref([])
const totalHourly = ref(0)
const employees = ref([])
const loading = ref(true)
const modalOpen = ref(false)
const editing = ref(null)
const deleteTarget = ref(null)
const saving = ref(false)
const error = ref('')
const form = reactive({ description: '', cost: null, period_type: 'monthly', employee_ids: [] })

const daysThisMonth = computed(() => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()
})
const previewHourly = computed(() => {
  const c = Number(form.cost) || 0
  if (c <= 0) return 0
  return form.period_type === 'yearly'
    ? Math.round((c / 2080) * 100) / 100
    : Math.round((c / (daysThisMonth.value * 8)) * 100) / 100
})
const canSave = computed(() => form.description.trim() && Number(form.cost) > 0)
const allSelected = computed(() => employees.value.length > 0 && form.employee_ids.length === employees.value.length)
function toggleAll() {
  form.employee_ids = allSelected.value ? [] : employees.value.map(e => e.id)
}

function fmt(v) { return (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

async function load() {
  loading.value = true
  try {
    const [o, u] = await Promise.all([overheadsAPI.list(), usersAPI.getUsers()])
    overheads.value = o.data?.items || o.data || []
    totalHourly.value = o.data?.total_hourly || 0
    employees.value = (u.data || []).slice().sort((a, b) => a.name.localeCompare(b.name))
  } catch (e) { /* ignore */ } finally { loading.value = false }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { description: '', cost: null, period_type: 'monthly', employee_ids: [] })
  error.value = ''
  modalOpen.value = true
}
function openEdit(o) {
  editing.value = o
  Object.assign(form, { description: o.description, cost: Number(o.cost), period_type: o.period_type, employee_ids: [...o.employee_ids] })
  error.value = ''
  modalOpen.value = true
}
async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  try {
    const payload = { description: form.description.trim(), cost: Number(form.cost) || 0, period_type: form.period_type, employee_ids: form.employee_ids }
    if (editing.value) await overheadsAPI.update(editing.value.id, payload)
    else await overheadsAPI.create(payload)
    modalOpen.value = false
    await load()
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not save the overhead.'
  } finally { saving.value = false }
}
function confirmDelete(o) { deleteTarget.value = o }
async function doDelete() {
  saving.value = true
  try {
    await overheadsAPI.remove(deleteTarget.value.id)
    deleteTarget.value = null
    await load()
  } catch (e) { /* ignore */ } finally { saving.value = false }
}

onMounted(load)
</script>

<style scoped>
.oh-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; }
.section-title { font-family: var(--font-display); font-size: 18px; font-weight: 800; color: var(--color-on-surface); margin: 0; }
.section-note { font-size: 12.5px; color: var(--color-on-surface-variant); margin: 2px 0 0; max-width: 720px; }
.add-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; white-space: nowrap;
  background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-lg); font-size: 13px; font-weight: 700; cursor: pointer;
}
.add-btn .material-symbols-outlined { font-size: 18px; }
.table-card { background: var(--color-surface); border: 1px solid var(--color-outline); border-radius: var(--radius-xl); overflow-x: auto; }
.oh-table { width: 100%; border-collapse: collapse; }
.oh-table thead { background: #f8fafc; }
.oh-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--color-on-surface-variant); padding: 11px 14px; white-space: nowrap; }
.oh-table td { padding: 12px 14px; font-size: 13px; border-top: 1px solid var(--color-outline-variant); vertical-align: middle; color: var(--color-on-surface); }
.oh-table .right { text-align: right; }
.oh-table .empty { text-align: center; color: var(--color-on-surface-variant); font-style: italic; padding: 26px; }
.mono { font-variant-numeric: tabular-nums; }
.muted { color: var(--color-on-surface-variant); }
.pill { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.pill.monthly { background: #dbeafe; color: #1d4ed8; }
.pill.yearly { background: #ede9fe; color: #5b21b6; }
.emp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.emp-chip { background: var(--color-surface-dim, #f1f5f9); border: 1px solid var(--color-outline); border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.link-btn { background: none; border: none; color: var(--color-primary); font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 0 6px; }
.link-btn.danger { color: var(--color-error, #dc2626); }

.total-row { background: #f0fafa; border-top: 2px solid var(--color-primary); }
.total-label { padding: 13px 14px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-primary); }
.total-val { font-size: 14px; font-weight: 800; color: var(--color-primary); padding: 13px 14px; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--color-surface); border-radius: var(--radius-xl); width: 92%; max-width: 520px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.16); }
.modal-sm { max-width: 400px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--color-outline); }
.modal-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; margin: 0; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--color-on-surface-variant); }
.modal-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.modal-body p { margin: 0; font-size: 14px; }
.fld { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; color: var(--color-on-surface-variant); }
.fld-label-row { display: flex; align-items: center; justify-content: space-between; }
.select-all-btn { background: none; border: none; color: var(--color-primary); font-size: 12px; font-weight: 700; cursor: pointer; padding: 0; }
.select-all-btn:hover { text-decoration: underline; }
.fld input, .fld select, .fld :deep(input.cost-input) { padding: 9px 11px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); font-size: 13px; font-weight: 500; background: var(--color-surface); color: var(--color-on-surface); outline: none; width: 100%; box-sizing: border-box; }
.fld input:focus, .fld select:focus, .fld :deep(input.cost-input:focus) { border-color: var(--color-primary); }
.fld-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.hourly-preview { font-size: 12.5px; color: var(--color-primary); }
.emp-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; max-height: 220px; overflow-y: auto; padding: 10px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface-dim, #f8fafc); }
.emp-opt { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; color: var(--color-on-surface); cursor: pointer; }
.emp-opt input { width: 15px; height: 15px; accent-color: var(--color-primary); }
.err { color: var(--color-error, #dc2626); font-size: 12.5px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 15px 22px; border-top: 1px solid var(--color-outline); background: #f8fafc; }
.btn-cancel { padding: 8px 16px; background: var(--color-surface); border: 1px solid var(--color-outline); border-radius: var(--radius-lg); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-submit { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-lg); font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-submit:disabled { opacity: .5; cursor: not-allowed; }
.btn-danger { padding: 9px 18px; background: var(--color-error, #dc2626); color: #fff; border: none; border-radius: var(--radius-lg); font-size: 13px; font-weight: 700; cursor: pointer; }
</style>
