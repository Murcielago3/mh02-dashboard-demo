// The in-memory "database" for the demo. A single reactive object holding one
// array per entity (mirrors the backend tables). Persisted to localStorage and
// version-gated so a reshaped seed auto-wipes stale data instead of crashing
// views that expect the new shape.
import { reactive, watch } from 'vue'
import { seedDemo } from './seed'

const STORAGE_KEY = 'mh02_demo_db'
// One-shot seed left behind by a reset so the post-reload reseed produces a
// visibly different dataset (the first-ever load has none -> rehearsed default).
const RESEED_KEY = 'mh02_demo_reseed'
// Bump whenever the seed/store shape changes -> old persisted data is discarded.
export const SEED_VERSION = 1

// A fresh 32-bit seed for a regenerated dataset.
function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff)) >>> 0
}

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
  // A reset drops a one-shot random seed here so the regenerated data looks
  // different; consume it so subsequent plain reloads stay stable.
  let seed
  try {
    const pending = localStorage.getItem(RESEED_KEY)
    if (pending != null) {
      seed = Number(pending) >>> 0
      localStorage.removeItem(RESEED_KEY)
    }
  } catch { /* storage unavailable -> rehearsed default */ }
  seedDemo(fresh, seed)
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

// Wipe + regenerate from scratch (Reset button). Leaves a one-shot random seed
// so the reloaded dataset is visibly different (not the identical rehearsed set
// every time), then reloads so no stale reactive state or mounted-chart
// geometry survives.
export function resetDemo() {
  try {
    localStorage.setItem(RESEED_KEY, String(randomSeed()))
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
  window.location.reload()
}

// Force a fresh, differently-seeded dataset into the live store without a reload
// (used by "Run demo data" when the store is empty or the user wants a clean
// set mid-session).
export function reseedInPlace() {
  const fresh = emptyShape()
  seedDemo(fresh, randomSeed())
  Object.keys(fresh).forEach((k) => {
    db[k] = fresh[k]
  })
  persist()
}
