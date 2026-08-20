// Handlers: invoices (+items, payments, PDF/preview), expenses (+parties,
// payments), overheads, estimates, drafts, reports, exports.
import { route, httpError } from '../mockClient'
import { db, nextId } from '../db'
import * as D from '../derive'
import { NOW, iso, addDays, addMonths, monthKey } from '../dates'
import { currentUserId, findUser, logAudit } from './core'
import { renderInvoiceHtml } from '../pdf/invoiceTemplate'
import { renderSalarySlipHtml } from '../pdf/salarySlipTemplate'

const num = (v) => Number(v) || 0
const PAYMENT_DUE_DAYS = 30

// ─── Invoices ───
function paymentStatus(inv) {
  const total = num(inv.total)
  const settled = D.invoicePaid(inv.id)
  const remaining = D.r2(total - settled)
  let status = 'unpaid'
  if (settled >= total - 0.01 && total > 0) status = 'paid'
  else if (settled > 0) status = 'partial'
  const due = addDays(new Date(inv.invoice_date + 'T00:00:00'), PAYMENT_DUE_DAYS)
  const overdue = status !== 'paid' && NOW > due
  return {
    settled_amount: settled,
    remaining_amount: Math.max(remaining, 0),
    payment_status: status,
    due_date: iso(due),
    is_overdue: overdue,
    days_overdue: overdue ? Math.floor((NOW - due) / 86400000) : 0,
  }
}

function invoiceOut(inv) {
  const project = db.projects.find((p) => p.id === inv.project_id)
  const items = db.invoice_items.filter((i) => i.invoice_id === inv.id)
  return {
    ...inv,
    subtotal: num(inv.subtotal),
    cgst: num(inv.cgst),
    sgst: num(inv.sgst),
    igst: num(inv.igst),
    total: num(inv.total),
    items,
    project: project ? { id: project.id, name: project.name } : null,
    ...paymentStatus(inv),
  }
}

// Recompute an invoice's tax from its items (per-bracket, like the backend).
function computeInvoiceTotals(inv, items) {
  const byRate = new Map()
  items.forEach((it) => {
    const rate = num(it.tax_rate) || 18
    byRate.set(rate, D.r2((byRate.get(rate) || 0) + num(it.amount)))
  })
  const isIgst = inv.tax_type === 'IGST'
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0
  const breakdown = []
  byRate.forEach((taxable, rate) => {
    subtotal += taxable
    const tax = D.r2(taxable * (rate / 100))
    if (isIgst) {
      igst += tax
      breakdown.push({ rate, taxable_value: taxable, cgst: 0, sgst: 0, igst: tax })
    } else {
      const c = D.r2(tax / 2)
      const sg = D.r2(tax - c)
      cgst += c; sgst += sg
      breakdown.push({ rate, taxable_value: taxable, cgst: c, sgst: sg, igst: 0 })
    }
  })
  inv.subtotal = D.r2(subtotal)
  inv.cgst = D.r2(cgst)
  inv.sgst = D.r2(sgst)
  inv.igst = D.r2(igst)
  inv.total = D.r2(subtotal + cgst + sgst + igst)
  inv.tax_breakdown = breakdown.sort((a, b) => a.rate - b.rate)
}

route('GET', '/invoices', () => db.invoices.slice().sort((a, b) => b.id - a.id).map(invoiceOut))

route('GET', '/invoices/:id', ({ params }) => {
  const inv = db.invoices.find((x) => x.id === Number(params.id))
  if (!inv) throw httpError(404, 'Invoice not found')
  return invoiceOut(inv)
})

function writeInvoice(inv, body) {
  const { items, ...rest } = body || {}
  Object.assign(inv, rest)
  if (items) {
    for (let i = db.invoice_items.length - 1; i >= 0; i--) {
      if (db.invoice_items[i].invoice_id === inv.id) db.invoice_items.splice(i, 1)
    }
    items.forEach((it) => {
      db.invoice_items.push({
        id: nextId('invoice_items'),
        invoice_id: inv.id,
        description: it.description,
        hsn_sac: it.hsn_sac || null,
        amount: num(it.amount),
        tax_rate: it.tax_rate != null ? num(it.tax_rate) : 18,
      })
    })
  }
  computeInvoiceTotals(inv, db.invoice_items.filter((i) => i.invoice_id === inv.id))
  if (inv.project_id) D.recomputeProject(inv.project_id)
}

route('POST', '/invoices', ({ body }) => {
  const inv = {
    id: nextId('invoices'),
    invoice_type: body.invoice_type || 'tax',
    invoice_number: null,
    invoice_date: body.invoice_date || iso(NOW),
    tax_type: body.tax_type || 'CGST_SGST',
    created_by: currentUserId(),
    subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0, tax_breakdown: [],
  }
  db.invoices.push(inv)
  writeInvoice(inv, body)
  if (inv.invoice_type === 'tax' && !inv.invoice_number) {
    inv.invoice_number = `INV-${String(inv.id).padStart(4, '0')}`
  }
  logAudit('create', 'invoice', inv.id, `Created invoice ${inv.invoice_number || inv.id}`)
  return invoiceOut(inv)
})

route('PUT', '/invoices/:id', ({ params, body }) => {
  const inv = db.invoices.find((x) => x.id === Number(params.id))
  if (!inv) throw httpError(404, 'Invoice not found')
  writeInvoice(inv, body)
  logAudit('update', 'invoice', inv.id, `Updated invoice ${inv.invoice_number || inv.id}`)
  return invoiceOut(inv)
})

route('DELETE', '/invoices/:id', ({ params }) => {
  const id = Number(params.id)
  const inv = db.invoices.find((x) => x.id === id)
  const pid = inv ? inv.project_id : null
  const i = db.invoices.findIndex((x) => x.id === id)
  if (i >= 0) db.invoices.splice(i, 1)
  ;['invoice_items', 'invoice_payments'].forEach((k) => {
    for (let j = db[k].length - 1; j >= 0; j--) {
      if (db[k][j].invoice_id === id) db[k].splice(j, 1)
    }
  })
  if (pid) D.recomputeProject(pid)
  return null
})

// Invoice payments — settled is grossed up from received when TDS was cut.
route('GET', '/invoices/:id/payments', ({ params }) =>
  db.invoice_payments.filter((p) => p.invoice_id === Number(params.id))
)

route('POST', '/invoices/:id/payments', ({ params, body }) => {
  const invId = Number(params.id)
  const received = num(body.received_amount)
  const tdsPercent = num(body.tds_percent)
  const settled = tdsPercent > 0 ? D.r2(received / (1 - tdsPercent / 100)) : received
  const p = {
    id: nextId('invoice_payments'),
    invoice_id: invId,
    received_amount: received,
    tds_percent: tdsPercent,
    tds_amount: D.r2(settled - received),
    settled_amount: settled,
    payment_date: body.payment_date || iso(NOW),
    note: body.note || null,
    created_by: currentUserId(),
    created_at: new Date().toISOString(),
  }
  db.invoice_payments.push(p)
  logAudit('create', 'invoice_payment', p.id, `Recorded a payment`)
  return p
})

route('DELETE', '/invoices/payments/:id', ({ params }) => {
  const i = db.invoice_payments.findIndex((p) => p.id === Number(params.id))
  if (i >= 0) db.invoice_payments.splice(i, 1)
  return null
})

// Preview HTML — the detail view srcdocs this into an iframe.
route('GET', '/invoices/:id/preview-html', ({ params }) => {
  const inv = db.invoices.find((x) => x.id === Number(params.id))
  if (!inv) throw httpError(404, 'Invoice not found')
  return buildInvoiceHtml(inv)
})

export function buildInvoiceHtml(inv) {
  const items = db.invoice_items.filter((i) => i.invoice_id === inv.id)
  const bank = db.bank_accounts.find((b) => b.id === inv.bank_account_id) || db.bank_accounts[0]
  return renderInvoiceHtml(inv, items, bank, db.settings)
}

export function buildSalarySlipHtml(slip) {
  const emp = findUser(slip.employee_id)
  return renderSalarySlipHtml(slip, emp || {}, db.settings)
}

// The PDF routes return the HTML document; the views print it in an isolated
// iframe (see demo/pdf/print.js) rather than downloading server-rendered bytes.
route('GET', '/invoices/:id/pdf', ({ params }) => {
  const inv = db.invoices.find((x) => x.id === Number(params.id))
  if (!inv) throw httpError(404, 'Invoice not found')
  return { __html: buildInvoiceHtml(inv) }
})

route('GET', '/invoices/export/monthly', ({ query }) => {
  const month = query.month
  const invs = db.invoices.filter((i) => String(i.invoice_date).slice(0, 7) === month)
  return { __htmlDocs: invs.map(buildInvoiceHtml) }
})

route('GET', '/salary-slips/:id/pdf', ({ params }) => {
  const slip = db.salary_slips.find((s) => s.id === Number(params.id))
  if (!slip) throw httpError(404, 'Salary slip not found')
  return { __html: buildSalarySlipHtml(slip) }
})

// ─── Expense parties ───
route('GET', '/expenses/parties', () => db.expense_parties.slice().sort((a, b) => b.id - a.id))
route('POST', '/expenses/parties', ({ body }) => {
  const p = {
    id: nextId('expense_parties'),
    default_gst_percent: 18,
    created_by: currentUserId(),
    created_at: new Date().toISOString(),
    ...body,
  }
  db.expense_parties.push(p)
  return p
})
route('PATCH', '/expenses/parties/:id', ({ params, body }) => {
  const p = db.expense_parties.find((x) => x.id === Number(params.id))
  if (!p) throw httpError(404, 'Party not found')
  Object.assign(p, body)
  return p
})
route('DELETE', '/expenses/parties/:id', ({ params }) => {
  const i = db.expense_parties.findIndex((x) => x.id === Number(params.id))
  if (i >= 0) db.expense_parties.splice(i, 1)
  return null
})

// ─── Expenses ───
function expenseOut(e) {
  const party = db.expense_parties.find((p) => p.id === e.party_id)
  const paid = D.expensePaid(e.id)
  const total = num(e.amount)
  return {
    ...e,
    party: party ? { id: party.id, name: party.name } : null,
    party_name: party ? party.name : null,
    paid_amount: paid,
    remaining_amount: Math.max(D.r2(total - paid), 0),
    payment_status: paid >= total - 0.01 && total > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  }
}

route('GET', '/expenses', ({ query }) => {
  let rows = db.expenses.slice()
  if (query.category) rows = rows.filter((e) => e.category === query.category)
  if (query.month) rows = rows.filter((e) => String(e.date).slice(0, 7) === query.month)
  if (query.year) rows = rows.filter((e) => String(e.date).slice(0, 4) === String(query.year))
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).map(expenseOut)
})

route('POST', '/expenses', ({ body }) => {
  const baseAmt = body.base_amount != null ? num(body.base_amount) : num(body.amount)
  const gstPct = num(body.gst_percent)
  const gstAmt = D.r2(baseAmt * (gstPct / 100))
  const e = {
    id: nextId('expenses'),
    ...body,
    base_amount: baseAmt,
    gst_percent: gstPct,
    gst_amount: gstAmt,
    amount: body.amount != null && body.base_amount == null ? num(body.amount) : D.r2(baseAmt + gstAmt),
    added_by: currentUserId(),
  }
  db.expenses.push(e)
  logAudit('create', 'expense', e.id, `Recorded ${e.title}`)
  return expenseOut(e)
})

route('PATCH', '/expenses/:id', ({ params, body }) => {
  const e = db.expenses.find((x) => x.id === Number(params.id))
  if (!e) throw httpError(404, 'Expense not found')
  Object.assign(e, body)
  if (body.base_amount != null || body.gst_percent != null) {
    e.gst_amount = D.r2(num(e.base_amount) * (num(e.gst_percent) / 100))
    e.amount = D.r2(num(e.base_amount) + num(e.gst_amount))
  }
  return expenseOut(e)
})

route('DELETE', '/expenses/:id', ({ params }) => {
  const id = Number(params.id)
  const i = db.expenses.findIndex((x) => x.id === id)
  if (i >= 0) db.expenses.splice(i, 1)
  for (let j = db.expense_payments.length - 1; j >= 0; j--) {
    if (db.expense_payments[j].expense_id === id) db.expense_payments.splice(j, 1)
  }
  return null
})

route('GET', '/expenses/:id/payments', ({ params }) =>
  db.expense_payments.filter((p) => p.expense_id === Number(params.id))
)
route('POST', '/expenses/:id/payments', ({ params, body }) => {
  const p = {
    id: nextId('expense_payments'),
    expense_id: Number(params.id),
    amount: num(body.amount),
    payment_date: body.payment_date || iso(NOW),
    note: body.note || null,
    created_by: currentUserId(),
    created_at: new Date().toISOString(),
  }
  db.expense_payments.push(p)
  return p
})
route('DELETE', '/expenses/payments/:id', ({ params }) => {
  const i = db.expense_payments.findIndex((p) => p.id === Number(params.id))
  if (i >= 0) db.expense_payments.splice(i, 1)
  return null
})

// ─── Overheads ───
function overheadOut(o) {
  const empIds = db.overhead_employees.filter((x) => x.overhead_id === o.id).map((x) => x.employee_id)
  const employees = empIds.map((id) => {
    const u = findUser(id)
    return u ? { id: u.id, name: u.name, designation: u.designation } : null
  }).filter(Boolean)
  const cost = num(o.cost)
  const hourly = o.period_type === 'yearly'
    ? D.r2(cost / 2080)
    : D.r2(cost / (new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate() * 8))
  return { ...o, employees, employee_ids: empIds, hourly }
}

route('GET', '/overheads', () => db.overheads.slice().sort((a, b) => b.id - a.id).map(overheadOut))
route('POST', '/overheads', ({ body }) => {
  const id = nextId('overheads')
  const o = {
    id,
    number: `OH-${String(id).padStart(3, '0')}`,
    description: body.description,
    cost: num(body.cost),
    period_type: body.period_type || 'monthly',
    created_by: currentUserId(),
    created_at: new Date().toISOString(),
  }
  db.overheads.push(o)
  ;(body.employee_ids || []).forEach((eid) => {
    db.overhead_employees.push({ overhead_id: id, employee_id: Number(eid) })
  })
  return overheadOut(o)
})
route('PATCH', '/overheads/:id', ({ params, body }) => {
  const id = Number(params.id)
  const o = db.overheads.find((x) => x.id === id)
  if (!o) throw httpError(404, 'Overhead not found')
  const { employee_ids, ...rest } = body
  Object.assign(o, rest)
  if (employee_ids) {
    for (let j = db.overhead_employees.length - 1; j >= 0; j--) {
      if (db.overhead_employees[j].overhead_id === id) db.overhead_employees.splice(j, 1)
    }
    employee_ids.forEach((eid) => db.overhead_employees.push({ overhead_id: id, employee_id: Number(eid) }))
  }
  return overheadOut(o)
})
route('DELETE', '/overheads/:id', ({ params }) => {
  const id = Number(params.id)
  const i = db.overheads.findIndex((x) => x.id === id)
  if (i >= 0) db.overheads.splice(i, 1)
  for (let j = db.overhead_employees.length - 1; j >= 0; j--) {
    if (db.overhead_employees[j].overhead_id === id) db.overhead_employees.splice(j, 1)
  }
  return null
})

// ─── Estimates ───
const estimateOut = (e) => ({
  ...e,
  employees: db.estimate_employees.filter((x) => x.estimate_id === e.id),
})

route('GET', '/estimates', () => db.estimates.slice().sort((a, b) => b.id - a.id).map(estimateOut))
route('GET', '/estimates/:id', ({ params }) => {
  const e = db.estimates.find((x) => x.id === Number(params.id))
  if (!e) throw httpError(404, 'Estimate not found')
  return estimateOut(e)
})
route('POST', '/estimates', ({ body }) => {
  const id = nextId('estimates')
  const { employees = [], ...rest } = body
  const e = {
    id,
    status: 'draft',
    created_by: currentUserId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...rest,
  }
  db.estimates.push(e)
  employees.forEach((emp) => {
    db.estimate_employees.push({ id: nextId('estimate_employees'), estimate_id: id, ...emp })
  })
  return estimateOut(e)
})
route('PUT', '/estimates/:id', ({ params, body }) => {
  const id = Number(params.id)
  const e = db.estimates.find((x) => x.id === id)
  if (!e) throw httpError(404, 'Estimate not found')
  const { employees, ...rest } = body
  Object.assign(e, rest, { updated_at: new Date().toISOString() })
  if (employees) {
    for (let j = db.estimate_employees.length - 1; j >= 0; j--) {
      if (db.estimate_employees[j].estimate_id === id) db.estimate_employees.splice(j, 1)
    }
    employees.forEach((emp) => {
      db.estimate_employees.push({ id: nextId('estimate_employees'), estimate_id: id, ...emp })
    })
  }
  return estimateOut(e)
})
route('PATCH', '/estimates/:id', ({ params, body }) => {
  const e = db.estimates.find((x) => x.id === Number(params.id))
  if (!e) throw httpError(404, 'Estimate not found')
  Object.assign(e, body, { updated_at: new Date().toISOString() })
  return estimateOut(e)
})
route('DELETE', '/estimates/:id', ({ params }) => {
  const id = Number(params.id)
  const i = db.estimates.findIndex((x) => x.id === id)
  if (i >= 0) db.estimates.splice(i, 1)
  for (let j = db.estimate_employees.length - 1; j >= 0; j--) {
    if (db.estimate_employees[j].estimate_id === id) db.estimate_employees.splice(j, 1)
  }
  return null
})

// ─── Drafts (per-user, account-synced autosave) ───
route('GET', '/drafts/:namespace', ({ params }) => {
  const uid = currentUserId()
  return db.drafts
    .filter((d) => d.user_id === uid && d.namespace === params.namespace)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
})
route('GET', '/drafts/:namespace/:key', ({ params }) => {
  const uid = currentUserId()
  const d = db.drafts.find(
    (x) => x.user_id === uid && x.namespace === params.namespace && x.draft_key === params.key
  )
  if (!d) throw httpError(404, 'Draft not found')
  return d
})
route('PUT', '/drafts/:namespace/:key', ({ params, body }) => {
  const uid = currentUserId()
  let d = db.drafts.find(
    (x) => x.user_id === uid && x.namespace === params.namespace && x.draft_key === params.key
  )
  if (!d) {
    d = {
      id: nextId('drafts'),
      user_id: uid,
      namespace: params.namespace,
      draft_key: params.key,
      label: body.label || null,
      data: body.data ?? body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    db.drafts.push(d)
  } else {
    d.data = body.data ?? body
    if (body.label !== undefined) d.label = body.label
    d.updated_at = new Date().toISOString()
  }
  return d
})
route('POST', '/drafts/:namespace/:key', ({ params, body, query, config }) =>
  // Some callers POST instead of PUT; same upsert.
  db.drafts && (() => {
    const uid = currentUserId()
    let d = db.drafts.find(
      (x) => x.user_id === uid && x.namespace === params.namespace && x.draft_key === params.key
    )
    if (!d) {
      d = {
        id: nextId('drafts'), user_id: uid, namespace: params.namespace, draft_key: params.key,
        label: body.label || null, data: body.data ?? body,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      db.drafts.push(d)
    } else {
      d.data = body.data ?? body
      d.updated_at = new Date().toISOString()
    }
    return d
  })()
)
route('DELETE', '/drafts/:namespace/:key', ({ params }) => {
  const uid = currentUserId()
  const i = db.drafts.findIndex(
    (x) => x.user_id === uid && x.namespace === params.namespace && x.draft_key === params.key
  )
  if (i >= 0) db.drafts.splice(i, 1)
  return null
})

// ─── Reports (quarterly task/subtask delivery) ───
function quarterOf(dateStr) {
  const d = new Date(dateStr)
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 }
}

route('GET', '/reports/quarterly/available', () => {
  const set = new Set()
  db.stage_subtasks.forEach((s) => {
    if (s.due_date) {
      const q = quarterOf(s.due_date)
      set.add(`${q.year}-Q${q.quarter}`)
    }
  })
  return [...set].sort().reverse().map((k) => {
    const [year, q] = k.split('-Q')
    return { year: Number(year), quarter: Number(q), label: `Q${q} ${year}` }
  })
})

route('GET', '/reports/quarterly', ({ query }) => {
  const year = Number(query.year) || NOW.getFullYear()
  const quarter = Number(query.quarter) || Math.floor(NOW.getMonth() / 3) + 1
  const inQ = (dateStr) => {
    if (!dateStr) return false
    const q = quarterOf(dateStr)
    return q.year === year && q.quarter === quarter
  }

  const subs = db.stage_subtasks.filter((s) => inQ(s.due_date))
  const tasks = db.tasks.filter((t) => inQ(t.end_date || t.date))

  const classify = (items, dueKey) => {
    let onTime = 0, late = 0, pending = 0, neverStarted = 0, unknown = 0
    items.forEach((it) => {
      if (it.status === 'completed') {
        if (!it.completed_at) unknown++
        else if (String(it.completed_at).slice(0, 10) <= String(it[dueKey]).slice(0, 10)) onTime++
        else late++
      } else if (!it.started_at) {
        neverStarted++
      } else {
        pending++
      }
    })
    return { total: items.length, on_time: onTime, late, in_progress: pending, never_started: neverStarted, unknown }
  }

  const byProject = db.projects.map((p) => {
    const ps = subs.filter((s) => s.project_id === p.id)
    return {
      project_id: p.id,
      project_name: p.name,
      project_number: p.project_number,
      ...classify(ps, 'due_date'),
    }
  }).filter((r) => r.total > 0)

  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    subtasks: classify(subs, 'due_date'),
    tasks: classify(tasks, 'end_date'),
    by_project: byProject,
  }
})

// ─── Exports (CSV built client-side; the backend used csv.writer) ───
function toCsv(headers, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
}

const EXPORTERS = {
  users: () => ({
    headers: ['id', 'name', 'designation', 'studio_email', 'role', 'joining_date', 'salary_month'],
    rows: db.users.map((u) => [u.id, u.name, u.designation, u.studio_email, u.role, u.joining_date, u.salary_month]),
  }),
  projects: () => ({
    headers: ['id', 'project_number', 'name', 'client', 'start_date', 'end_date', 'value', 'billed'],
    rows: db.projects.map((p) => {
      const c = db.clients.find((x) => x.id === p.client_id)
      return [p.id, p.project_number, p.name, c ? c.name : '', p.start_date, p.end_date, p.project_remuneration, p.billed_amount]
    }),
  }),
  clients: () => ({
    headers: ['id', 'name', 'email', 'phone', 'gstin', 'customer_type'],
    rows: db.clients.map((c) => [c.id, c.name, c.email, c.phone, c.gstin, c.customer_type]),
  }),
  invoices: () => ({
    headers: ['id', 'invoice_number', 'invoice_date', 'bill_to_name', 'subtotal', 'total', 'settled'],
    rows: db.invoices.map((i) => [i.id, i.invoice_number, i.invoice_date, i.bill_to_name, i.subtotal, i.total, D.invoicePaid(i.id)]),
  }),
  expenses: () => ({
    headers: ['id', 'title', 'category', 'date', 'base_amount', 'gst_amount', 'amount'],
    rows: db.expenses.map((e) => [e.id, e.title, e.category, e.date, e.base_amount, e.gst_amount, e.amount]),
  }),
  timesheets: () => ({
    headers: ['id', 'employee', 'week_start', 'week_end', 'total_hours', 'status'],
    rows: db.weekly_timesheets.map((t) => {
      const u = findUser(t.employee_id)
      return [t.id, u ? u.name : '', t.week_start, t.week_end, t.total_hours, t.status]
    }),
  }),
  leaves: () => ({
    headers: ['id', 'employee', 'start_date', 'end_date', 'days', 'status'],
    rows: db.leaves.map((l) => {
      const u = findUser(l.employee_id)
      return [l.id, u ? u.name : '', l.start_date, l.end_date, l.days_count, l.status]
    }),
  }),
  reimbursements: () => ({
    headers: ['id', 'employee', 'amount', 'reason', 'date', 'status', 'month_added'],
    rows: db.reimbursements.map((r) => {
      const u = findUser(r.employee_id)
      return [r.id, u ? u.name : '', r.amount, r.reason, r.date, r.status, r.month_added]
    }),
  }),
  salary_slips: () => ({
    headers: ['id', 'employee', 'month', 'base_salary', 'tds_amount', 'reimbursements', 'net_total', 'status'],
    rows: db.salary_slips.map((s) => {
      const u = findUser(s.employee_id)
      return [s.id, u ? u.name : '', s.month, s.base_salary, s.tds_amount, s.reimbursement_total, s.net_total, s.status]
    }),
  }),
}

route('GET', '/exports/:entity.csv', ({ params }) => {
  const entity = String(params['entity.csv'] || '').replace(/\.csv$/, '')
  return csvResponse(entity)
})

function csvResponse(entity) {
  const fn = EXPORTERS[entity]
  if (!fn) throw httpError(404, `No exporter for ${entity}`)
  const { headers, rows } = fn()
  const csv = toCsv(headers, rows)
  return {
    __raw: {
      data: new Blob([csv], { type: 'text/csv' }),
      headers: { 'content-disposition': `attachment; filename="${entity}.csv"` },
    },
  }
}

route('GET', '/exports/bundle', ({ query }) => {
  // No zip lib in the demo: concatenate the selected entities into one CSV with
  // section headers. Same download UX, no dependency.
  const types = String(query.types || '').split(',').filter(Boolean)
  const parts = []
  types.forEach((t) => {
    const fn = EXPORTERS[t]
    if (!fn) return
    const { headers, rows } = fn()
    parts.push(`# ${t}`, toCsv(headers, rows), '')
  })
  return {
    __raw: {
      data: new Blob([parts.join('\n')], { type: 'text/csv' }),
      headers: { 'content-disposition': 'attachment; filename="export-bundle.csv"' },
    },
  }
})

route('GET', '/exports/salary-months', () =>
  [...new Set(db.salary_slips.map((s) => s.month))].sort().reverse()
)

route('GET', '/exports/ca-salary-sheet.csv', ({ query }) => {
  const month = query.month
  const slips = db.salary_slips.filter((s) => s.month === month)
  const headers = ['Employee', 'PAN', 'Month', 'Base Salary', 'TDS %', 'TDS Amount', 'Reimbursements', 'Leave Deduction', 'Net Pay']
  const rows = slips.map((s) => {
    const u = findUser(s.employee_id)
    return [u ? u.name : '', u ? u.pan_number : '', s.month, s.base_salary, s.tds_percent,
      s.tds_amount, s.reimbursement_total, s.leave_deduction, s.net_total]
  })
  return {
    __raw: {
      data: new Blob([toCsv(headers, rows)], { type: 'text/csv' }),
      headers: { 'content-disposition': `attachment; filename="ca-salary-sheet-${month}.csv"` },
    },
  }
})
