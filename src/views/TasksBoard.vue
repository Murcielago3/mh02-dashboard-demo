<template>
  <component :is="layout">
    <div class="tasks-board">
      <div class="tb-head">
        <div class="tb-head-text">
          <h1 class="tb-title"><span class="material-symbols-outlined">checklist</span> Tasks</h1>
          <p class="tb-sub">
            <template v-if="canEditStages">Every project's stages and subtasks, live across the studio.</template>
            <template v-else-if="canEditSubtasks">Tick off subtasks as your team delivers them.</template>
            <template v-else>Track where every project stands, stage by stage.</template>
          </p>
        </div>
      </div>

      <div class="panes">
        <!-- Pane 1: Projects -->
        <aside class="pane projects-pane">
          <div class="pane-head">
            <span class="material-symbols-outlined ph-icon">folder</span> Projects
            <span class="count">{{ filteredProjects.length }}</span>
          </div>
          <div class="search-wrap">
            <span class="material-symbols-outlined">search</span>
            <input v-model="projectSearch" class="search" placeholder="Search project or number…" />
          </div>
          <div class="sort-wrap">
            <span class="material-symbols-outlined">sort</span>
            <select v-model="sortBy" class="sort-select">
              <option v-for="o in SORTS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div v-if="loadingProjects" class="pane-empty">Loading…</div>
          <div v-else-if="!filteredProjects.length" class="pane-empty">No projects match.</div>
          <ul v-else class="plist">
            <li
              v-for="p in filteredProjects"
              :key="p.id"
              class="pitem"
              :class="{ active: p.id === selProjectId }"
              :style="{ '--accent': p.color || '#287475' }"
              @click="selectProject(p)"
            >
              <span class="pdot"></span>
              <div class="pmeta">
                <span class="pname">{{ p.name }}</span>
                <span class="pnum">{{ p.project_number || '—' }}</span>
              </div>
              <span v-if="counts[p.id]?.subtasks" class="pbadge" title="subtasks">
                {{ counts[p.id].subtasks }}
              </span>
              <span class="material-symbols-outlined chev">chevron_right</span>
            </li>
          </ul>
        </aside>

        <!-- Pane 2: Stages -->
        <section class="pane stages-pane">
          <div class="pane-head">
            <span class="material-symbols-outlined ph-icon">layers</span> Stages
            <span v-if="selProject" class="count">{{ stages.length }}</span>
          </div>

          <div v-if="!selProject" class="pane-empty big">
            <span class="material-symbols-outlined">arrow_back</span>
            <p>Pick a project to see its stages.</p>
          </div>
          <div v-else-if="loadingStages" class="pane-empty">Loading…</div>
          <template v-else>
            <div v-if="canEditStages && stageData" class="bucket-strip">
              <span class="material-symbols-outlined">savings</span>
              <strong>{{ inr(stageData.remaining_amount) }}</strong> · {{ fmtPct(stageData.remaining_percent) }}% left to allocate
            </div>
            <!-- Allocation bar -->
            <div v-if="stages.length" class="alloc-bar">
              <div v-for="(s, i) in stages" :key="'a'+s.id" class="alloc-seg"
                   :style="{ width: s.percentage + '%', background: segColor(s, i) }" :title="`${s.name} · ${fmtPct(s.percentage)}%`"></div>
            </div>

            <div v-if="canEditStages" class="add-form">
              <input v-model="newStage.name" class="inp" placeholder="New stage (e.g. DD)" @keyup.enter="submitStage" />
              <input v-model.number="newStage.percentage" type="number" min="0.01" step="0.01" class="inp inp-sm" placeholder="%" @keyup.enter="submitStage" />
              <button class="btn-mini primary" :disabled="!canSubmitStage" @click="submitStage"><span class="material-symbols-outlined">add</span></button>
            </div>

            <ul v-if="stages.length" class="slist">
              <li
                v-for="(s, i) in stages"
                :key="s.id"
                class="sitem"
                :class="{ active: s.id === selStageId, done: s.status === 'completed' }"
                :style="{ '--seg': segColor(s, i) }"
                @click="selectStage(s)"
              >
                <div class="sitem-main">
                  <div class="sitem-line1">
                    <span class="sdot"></span>
                    <span class="sname">{{ s.name }}</span>
                    <span v-if="s.status === 'completed'" class="done-chip"><span class="material-symbols-outlined">check_circle</span></span>
                  </div>
                  <div class="sitem-line2">
                    <span class="pct-pill">{{ fmtPct(s.percentage) }}%</span>
                    <span v-if="canEditStages" class="amt">{{ inr(s.amount) }}</span>
                    <span class="dot-sep">·</span>
                    <span class="completion" :class="complClass(s)">{{ s.completion_percent }}%</span>
                    <span class="subcount">{{ s.subtask_completed }}/{{ s.subtask_total }}</span>
                  </div>
                  <div class="mini-bar"><div class="mini-fill" :style="{ width: s.completion_percent + '%' }"></div></div>
                </div>
                <div v-if="canEditStages" class="sitem-actions" @click.stop>
                  <button class="icon-btn" :title="s.status === 'completed' ? 'Reopen' : 'Mark complete'" @click="toggleStageComplete(s)">
                    <span class="material-symbols-outlined">{{ s.status === 'completed' ? 'undo' : 'task_alt' }}</span>
                  </button>
                  <button class="icon-btn" title="Edit stage" @click="startEditStage(s)"><span class="material-symbols-outlined">edit</span></button>
                  <button class="icon-btn danger" title="Delete stage" @click="removeStage(s)"><span class="material-symbols-outlined">delete</span></button>
                </div>
                <span v-else class="material-symbols-outlined chev">chevron_right</span>

                <div v-if="editingStageId === s.id" class="inline-form" @click.stop>
                  <input v-model="editStageName" class="inp" placeholder="Stage name" />
                  <input v-model.number="editStagePct" type="number" min="0.01" step="0.01" class="inp inp-sm" placeholder="%" />
                  <button class="btn-mini primary" @click="saveStageEdit(s)">Save</button>
                  <button class="btn-mini" @click="editingStageId = null">Cancel</button>
                </div>
              </li>
            </ul>
            <div v-else class="pane-empty big"><span class="material-symbols-outlined">layers_clear</span><p>No stages defined yet.</p></div>
          </template>
        </section>

        <!-- Pane 3: Subtasks -->
        <section class="pane subtasks-pane">
          <div class="pane-head">
            <span class="material-symbols-outlined ph-icon">checklist_rtl</span> Subtasks
            <span v-if="selStage" class="count">{{ subtasks.length }}</span>
          </div>

          <div v-if="!selStage" class="pane-empty big">
            <span class="material-symbols-outlined">arrow_back</span>
            <p>Pick a stage to see its subtasks.</p>
          </div>
          <template v-else>
            <div class="subs-context">
              <span class="material-symbols-outlined">layers</span>{{ selStage.name }}
            </div>
            <div v-if="canEditSubtasks" class="add-form subtask-add">
              <input v-model="newSub.title" class="inp" placeholder="New subtask" @keyup.enter="submitSub" />
              <div class="inp-hours">
                <input v-model.number="newSub.hours" type="number" min="0" step="0.5" class="inp" placeholder="Hrs" @keyup.enter="submitSub" />
                <span class="hsfx">h</span>
              </div>
              <select v-model="newSub.assigned_to" class="inp inp-assignee">
                <option :value="null">Assign…</option>
                <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }}</option>
              </select>
              <button class="btn-mini primary" :disabled="!newSub.title.trim()" @click="submitSub"><span class="material-symbols-outlined">add</span></button>
            </div>
            <ul v-if="subtasks.length" class="tlist">
              <li v-for="t in subtasks" :key="t.id" class="titem" :class="{ done: t.status === 'completed' }">
                <button class="check" :class="{ checked: t.status === 'completed' }" :disabled="!canEditSubtasks"
                        :title="canEditSubtasks ? 'Toggle complete' : 'Only an admin or PM can complete this'" @click="toggleSub(t)">
                  <span v-if="t.status === 'completed'" class="material-symbols-outlined">check</span>
                </button>
                <div v-if="editingSubId === t.id" class="sub-edit">
                  <input v-model="editSubTitle" class="inp" placeholder="Subtask title" @keyup.enter="saveSubEdit(t)" />
                  <div class="inp-hours">
                    <input v-model.number="editSubHours" type="number" min="0" step="0.5" class="inp" placeholder="Hrs" @keyup.enter="saveSubEdit(t)" />
                    <span class="hsfx">h</span>
                  </div>
                  <select v-model="editSubAssignee" class="inp inp-assignee">
                    <option :value="null">Unassigned</option>
                    <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }}</option>
                  </select>
                  <button class="btn-mini primary" :disabled="!editSubTitle.trim()" @click="saveSubEdit(t)">Save</button>
                  <button class="btn-mini" @click="editingSubId = null">Cancel</button>
                </div>
                <div v-else class="tbody">
                  <div class="ttitle">{{ t.title }}</div>
                  <div class="tmeta">
                    <span v-if="t.hours != null" class="hours-chip"><span class="material-symbols-outlined">schedule</span>{{ fmtHours(t.hours) }}h</span>
                    <span v-if="t.assigned_to" class="assignee-chip"><span class="material-symbols-outlined">person</span>{{ empName(t.assigned_to) }}</span>
                    <span v-if="t.workers && t.workers.length" class="workers">
                      <span v-for="w in t.workers" :key="w.name" class="worker-chip">{{ w.name }} · {{ w.hours }}h logged</span>
                    </span>
                  </div>
                </div>
                <div v-if="canEditSubtasks && editingSubId !== t.id" class="titem-actions">
                  <button class="icon-btn sm" title="Edit" @click="startEditSub(t)"><span class="material-symbols-outlined">edit</span></button>
                  <button class="icon-btn danger sm" title="Delete" @click="removeSub(t)"><span class="material-symbols-outlined">close</span></button>
                </div>
              </li>
            </ul>
            <div v-else class="pane-empty big"><span class="material-symbols-outlined">playlist_add_check</span><p>No subtasks yet.</p></div>
          </template>
        </section>
      </div>

      <p v-if="errorMsg" class="tb-error">{{ errorMsg }}</p>
    </div>
  </component>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import EmployeeLayout from '../components/EmployeeLayout.vue'
import { useAuthStore } from '../stores/auth'
import { projectsAPI } from '../api/projects'
import { stagesAPI } from '../api/stages'
import { usersAPI } from '../api/users'

const authStore = useAuthStore()
const layout = computed(() => (authStore.role === 'employee' ? EmployeeLayout : AppLayout))
const canEditStages = computed(() => authStore.role === 'admin')
const canEditSubtasks = computed(() => authStore.role === 'admin' || authStore.role === 'project_manager')

const PALETTE = ['#287475', '#3b82f6', '#a855f7', '#f59e0b', '#059669', '#0ea5e9', '#dc2626', '#6366f1']

const projects = ref([])
const loadingProjects = ref(true)
const projectSearch = ref('')
const sortBy = ref('name')      // name | remaining | completed | recent
const counts = ref({})          // { [projectId]: { stages, subtasks, completed } }
const employees = ref([])       // assignable staff (for the assignee dropdown)
const employeesById = computed(() => Object.fromEntries(employees.value.map(e => [e.id, e.name])))
const selProjectId = ref(null)
const selProject = computed(() => projects.value.find(p => p.id === selProjectId.value) || null)

const SORTS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'remaining', label: 'Most subtasks left' },
  { value: 'completed', label: 'Most complete' },
  { value: 'recent', label: 'Latest added' },
]

function _remaining(p) { const c = counts.value[p.id]; return c ? (c.subtasks - c.completed) : 0 }
// Completion %: completed / total subtasks. Projects with no subtasks sort last.
function _completion(p) { const c = counts.value[p.id]; return (c && c.subtasks) ? c.completed / c.subtasks : -1 }

const filteredProjects = computed(() => {
  const q = projectSearch.value.trim().toLowerCase()
  const list = !q ? projects.value.slice() : projects.value.filter(p =>
    (p.name || '').toLowerCase().includes(q) || String(p.project_number || '').toLowerCase().includes(q))

  const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
  if (sortBy.value === 'remaining') {
    list.sort((a, b) => (_remaining(b) - _remaining(a)) || byName(a, b))
  } else if (sortBy.value === 'completed') {
    list.sort((a, b) => (_completion(b) - _completion(a)) || byName(a, b))
  } else if (sortBy.value === 'recent') {
    list.sort((a, b) => (b.id - a.id))
  } else {
    list.sort(byName)
  }
  return list
})

const stageData = ref(null)
const loadingStages = ref(false)
const stages = computed(() => stageData.value?.stages || [])
const selStageId = ref(null)
const selStage = computed(() => stages.value.find(s => s.id === selStageId.value) || null)
const subtasks = computed(() => selStage.value?.subtasks || [])

const errorMsg = ref('')
function fail(e, fallback) {
  errorMsg.value = e?.response?.data?.detail || fallback
  setTimeout(() => { errorMsg.value = '' }, 6000)
}

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
function inr(v) { return inrFmt.format(Number(v) || 0) }
function fmtPct(v) { const n = Number(v) || 0; return Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '') }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '' }
function fmtHours(v) { const n = Number(v) || 0; return Number.isInteger(n) ? n : n.toFixed(1) }
function empName(id) { return employeesById.value[id] || 'Unknown' }
function segColor(s, i) { return s.status === 'completed' ? '#059669' : PALETTE[i % PALETTE.length] }
function complClass(s) { return s.completion_percent >= 100 ? 'good' : (s.completion_percent > 0 ? 'mid' : '') }

async function selectProject(p) {
  if (selProjectId.value === p.id) return
  selProjectId.value = p.id
  selStageId.value = null
  await loadStages()
}
function selectStage(s) {
  if (editingStageId.value === s.id) return
  selStageId.value = s.id
}

async function loadStages() {
  if (!selProjectId.value) return
  loadingStages.value = true
  try {
    const { data } = await stagesAPI.list(selProjectId.value)
    stageData.value = data
    if (selStageId.value && !stages.value.some(s => s.id === selStageId.value)) selStageId.value = null
    // refresh this project's badge + sort counts
    counts.value = { ...counts.value, [selProjectId.value]: {
      stages: stages.value.length,
      subtasks: stages.value.reduce((n, s) => n + (s.subtask_total || 0), 0),
      completed: stages.value.reduce((n, s) => n + (s.subtask_completed || 0), 0),
    } }
  } catch (e) {
    stageData.value = null
    fail(e, 'Could not load stages.')
  } finally {
    loadingStages.value = false
  }
}

// stage CRUD (admin)
const newStage = ref({ name: '', percentage: null })
const canSubmitStage = computed(() => !!newStage.value.name.trim() && (Number(newStage.value.percentage) || 0) > 0)
async function submitStage() {
  if (!canSubmitStage.value) return
  try {
    await stagesAPI.create(selProjectId.value, { name: newStage.value.name.trim(), percentage: Number(newStage.value.percentage) })
    newStage.value = { name: '', percentage: null }
    await loadStages()
  } catch (e) { fail(e, 'Could not add the stage.') }
}
const editingStageId = ref(null)
const editStageName = ref('')
const editStagePct = ref(null)
function startEditStage(s) { editingStageId.value = s.id; editStageName.value = s.name; editStagePct.value = s.percentage }
async function saveStageEdit(s) {
  try { await stagesAPI.update(s.id, { name: editStageName.value.trim(), percentage: Number(editStagePct.value) }); editingStageId.value = null; await loadStages() }
  catch (e) { fail(e, 'Could not save the stage.') }
}
async function removeStage(s) {
  if (!confirm(`Delete stage "${s.name}"? Its ${s.subtask_total} subtask(s) will be deleted too.`)) return
  try { await stagesAPI.remove(s.id); if (selStageId.value === s.id) selStageId.value = null; await loadStages() }
  catch (e) { fail(e, 'Could not delete the stage.') }
}
async function toggleStageComplete(s) {
  try { await stagesAPI.update(s.id, { status: s.status === 'completed' ? 'active' : 'completed' }); await loadStages() }
  catch (e) { fail(e, 'Could not update the stage.') }
}

// subtask CRUD (admin/PM)
const newSub = ref({ title: '', hours: null, assigned_to: null })
async function submitSub() {
  if (!newSub.value.title.trim() || !selStage.value) return
  try {
    await stagesAPI.createSubtask(selStage.value.id, {
      title: newSub.value.title.trim(),
      hours: newSub.value.hours ?? null,
      assigned_to: newSub.value.assigned_to || null,
    })
    newSub.value = { title: '', hours: null, assigned_to: null }
    await loadStages()
  }
  catch (e) { fail(e, 'Could not add the subtask.') }
}
const editingSubId = ref(null)
const editSubTitle = ref('')
const editSubHours = ref(null)
const editSubAssignee = ref(null)
function startEditSub(t) {
  editingSubId.value = t.id
  editSubTitle.value = t.title
  editSubHours.value = t.hours ?? null
  editSubAssignee.value = t.assigned_to || null
}
async function saveSubEdit(t) {
  const title = editSubTitle.value.trim(); if (!title) return
  try {
    await stagesAPI.updateSubtask(t.id, {
      title,
      hours: editSubHours.value ?? null,
      assigned_to: editSubAssignee.value || null,
    })
    editingSubId.value = null
    await loadStages()
  }
  catch (e) { fail(e, 'Could not save the subtask.') }
}
async function toggleSub(t) {
  try { await stagesAPI.updateSubtask(t.id, { status: t.status === 'completed' ? 'pending' : 'completed' }); await loadStages() }
  catch (e) { fail(e, 'Could not update the subtask.') }
}
async function removeSub(t) {
  try { await stagesAPI.removeSubtask(t.id); await loadStages() }
  catch (e) { fail(e, 'Could not delete the subtask.') }
}

onMounted(async () => {
  try {
    const { data } = await projectsAPI.getProjects()
    projects.value = Array.isArray(data) ? data : (data?.projects || [])
  } catch (e) { fail(e, 'Could not load projects.') }
  finally { loadingProjects.value = false }
  // Per-project stage/subtask counts in one call, for the list badges.
  try {
    const { data } = await stagesAPI.listAll()
    const map = {}
    for (const st of (data || [])) {
      const m = (map[st.project_id] ||= { stages: 0, subtasks: 0, completed: 0 })
      m.stages += 1
      m.subtasks += st.subtask_total || 0
      m.completed += st.subtask_completed || 0
    }
    counts.value = map
  } catch { /* badges are best-effort */ }
  // Assignable staff for the subtask assignee dropdown (admins/PMs only).
  if (canEditSubtasks.value) {
    try {
      const { data } = await usersAPI.getUsers()
      const list = Array.isArray(data) ? data : (data?.users || [])
      employees.value = list
        .filter(u => u.role === 'employee' && u.is_active !== false)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    } catch { /* dropdown just stays empty */ }
  }
})
</script>

<style scoped>
.tasks-board { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.tb-title { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 26px; font-weight: 800; margin: 0; color: var(--color-on-surface); }
.tb-title .material-symbols-outlined { font-size: 26px; color: var(--color-primary); }
.tb-sub { margin: 4px 0 0; font-size: 13px; color: var(--color-on-surface-variant); }

.panes { display: grid; grid-template-columns: minmax(230px, 1fr) minmax(300px, 1.35fr) minmax(300px, 1.5fr); gap: 14px; flex: 1; min-height: 0; }
.pane {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--color-surface); border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,.04);
}
.pane-head {
  display: flex; align-items: center; gap: 7px; padding: 13px 14px;
  font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
  color: var(--color-on-surface-variant);
  border-bottom: 1px solid var(--color-outline-variant); flex-shrink: 0;
  background: var(--color-surface-container-lowest, #f8fafc);
}
.ph-icon { font-size: 16px; color: var(--color-primary); }
.pane-head .count { margin-left: auto; background: var(--color-surface-container); color: var(--color-on-surface-variant); border-radius: 999px; padding: 1px 9px; font-size: 11px; letter-spacing: 0; }
.pane-empty { padding: 18px 14px; font-size: 12px; font-style: italic; color: var(--color-on-surface-variant); }
.pane-empty.big { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-style: normal; opacity: .7; }
.pane-empty.big .material-symbols-outlined { font-size: 34px; opacity: .5; }
.pane-empty.big p { margin: 0; font-size: 13px; }

/* Search */
.search-wrap { display: flex; align-items: center; gap: 6px; margin: 8px; padding: 0 10px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface); }
.search-wrap .material-symbols-outlined { font-size: 17px; color: var(--color-on-surface-variant); }
.search { border: none; outline: none; background: none; padding: 8px 0; font-size: 13px; flex: 1; color: var(--color-on-surface); min-width: 0; }
.sort-wrap { display: flex; align-items: center; gap: 6px; margin: 0 8px 4px; padding: 0 8px 0 10px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface); }
.sort-wrap .material-symbols-outlined { font-size: 16px; color: var(--color-on-surface-variant); }
.sort-select { border: none; outline: none; background: none; padding: 7px 0; font-size: 12.5px; font-weight: 600; flex: 1; color: var(--color-on-surface); cursor: pointer; min-width: 0; }

/* Projects */
.plist, .slist, .tlist { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 3px; }
.pitem { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 8px; border-radius: var(--radius-md); cursor: pointer; border-left: 3px solid transparent; }
.pitem:hover { background: var(--color-surface-container-lowest, #f8fafc); }
.pitem.active { background: color-mix(in srgb, var(--accent) 12%, transparent); border-left-color: var(--accent); }
.pdot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
.pmeta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pname { font-size: 13px; font-weight: 600; color: var(--color-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pitem.active .pname { color: var(--accent); font-weight: 700; }
.pnum { font-size: 10.5px; font-weight: 700; color: var(--color-on-surface-variant); font-variant-numeric: tabular-nums; }
.pbadge { background: var(--color-primary); color: #fff; border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 800; flex-shrink: 0; }
.pitem .chev { font-size: 18px; color: var(--color-outline); flex-shrink: 0; }
.pitem.active .chev { color: var(--accent); }

/* Stages */
.bucket-strip { display: flex; align-items: center; gap: 6px; padding: 9px 14px; font-size: 11.5px; font-weight: 600; color: var(--color-on-surface-variant); background: var(--color-surface-container-lowest, #f8fafc); border-bottom: 1px solid var(--color-outline-variant); }
.bucket-strip .material-symbols-outlined { font-size: 15px; color: var(--color-primary); }
.bucket-strip strong { color: var(--color-primary); }
.alloc-bar { display: flex; height: 6px; margin: 10px 12px 2px; border-radius: 999px; overflow: hidden; background: var(--color-outline-variant); flex-shrink: 0; }
.alloc-seg { height: 100%; }
.sitem { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px; padding: 11px; border-radius: var(--radius-md); cursor: pointer; border: 1px solid transparent; }
.sitem:hover { background: var(--color-surface-container-lowest, #f8fafc); }
.sitem.active { background: color-mix(in srgb, var(--seg) 10%, transparent); border-color: var(--seg); }
.sitem.done { background: #f0fdf4; }
.sitem-main { min-width: 0; }
.sitem-line1 { display: flex; align-items: center; gap: 7px; }
.sdot { width: 8px; height: 8px; border-radius: 2px; background: var(--seg); flex-shrink: 0; }
.sname { font-size: 13.5px; font-weight: 700; color: var(--color-on-surface); }
.done-chip { display: inline-flex; color: #059669; }
.done-chip .material-symbols-outlined { font-size: 15px; }
.sitem-line2 { display: flex; align-items: center; gap: 7px; margin-top: 4px; margin-left: 15px; font-size: 11.5px; }
.pct-pill { background: color-mix(in srgb, var(--seg) 15%, transparent); color: var(--seg); font-weight: 800; padding: 1px 7px; border-radius: 999px; }
.amt { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--color-on-surface); }
.dot-sep { color: var(--color-outline); }
.completion { font-weight: 700; color: var(--color-on-surface-variant); }
.completion.good { color: #059669; }
.completion.mid { color: #b45309; }
.subcount { color: var(--color-on-surface-variant); font-weight: 600; }
.mini-bar { height: 4px; border-radius: 999px; background: var(--color-outline-variant); margin: 7px 0 0 15px; overflow: hidden; }
.mini-fill { height: 100%; background: #059669; transition: width .25s; }
.sitem-actions { display: flex; gap: 1px; }
.sitem .chev { font-size: 18px; color: var(--color-outline); }
.inline-form { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }

/* Subtasks */
.subs-context { display: flex; align-items: center; gap: 6px; padding: 9px 14px; font-size: 11.5px; font-weight: 700; color: var(--color-on-surface-variant); background: var(--color-surface-container-lowest, #f8fafc); border-bottom: 1px solid var(--color-outline-variant); }
.subs-context .material-symbols-outlined { font-size: 14px; color: var(--color-primary); }
.titem { display: flex; align-items: flex-start; gap: 10px; padding: 10px 8px; border-radius: var(--radius-md); }
.titem:hover { background: var(--color-surface-container-lowest, #f8fafc); }
.titem.done .ttitle { text-decoration: line-through; color: var(--color-on-surface-variant); }
.check { width: 19px; height: 19px; flex-shrink: 0; margin-top: 1px; border: 2px solid var(--color-outline); border-radius: 6px; background: var(--color-surface); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; transition: background .12s, border-color .12s; }
.check.checked { background: var(--color-primary); border-color: var(--color-primary); }
.check:disabled { cursor: default; opacity: .55; }
.check .material-symbols-outlined { font-size: 13px; color: #fff; }
.tbody { flex: 1; min-width: 0; }
.ttitle { font-size: 13.5px; font-weight: 600; color: var(--color-on-surface); }
.tmeta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; font-size: 11px; }
.due { display: inline-flex; align-items: center; gap: 3px; color: var(--color-on-surface-variant); }
.due .material-symbols-outlined { font-size: 13px; }
.due.late { color: #dc2626; font-weight: 700; }
.workers { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.worker-chip { background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 700; }
.hours-chip, .assignee-chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 700; }
.hours-chip { background: #eef2ff; color: #4338ca; }
.assignee-chip { background: #ecfdf5; color: #047857; }
.hours-chip .material-symbols-outlined, .assignee-chip .material-symbols-outlined { font-size: 12px; }
.sub-edit { flex: 1; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.titem-actions { display: flex; gap: 1px; flex-shrink: 0; }

/* controls */
.add-form { display: flex; gap: 6px; align-items: center; padding: 10px; border-bottom: 1px solid var(--color-outline-variant); flex-shrink: 0; }
.inp { padding: 8px 10px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); font-size: 13px; background: var(--color-surface); color: var(--color-on-surface); outline: none; min-width: 0; flex: 1; }
.inp:focus { border-color: var(--color-primary); }
.inp-sm { flex: 0 0 72px; }
.inp-date { flex: 0 0 140px; }
.subtask-add { flex-wrap: wrap; }
.inp-hours { position: relative; flex: 0 0 74px; display: flex; align-items: center; }
.inp-hours .inp { flex: 1; padding-right: 18px; }
.inp-hours .hsfx { position: absolute; right: 9px; font-size: 12px; font-weight: 700; color: var(--color-on-surface-variant); pointer-events: none; }
.inp-assignee { flex: 1 1 120px; min-width: 110px; cursor: pointer; }
.btn-mini { display: inline-flex; align-items: center; gap: 4px; padding: 8px 11px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface); font-size: 12px; font-weight: 700; cursor: pointer; color: var(--color-on-surface-variant); white-space: nowrap; }
.btn-mini.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.btn-mini:disabled { opacity: .5; cursor: not-allowed; }
.btn-mini .material-symbols-outlined { font-size: 16px; }
.icon-btn { width: 27px; height: 27px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: var(--radius-md); background: none; cursor: pointer; color: var(--color-on-surface-variant); }
.icon-btn:hover { background: var(--color-surface-container); }
.icon-btn.danger:hover { background: #fee2e2; color: #dc2626; }
.icon-btn .material-symbols-outlined { font-size: 16px; }
.icon-btn.sm { width: 22px; height: 22px; }
.icon-btn.sm .material-symbols-outlined { font-size: 14px; }
.tb-error { font-size: 12px; color: #dc2626; margin: 0; }

@media (max-width: 900px) {
  .panes { grid-template-columns: 1fr; }
  .pane { max-height: 360px; }
}
</style>
