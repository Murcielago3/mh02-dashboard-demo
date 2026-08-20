// The handful of backend formulas ported to JS so *interactive* writes stay
// coherent across role switches. Everything else stays as seeded.
//
// Covered: timesheet cost freezing, comp-off credits, project reserve, invoice
// settlement, salary-slip net. These are the numbers a prospect actually
// watches move during a demo.
import { db } from './db'

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Salary: the effective-dated hourly rate for a user on a date ──
export function rateOn(userId, dateStr) {
  const rows = db.salary_history
    .filter((h) => h.user_id === userId && h.effective_from <= dateStr)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
  if (rows.length) return { rate: Number(rows[0].hourly_rate) || 0, id: rows[0].id }
  const any = db.salary_history.find((h) => h.user_id === userId)
  return { rate: any ? Number(any.hourly_rate) || 0 : 0, id: any ? any.id : null }
}

// ── Timesheet status, mirroring the backend's derived rule ──
// Admin's own sheet: one admin slot is enough. Everyone else: BOTH admin slots
// (four-eyes) and they must be different accounts.
export function recomputeStatus(ts, isAdminOwner) {
  if (ts.rejected_at) { ts.status = 'rejected'; return }
  const a1 = !!ts.admin_approved_at
  const a2 = !!ts.admin2_approved_at
  if (isAdminOwner) ts.status = a1 ? 'approved' : 'submitted'
  else if (a1 && a2) ts.status = 'approved'
  else if (a1 || a2) ts.status = 'admin_approved'
  else ts.status = 'submitted'
}

// ── Freeze employee cost on the entries of a fully-approved sheet ──
export function freezeEntries(ts) {
  const entries = db.ts_entries.filter((e) => e.timesheet_id === ts.id)
  entries.forEach((e) => {
    const { rate, id } = rateOn(ts.employee_id, ts.week_end)
    e.employee_cost = r2(Number(e.hours) * rate)
    e.cost_breakdown = [{ salary_history_id: id, hours: Number(e.hours), rate, cost: e.employee_cost }]
  })
  return entries
}

// Clear frozen cost (rejection reverses an approval).
export function unfreezeEntries(ts) {
  db.ts_entries
    .filter((e) => e.timesheet_id === ts.id)
    .forEach((e) => { e.employee_cost = null; e.cost_breakdown = null })
}

// ── Comp-off credits from overtime on an approved sheet ──
export function grantOvertimeCredits(ts) {
  const entries = db.ts_entries.filter((e) => e.timesheet_id === ts.id)
  const start = new Date(ts.week_start + 'T00:00:00')
  for (let d = 0; d < 7; d++) {
    const dayTotal = entries.reduce((s, e) => s + ((e.daily_hours && e.daily_hours[d]) || 0), 0)
    let amount = 0
    if (d === 5 && dayTotal > 0) amount = dayTotal >= 8 ? 1 : 0.5
    else if (d < 5 && dayTotal >= 14) amount = 1
    else if (d < 5 && dayTotal >= 12) amount = 0.5
    if (amount <= 0) continue
    const workDate = new Date(start)
    workDate.setDate(workDate.getDate() + d)
    const iso = workDate.toISOString().slice(0, 10)
    const exists = db.overtime_leaves.find((o) => o.timesheet_id === ts.id && o.work_date === iso)
    if (exists) continue
    db.overtime_leaves.push({
      id: Math.max(0, ...db.overtime_leaves.map((o) => o.id)) + 1,
      employee_id: ts.employee_id,
      timesheet_id: ts.id,
      work_date: iso,
      hours: dayTotal,
      amount,
      consumed: 0,
      expires_on: iso,
      created_at: new Date().toISOString(),
    })
  }
}

export function revokeOvertimeCredits(ts) {
  for (let i = db.overtime_leaves.length - 1; i >= 0; i--) {
    if (db.overtime_leaves[i].timesheet_id === ts.id) db.overtime_leaves.splice(i, 1)
  }
}

// ── Project rollups: cost and hours from FROZEN entries only ──
export function projectApprovedEntries(projectId) {
  return db.ts_entries.filter((e) => e.project_id === projectId && e.employee_cost != null)
}

export function projectEmployeeCost(projectId) {
  return r2(projectApprovedEntries(projectId).reduce((s, e) => s + Number(e.employee_cost), 0))
}

export function projectHours(projectId) {
  return r2(projectApprovedEntries(projectId).reduce((s, e) => s + Number(e.hours), 0))
}

export function projectInvoiced(projectId) {
  return r2(db.invoices.filter((i) => i.project_id === projectId)
    .reduce((s, i) => s + Number(i.subtotal || 0), 0))
}

// reserve = invoiced - employee cost - partner cost  (the backend's formula)
export function projectReserve(projectId) {
  const p = db.projects.find((x) => x.id === projectId)
  const invoiced = projectInvoiced(projectId)
  const empCost = projectEmployeeCost(projectId)
  const hours = projectHours(projectId)
  const partnerCost = r2(hours * Number(p ? p.partner_hourly_rate : 0))
  const balance = r2(invoiced - empCost - partnerCost)
  return {
    project_id: projectId,
    total_invoiced: invoiced,
    employee_cost: empCost,
    partner_cost: partnerCost,
    total_hours: hours,
    reserve_balance: balance,
    reserve_depleted: invoiced > 0 && balance < 0,
    has_reserve: invoiced > 0,
  }
}

// Refresh the denormalised fields the project screens read.
export function recomputeProject(projectId) {
  const p = db.projects.find((x) => x.id === projectId)
  if (!p) return
  p.employee_remuneration = projectEmployeeCost(projectId)
  p.partner_remuneration = r2(projectHours(projectId) * Number(p.partner_hourly_rate || 0))
  p.billed_amount = projectInvoiced(projectId)
}

export function recomputeAllProjects() {
  db.projects.forEach((p) => recomputeProject(p.id))
}

// ── Invoice settlement ──
export function invoicePaid(invoiceId) {
  return r2(db.invoice_payments.filter((p) => p.invoice_id === invoiceId)
    .reduce((s, p) => s + Number(p.settled_amount || 0), 0))
}

export function invoiceOutstanding(invoice) {
  return r2(Number(invoice.total || 0) - invoicePaid(invoice.id))
}

export function invoiceStatus(invoice) {
  const out = invoiceOutstanding(invoice)
  if (out <= 0.5) return 'paid'
  if (invoicePaid(invoice.id) > 0) return 'partial'
  return 'unpaid'
}

// ── Expense settlement (money-out mirror) ──
export function expensePaid(expenseId) {
  return r2(db.expense_payments.filter((p) => p.expense_id === expenseId)
    .reduce((s, p) => s + Number(p.amount || 0), 0))
}

// ── Salary slip net ──
export function recomputeSlip(slip) {
  const reimb = r2(db.reimbursements
    .filter((x) => x.employee_id === slip.employee_id && x.status === 'approved' && x.month_added === slip.month)
    .reduce((s, x) => s + Number(x.amount), 0))
  slip.reimbursement_total = reimb
  slip.tds_amount = r2(Number(slip.base_salary) * (Number(slip.tds_percent) / 100))
  slip.net_total = r2(
    Number(slip.base_salary) - Number(slip.tds_amount) - Number(slip.leave_deduction || 0) + reimb
  )
  return slip
}

export function recomputeSlipsFor(employeeId) {
  db.salary_slips.filter((s) => s.employee_id === employeeId).forEach(recomputeSlip)
}

// ── Comp-off balance available to an employee ──
export function overtimeBalance(employeeId) {
  return r2(db.overtime_leaves
    .filter((o) => o.employee_id === employeeId)
    .reduce((s, o) => s + (Number(o.amount) - Number(o.consumed)), 0))
}
