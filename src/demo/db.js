// The in-memory "database" for the demo. A single reactive object holding one
// array per entity (mirrors the backend tables). Persisted to localStorage and
// version-gated so a reshaped seed auto-wipes stale data instead of crashing
// views that expect the new shape.
import { reactive, watch } from 'vue'
import { seedDemo } from './seed'

const STORAGE_KEY = 'mh02_demo_db'
// Bump whenever the seed/store shape changes -> old persisted data is discarded.
export const SEED_VERSION = 1

function emptyShape() {
  return {
    __v: SEED_VERSION,
    seq: {}, // per-entity id counters
    settings: null,
    users: [],
    clients: [],
    projects: [],
    assignments: [], // project <-> user
    teams: [],
    team_members: [],
    stages: [],
    stage_subtasks: [],
    tasks: [],
    weekly_timesheets: [],
    ts_entries: [],
    leaves: [],
    overtime_leaves: [],
    reimbursements: [],
    expenses: [],
    expense_parties: [],
    expense_payments: [],
    invoices: [],
    invoice_items: [],
    invoice_payments: [],
    bank_accounts: [],
    salary_slips: [],
    salary_history: [],
    holidays: [],
    overheads: [],
    overhead_employees: [],
    estimates: [],
    estimate_employees: [],
    drafts: [],
    audit_logs: [],
  }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (raw && raw.__v === SEED_VERSION && Array.isArray(raw.users) && raw.users.length) {
      return raw
    }
  } catch { /* corrupt / unavailable -> reseed */ }
  const fresh = emptyShape()
  seedDemo(fresh)
  return fresh
}

export const db = reactive(load())

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch { /* quota / private mode -> stay in-memory only */ }
}

// Persist the freshly seeded store immediately, so a reload reuses the same
// data instead of re-running the seeder (and so the first mutation isn't the
// only thing that ever writes).
persist()

// Debounced persistence on any mutation.
let saveTimer = null
watch(
  () => db,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 150)
  },
  { deep: true }
)

// Next id for an entity (1-based, monotonic within a session).
export function nextId(entity) {
  const cur = db.seq[entity] || 0
  const id = cur + 1
  db.seq[entity] = id
  return id
}

// Wipe + reseed from scratch (Reset button). Reloads so no stale reactive
// state or mounted-chart geometry survives.
export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
  window.location.reload()
}

// Force a fresh seed into the live store without a reload (used by "Run demo
// data" when the store is empty or the user wants a clean set mid-session).
export function reseedInPlace() {
  const fresh = emptyShape()
  seedDemo(fresh)
  Object.keys(fresh).forEach((k) => {
    db[k] = fresh[k]
  })
  persist()
}
