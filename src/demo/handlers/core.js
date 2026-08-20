// Handlers: auth, users, settings, clients, bank accounts, holidays, dashboard.
import { route, httpError } from '../mockClient'
import { db, nextId } from '../db'
import * as D from '../derive'
import { NOW, iso, addMonths, monthKey } from '../dates'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const findUser = (id) => db.users.find((u) => u.id === Number(id))

// Overhead hourly per the backend: monthly -> cost/(days*8), yearly -> cost/2080.
function overheadHourly(o) {
  const cost = Number(o.cost) || 0
  if (o.period_type === 'yearly') return D.r2(cost / 2080)
  const d = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate()
  return D.r2(cost / (d * 8))
}

function userOut(u) {
  const oh = db.overheads
    .filter((o) => db.overhead_employees.some((x) => x.overhead_id === o.id && x.employee_id === u.id))
    .reduce((s, o) => s + overheadHourly(o), 0)
  return { ...u, overhead_hourly: D.r2(oh) }
}

// ─── Auth ───
// The demo has no passwords: any login resolves to the matching studio email,
// falling back to Admin 1 so a prospect can never get locked out.
route('POST', '/auth/login', ({ body }) => {
  const email = String(body.studio_email || '').toLowerCase().trim()
  const user = db.users.find((u) => u.studio_email.toLowerCase() === email) || db.users[0]
  return {
    access_token: `demo-token-${user.id}`,
    token_type: 'bearer',
    role: user.role,
    user_id: user.id,
    name: user.name,
  }
})

// ─── Users ───
route('GET', '/users', ({ query }) => {
  const includeEnded = String(query.include_ended) === 'true'
  const today = iso(NOW)
  return db.users
    .filter((u) => u.is_active)
    .filter((u) => includeEnded || !u.end_date || u.end_date >= today)
    .slice()
    .sort((a, b) => b.id - a.id)
    .map(userOut)
})

route('GET', '/users/me', () => {
  const u = findUser(currentUserId()) || db.users[0]
  return userOut(u)
})

route('GET', '/users/:id', ({ params }) => {
  const u = findUser(params.id)
  if (!u) throw httpError(404, 'User not found')
  return userOut(u)
})

route('POST', '/users', ({ body }) => {
  const id = nextId('users')
  const monthly = Number(body.salary_month) || 0
  const s = db.settings
  const hourly = monthly ? D.r2((monthly * s.salary_months_per_year) / 12 / s.working_hours_per_month) : 0
  const u = {
    id,
    is_active: true,
    photo_url: null,
    documents_url: null,
    paid_leave_balance: 0,
    leave_accrued_through: monthKey(NOW),
    hourly_rate: hourly,
    ...body,
  }
  delete u.password
  db.users.push(u)
  if (monthly) {
    db.salary_history.push({
      id: nextId('salary_history'),
      user_id: id,
      monthly_salary: monthly,
      salary_hour: null,
      smpy: s.salary_months_per_year,
      whpm: s.working_hours_per_month,
      hourly_rate: hourly,
      effective_from: u.joining_date || iso(NOW),
      effective_to: null,
      note: 'Initial',
    })
  }
  logAudit('create', 'user', id, `Created ${u.name}`)
  return userOut(u)
})

route('PATCH', '/users/:id', ({ params, body }) => {
  const u = findUser(params.id)
  if (!u) throw httpError(404, 'User not found')
  const payload = { ...body }
  delete payload.password
  Object.assign(u, payload)
  if (body.salary_month != null) {
    const s = db.settings
    u.hourly_rate = D.r2((Number(body.salary_month) * s.salary_months_per_year) / 12 / s.working_hours_per_month)
  }
  logAudit('update', 'user', u.id, `Updated ${u.name}`)
  return userOut(u)
})

route('DELETE', '/users/:id', ({ params }) => {
  const u = findUser(params.id)
  if (u) u.is_active = false
  return null
})

// Photo / document uploads: object URLs so the image appears instantly with no
// server. They don't survive a reload, which is fine for a demo.
route('POST', '/users/:id/upload-photo', ({ params, body }) => {
  const u = findUser(params.id)
  if (!u) throw httpError(404, 'User not found')
  const file = body instanceof FormData ? body.get('file') : null
  const url = file ? URL.createObjectURL(file) : null
  u.photo_url = url
  return { photo_url: url }
})

route('POST', '/users/:id/upload-document', ({ params, body }) => {
  const u = findUser(params.id)
  if (!u) throw httpError(404, 'User not found')
  const file = body instanceof FormData ? body.get('file') : null
  const docType = body instanceof FormData ? body.get('doc_type') : 'document'
  const url = file ? URL.createObjectURL(file) : null
  const docs = u.documents_url ? JSON.parse(u.documents_url) : {}
  docs[docType] = url
  u.documents_url = JSON.stringify(docs)
  return { doc_type: docType, url, filename: file ? file.name : 'demo.pdf' }
})

route('GET', '/users/:id/documents', ({ params }) => {
  const u = findUser(params.id)
  if (!u || !u.documents_url) return {}
  try { return JSON.parse(u.documents_url) } catch { return {} }
})

route('DELETE', '/users/:id/documents/:docType', ({ params }) => {
  const u = findUser(params.id)
  if (u && u.documents_url) {
    try {
      const docs = JSON.parse(u.documents_url)
      delete docs[params.docType]
      u.documents_url = JSON.stringify(docs)
    } catch { /* ignore */ }
  }
  return { detail: `Document '${params.docType}' removed.` }
})

// ─── Settings ───
route('GET', '/settings', () => ({ ...db.settings }))
route('PATCH', '/settings', ({ body }) => {
  Object.entries(body || {}).forEach(([k, v]) => {
    if (v != null) db.settings[k] = v
  })
  return { ...db.settings }
})

// ─── Clients ───
route('GET', '/clients', () => db.clients.slice().sort((a, b) => b.id - a.id))
route('GET', '/clients/:id', ({ params }) => {
  const c = db.clients.find((x) => x.id === Number(params.id))
  if (!c) throw httpError(404, 'Client not found')
  return c
})
route('POST', '/clients', ({ body }) => {
  const c = { id: nextId('clients'), customer_type: 'business', ...body }
  db.clients.push(c)
  logAudit('create', 'client', c.id, `Created ${c.name}`)
  return c
})
route('PATCH', '/clients/:id', ({ params, body }) => {
  const c = db.clients.find((x) => x.id === Number(params.id))
  if (!c) throw httpError(404, 'Client not found')
  Object.assign(c, body)
  return c
})
route('DELETE', '/clients/:id', ({ params }) => {
  const i = db.clients.findIndex((x) => x.id === Number(params.id))
  if (i >= 0) db.clients.splice(i, 1)
  return null
})

// ─── Bank accounts ───
route('GET', '/bank-accounts', () => db.bank_accounts.filter((b) => b.is_active))
route('POST', '/bank-accounts', ({ body }) => {
  const b = { id: nextId('bank_accounts'), is_active: true, ...body }
  db.bank_accounts.push(b)
  return b
})
route('PATCH', '/bank-accounts/:id', ({ params, body }) => {
  const b = db.bank_accounts.find((x) => x.id === Number(params.id))
  if (!b) throw httpError(404, 'Bank account not found')
  Object.assign(b, body)
  return b
})
route('DELETE', '/bank-accounts/:id', ({ params }) => {
  const b = db.bank_accounts.find((x) => x.id === Number(params.id))
  if (b) b.is_active = false
  return null
})

// ─── Holidays ───
route('GET', '/holidays', () =>
  db.holidays.slice().sort((a, b) => (a.date < b.date ? -1 : 1))
)
route('POST', '/holidays', ({ body }) => {
  const existing = db.holidays.find((h) => h.date === body.date)
  if (existing) { existing.name = body.name; return existing }
  const h = { id: nextId('holidays'), date: body.date, name: body.name }
  db.holidays.push(h)
  return h
})
route('DELETE', '/holidays/:id', ({ params }) => {
  const i = db.holidays.findIndex((h) => h.id === Number(params.id))
  if (i >= 0) db.holidays.splice(i, 1)
  return null
})

// ─── Dashboard stats ───
route('GET', '/dashboard/stats', () => {
  let totalInvoiced = 0, totalEmp = 0, totalPartner = 0, totalProfit = 0, totalUnbilled = 0
  db.projects.forEach((p) => {
    const r = D.projectReserve(p.id)
    totalInvoiced += r.total_invoiced
    totalEmp += r.employee_cost
    totalPartner += r.partner_cost
    if (r.reserve_balance > 0) totalProfit += r.reserve_balance
    else if (r.reserve_balance < 0 && r.total_invoiced > 0) totalUnbilled += -r.reserve_balance
  })

  const currentYear = NOW.getFullYear()
  const totalFyTurnover = D.r2(db.invoices
    .filter((i) => new Date(i.invoice_date).getFullYear() === currentYear)
    .reduce((s, i) => s + Number(i.subtotal || 0), 0))

  // Trailing 13 buckets (today - 1yr .. today), matching the backend window.
  const window = []
  for (let k = 12; k >= 0; k--) {
    const d = addMonths(NOW, -k)
    window.push([d.getFullYear(), d.getMonth() + 1])
  }
  const monthlySales12m = window.map(([y, m]) => ({
    label: `${MONTH_ABBR[m - 1]} '${String(y).slice(2)}`,
    year: y,
    month: m,
    revenue: D.r2(db.invoices
      .filter((i) => {
        const d = new Date(i.invoice_date)
        return d.getFullYear() === y && d.getMonth() + 1 === m
      })
      .reduce((s, i) => s + Number(i.subtotal || 0), 0)),
  }))
  // Calendar-year series used by the older chart.
  const monthlySales = MONTH_ABBR.map((label, idx) => ({
    label,
    month: idx + 1,
    revenue: D.r2(db.invoices
      .filter((i) => {
        const d = new Date(i.invoice_date)
        return d.getFullYear() === currentYear && d.getMonth() === idx
      })
      .reduce((s, i) => s + Number(i.subtotal || 0), 0)),
  }))

  const currentMonth = NOW.getMonth() + 1
  const sumExp = (cat) => D.r2(db.expenses
    .filter((e) => {
      const d = new Date(e.date)
      return e.category === cat && d.getFullYear() === currentYear && d.getMonth() + 1 === currentMonth
    })
    .reduce((s, e) => s + Number(e.amount || 0), 0))

  const officeRent = sumExp('rent')
  const electricity = sumExp('utilities')
  const software = sumExp('software')
  const misc = sumExp('misc')
  const monthlyPayroll = D.r2(db.users.filter((u) => u.is_active)
    .reduce((s, u) => s + Number(u.salary_month || 0), 0))

  return {
    total_fy_turnover: totalFyTurnover,
    total_billed: D.r2(totalInvoiced),
    total_unbilled: D.r2(totalUnbilled),
    total_profit: D.r2(totalProfit),
    total_employee_remuneration: D.r2(totalEmp),
    total_partner_remuneration: D.r2(totalPartner),
    monthly_payroll: monthlyPayroll,
    fy_expenses: {
      salary: monthlyPayroll,
      office_rent: officeRent,
      electricity_bills: electricity,
      software_licenses: software,
      misc,
      total: D.r2(monthlyPayroll + officeRent + electricity + software + misc),
    },
    monthly_sales: monthlySales,
    monthly_sales_12m: monthlySales12m,
  }
})

// ─── Audit ───
route('GET', '/audit-logs', ({ query }) => {
  let rows = db.audit_logs.slice()
  if (query.entity_type) rows = rows.filter((r) => r.entity_type === query.entity_type)
  if (query.action) rows = rows.filter((r) => r.action === query.action)
  const limit = Number(query.limit) || 100
  return rows.slice(0, limit)
})
route('GET', '/audit-logs/entity-types', () =>
  [...new Set(db.audit_logs.map((r) => r.entity_type).filter(Boolean))]
)

// ── shared helpers used by the other handler modules ──
export function currentUserId() {
  const token = localStorage.getItem('access_token') || ''
  const m = /demo-token-(\d+)/.exec(token)
  return m ? Number(m[1]) : (db.users[0] ? db.users[0].id : 1)
}

export function logAudit(action, entityType, entityId, summary) {
  const actor = findUser(currentUserId())
  db.audit_logs.unshift({
    id: nextId('audit_logs'),
    created_at: new Date().toISOString(),
    actor_id: actor ? actor.id : null,
    actor_name: actor ? actor.name : 'Demo User',
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    details: null,
  })
}
