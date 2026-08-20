// Handlers: weekly timesheets, legacy timesheets, leaves, overtime credits,
// reimbursements, salary history, salary slips.
import { route, httpError } from '../mockClient'
import { db, nextId } from '../db'
import * as D from '../derive'
import { NOW, iso, addDays, addMonths, mondayOf, monthKey } from '../dates'
import { currentUserId, findUser, logAudit } from './core'

const num = (v) => Number(v) || 0

// ─── Weekly timesheets ───
function tsOut(ts) {
  const emp = findUser(ts.employee_id)
  const entries = db.ts_entries.filter((e) => e.timesheet_id === ts.id).map((e) => {
    const stage = db.stages.find((s) => s.id === e.stage_id)
    const sub = db.stage_subtasks.find((s) => s.id === e.subtask_id)
    const p = db.projects.find((x) => x.id === e.project_id)
    return {
      ...e,
      stage_name: stage ? stage.name : null,
      subtask_title: sub ? sub.title : null,
      project_name: p ? p.name : null,
    }
  })
  return {
    ...ts,
    entries,
    employee_name: emp ? emp.name : null,
    employee: emp ? { id: emp.id, name: emp.name, role: emp.role, designation: emp.designation } : null,
  }
}

route('GET', '/weekly-timesheets', ({ query }) => {
  let rows = db.weekly_timesheets.slice()
  const me = findUser(currentUserId())
  // PMs must not see admin-submitted timesheets (matches the backend).
  if (me && me.role === 'project_manager') {
    const adminIds = new Set(db.users.filter((u) => u.role === 'admin').map((u) => u.id))
    rows = rows.filter((t) => !adminIds.has(t.employee_id))
  }
  if (query.employee_id) rows = rows.filter((t) => t.employee_id === Number(query.employee_id))
  if (query.status) rows = rows.filter((t) => t.status === query.status)
  return rows.map(tsOut)
})

route('GET', '/weekly-timesheets/my', () => {
  const uid = currentUserId()
  return db.weekly_timesheets
    .filter((t) => t.employee_id === uid)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map(tsOut)
})

route('GET', '/weekly-timesheets/pending-weeks', () => {
  const uid = currentUserId()
  const me = findUser(uid)
  const monthStart = new Date(NOW.getFullYear(), NOW.getMonth(), 1)
  const firstMonday = mondayOf(monthStart)
  const currentMonday = mondayOf(NOW)
  const weeks = []
  let ws = new Date(firstMonday)
  while (ws <= currentMonday) {
    const we = addDays(ws, 6)
    if (!me || !me.joining_date || iso(we) >= me.joining_date) {
      const existing = db.weekly_timesheets.find(
        (t) => t.employee_id === uid && t.week_start === iso(ws)
      )
      weeks.push(existing
        ? { week_start: iso(ws), week_end: iso(we), status: existing.status, timesheet_id: existing.id }
        : { week_start: iso(ws), week_end: iso(we), status: 'pending' })
    }
    ws = addDays(ws, 7)
  }
  return weeks
})

route('GET', '/weekly-timesheets/:id', ({ params }) => {
  const ts = db.weekly_timesheets.find((t) => t.id === Number(params.id))
  if (!ts) throw httpError(404, 'Timesheet not found')
  return tsOut(ts)
})

route('POST', '/weekly-timesheets', ({ body }) => {
  const uid = currentUserId()
  const tsId = nextId('weekly_timesheets')
  const entries = body.entries || []
  const total = entries.reduce((s, e) => s + num(e.hours), 0)
  const ts = {
    id: tsId,
    employee_id: uid,
    week_start: body.week_start,
    week_end: body.week_end,
    total_hours: D.r2(total),
    description: body.description || null,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    pm_approved_by: null, pm_approved_at: null,
    admin_approved_by: null, admin_approved_at: null,
    admin2_approved_by: null, admin2_approved_at: null,
    rejected_by: null, rejected_at: null, rejection_reason: null,
  }
  db.weekly_timesheets.push(ts)
  entries.forEach((e) => {
    db.ts_entries.push({
      id: nextId('ts_entries'),
      timesheet_id: tsId,
      project_id: e.project_id ?? null,
      stage_id: e.stage_id ?? null,
      subtask_id: e.subtask_id ?? null,
      hours: num(e.hours),
      description: e.description || null,
      daily_hours: e.daily_hours || null,
      employee_cost: null,
      cost_breakdown: null,
    })
  })
  logAudit('create', 'timesheet', tsId, `Submitted timesheet for ${body.week_start}`)
  return tsOut(ts)
})

route('PATCH', '/weekly-timesheets/:id', ({ params, body }) => {
  const ts = db.weekly_timesheets.find((t) => t.id === Number(params.id))
  if (!ts) throw httpError(404, 'Timesheet not found')
  if (body.entries) {
    for (let i = db.ts_entries.length - 1; i >= 0; i--) {
      if (db.ts_entries[i].timesheet_id === ts.id) db.ts_entries.splice(i, 1)
    }
    body.entries.forEach((e) => {
      db.ts_entries.push({
        id: nextId('ts_entries'),
        timesheet_id: ts.id,
        project_id: e.project_id ?? null,
        stage_id: e.stage_id ?? null,
        subtask_id: e.subtask_id ?? null,
        hours: num(e.hours),
        description: e.description || null,
        daily_hours: e.daily_hours || null,
        employee_cost: null,
        cost_breakdown: null,
      })
    })
    ts.total_hours = D.r2(body.entries.reduce((s, e) => s + num(e.hours), 0))
  }
  if (body.week_start) ts.week_start = body.week_start
  if (body.week_end) ts.week_end = body.week_end
  if (body.description !== undefined) ts.description = body.description
  // A resubmit clears a prior rejection.
  ts.rejected_at = null; ts.rejected_by = null; ts.rejection_reason = null
  ts.status = 'submitted'
  ts.submitted_at = new Date().toISOString()
  return tsOut(ts)
})

// Approval: fills the actor's slot, then freezes cost + grants comp-off once
// fully approved. This is the interaction that moves project reserve live.
route('PATCH', '/weekly-timesheets/:id/approve', ({ params }) => {
  const ts = db.weekly_timesheets.find((t) => t.id === Number(params.id))
  if (!ts) throw httpError(404, 'Timesheet not found')
  if (ts.status === 'rejected') throw httpError(400, 'This timesheet was rejected; the employee must resubmit.')

  const me = findUser(currentUserId())
  if (!me || me.role !== 'admin') throw httpError(403, 'Only admins approve timesheets')
  const submitter = findUser(ts.employee_id)
  const submitterIsAdmin = !!(submitter && submitter.role === 'admin')
  const now = new Date().toISOString()

  if (submitterIsAdmin) {
    if (ts.admin_approved_at) throw httpError(400, 'Already approved by an admin')
    ts.admin_approved_by = me.id
    ts.admin_approved_at = now
  } else if (!ts.admin_approved_at) {
    ts.admin_approved_by = me.id
    ts.admin_approved_at = now
  } else if (!ts.admin2_approved_at) {
    if (ts.admin_approved_by === me.id) {
      throw httpError(400, 'You gave the first admin approval - a different admin must give the second.')
    }
    ts.admin2_approved_by = me.id
    ts.admin2_approved_at = now
  } else {
    throw httpError(400, 'Already fully approved')
  }

  const before = ts.status
  D.recomputeStatus(ts, submitterIsAdmin)
  if (ts.status === 'approved' && before !== 'approved') {
    D.freezeEntries(ts)
    D.grantOvertimeCredits(ts)
    D.recomputeAllProjects()
  }
  logAudit('approve', 'timesheet', ts.id, `Approved timesheet for ${ts.week_start}`)
  return tsOut(ts)
})

route('PATCH', '/weekly-timesheets/:id/reject', ({ params, body }) => {
  const ts = db.weekly_timesheets.find((t) => t.id === Number(params.id))
  if (!ts) throw httpError(404, 'Timesheet not found')
  const me = findUser(currentUserId())
  ts.rejected_by = me ? me.id : null
  ts.rejected_at = new Date().toISOString()
  ts.rejection_reason = (body && body.rejection_reason) || null
  ts.status = 'rejected'
  // Reversing an approval must also reverse its side effects.
  D.unfreezeEntries(ts)
  D.revokeOvertimeCredits(ts)
  D.recomputeAllProjects()
  logAudit('reject', 'timesheet', ts.id, `Rejected timesheet for ${ts.week_start}`)
  return tsOut(ts)
})

// Legacy daily timesheets endpoint — the app keeps a thin version of it.
route('GET', '/timesheets', () => db.weekly_timesheets.map(tsOut))
route('GET', '/timesheets/my', () => {
  const uid = currentUserId()
  return db.weekly_timesheets.filter((t) => t.employee_id === uid).map(tsOut)
})

// ─── Leaves ───
function leaveOut(l) {
  const emp = findUser(l.employee_id)
  return {
    ...l,
    employee_name: emp ? emp.name : null,
    employee: emp ? { id: emp.id, name: emp.name, designation: emp.designation, role: emp.role } : null,
  }
}

// Working days between two dates (Mon-Fri, excluding company holidays).
function workingDays(startStr, endStr) {
  const out = []
  const holidays = new Set(db.holidays.map((h) => h.date))
  let d = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr + 'T00:00:00')
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !holidays.has(iso(d))) out.push(iso(d))
    d = addDays(d, 1)
  }
  return out
}

route('GET', '/leaves', () => db.leaves.map(leaveOut))
route('GET', '/leaves/my', () => {
  const uid = currentUserId()
  return db.leaves.filter((l) => l.employee_id === uid).map(leaveOut)
})

route('POST', '/leaves', ({ body }) => {
  const uid = currentUserId()
  const wd = workingDays(body.start_date, body.end_date).length
  const l = {
    id: nextId('leaves'),
    employee_id: uid,
    start_date: body.start_date,
    end_date: body.end_date,
    reason: body.reason || null,
    status: 'pending',
    days_count: wd,
    paid_days: 0,
    unpaid_days: 0,
    overtime_consumed: null,
  }
  db.leaves.push(l)
  logAudit('create', 'leave', l.id, `Applied for leave ${body.start_date}`)
  return leaveOut(l)
})

route('PATCH', '/leaves/:id/action', ({ params, body }) => {
  const l = db.leaves.find((x) => x.id === Number(params.id))
  if (!l) throw httpError(404, 'Leave not found')
  const action = body.action || body.status
  if (action === 'approve' || action === 'approved') {
    l.status = 'approved'
    // Pay the days from comp-off credits first (oldest first), then the paid
    // balance, then unpaid — the backend's order.
    let remaining = l.days_count
    const consumed = []
    const credits = db.overtime_leaves
      .filter((o) => o.employee_id === l.employee_id && num(o.amount) - num(o.consumed) > 0)
      .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))
    credits.forEach((c) => {
      if (remaining <= 0) return
      const avail = num(c.amount) - num(c.consumed)
      const take = Math.min(avail, remaining)
      c.consumed = num(c.consumed) + take
      remaining -= take
      consumed.push({ id: c.id, amt: take })
    })
    const user = findUser(l.employee_id)
    let paid = l.days_count - remaining
    if (remaining > 0 && user) {
      const bal = num(user.paid_leave_balance)
      const take = Math.min(bal, remaining)
      user.paid_leave_balance = D.r2(bal - take)
      paid += take
      remaining -= take
    }
    l.paid_days = paid
    l.unpaid_days = remaining
    l.overtime_consumed = consumed.length ? consumed : null
    logAudit('approve', 'leave', l.id, 'Approved a leave request')
  } else {
    l.status = 'rejected'
    logAudit('reject', 'leave', l.id, 'Rejected a leave request')
  }
  return leaveOut(l)
})

route('POST', '/leaves/mark-absent', ({ body }) => {
  const l = {
    id: nextId('leaves'),
    employee_id: Number(body.employee_id),
    start_date: body.date || body.start_date,
    end_date: body.date || body.end_date,
    reason: body.reason || 'Marked absent',
    status: 'approved',
    days_count: 1,
    paid_days: 0,
    unpaid_days: 1,
    overtime_consumed: null,
  }
  db.leaves.push(l)
  return leaveOut(l)
})

const creditOut = (c) => ({
  id: c.id,
  work_date: c.work_date,
  hours: num(c.hours),
  amount: num(c.amount),
  remaining: D.r2(num(c.amount) - num(c.consumed)),
  expires_on: c.expires_on,
})

route('GET', '/leaves/overtime/my', () => {
  const uid = currentUserId()
  const creds = db.overtime_leaves.filter((o) => o.employee_id === uid && num(o.amount) - num(o.consumed) > 0)
  return { available: D.overtimeBalance(uid), credits: creds.map(creditOut) }
})

route('GET', '/leaves/overtime', ({ query }) => {
  const eid = Number(query.employee_id)
  const creds = db.overtime_leaves.filter((o) => o.employee_id === eid && num(o.amount) - num(o.consumed) > 0)
  return { available: D.overtimeBalance(eid), credits: creds.map(creditOut) }
})

// ─── Reimbursements ───
function reimbOut(r) {
  const emp = findUser(r.employee_id)
  return {
    ...r,
    employee_name: emp ? emp.name : null,
    employee: emp ? { id: emp.id, name: emp.name } : null,
  }
}

route('GET', '/reimbursements', () =>
  db.reimbursements.slice().sort((a, b) => b.id - a.id).map(reimbOut)
)
route('GET', '/reimbursements/my', () => {
  const uid = currentUserId()
  return db.reimbursements.filter((r) => r.employee_id === uid).sort((a, b) => b.id - a.id).map(reimbOut)
})
route('POST', '/reimbursements', ({ body }) => {
  const uid = currentUserId()
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const get = (k) => (isForm ? body.get(k) : body[k])
  const file = isForm ? body.get('proof') || body.get('file') : null
  const r = {
    id: nextId('reimbursements'),
    employee_id: uid,
    amount: num(get('amount')),
    reason: get('reason') || '',
    date: get('date'),
    proof_url: file ? URL.createObjectURL(file) : null,
    status: 'pending',
    month_added: null,
    created_at: new Date().toISOString(),
  }
  db.reimbursements.push(r)
  logAudit('create', 'reimbursement', r.id, `Claimed ${r.amount}`)
  return reimbOut(r)
})
route('PATCH', '/reimbursements/:id/action', ({ params, body }) => {
  const r = db.reimbursements.find((x) => x.id === Number(params.id))
  if (!r) throw httpError(404, 'Reimbursement not found')
  const action = body.action || body.status
  if (action === 'approve' || action === 'approved') {
    r.status = 'approved'
    // Slip month is derived from the EXPENSE date, not approval date.
    r.month_added = String(r.date).slice(0, 7)
    D.recomputeSlipsFor(r.employee_id)
    logAudit('approve', 'reimbursement', r.id, 'Approved a reimbursement')
  } else {
    r.status = 'rejected'
    r.month_added = null
    D.recomputeSlipsFor(r.employee_id)
    logAudit('reject', 'reimbursement', r.id, 'Rejected a reimbursement')
  }
  return reimbOut(r)
})

// ─── Salary (effective-dated history) ───
route('GET', '/salary/employees', () =>
  db.users.filter((u) => u.is_active).map((u) => {
    const cur = D.rateOn(u.id, iso(NOW))
    const periods = db.salary_history.filter((h) => h.user_id === u.id)
    return {
      id: u.id,
      employee_id: u.id,
      name: u.name,
      designation: u.designation,
      role: u.role,
      monthly_salary: num(u.salary_month),
      hourly_rate: cur.rate,
      period_count: periods.length,
      joining_date: u.joining_date,
    }
  })
)

route('GET', '/salary/:id/history', ({ params }) => {
  const uid = Number(params.id)
  const u = findUser(uid)
  const rows = db.salary_history
    .filter((h) => h.user_id === uid)
    .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)))
  return {
    user_id: uid,
    name: u ? u.name : null,
    periods: rows.map((h) => ({ ...h, monthly_salary: num(h.monthly_salary), hourly_rate: num(h.hourly_rate) })),
  }
})

route('POST', '/salary/:id/increment', ({ params, body }) => {
  const uid = Number(params.id)
  const u = findUser(uid)
  if (!u) throw httpError(404, 'User not found')
  const s = db.settings
  const monthly = num(body.monthly_salary)
  const smpy = body.smpy != null ? num(body.smpy) : s.salary_months_per_year
  const whpm = body.whpm != null ? num(body.whpm) : s.working_hours_per_month
  const hourly = body.salary_hour != null && num(body.salary_hour) > 0
    ? num(body.salary_hour)
    : D.r2((monthly * smpy) / 12 / whpm)
  const from = body.effective_from || iso(NOW)
  // Close the previous open period.
  const prev = db.salary_history
    .filter((h) => h.user_id === uid)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
  if (prev) prev.effective_to = iso(addDays(new Date(from + 'T00:00:00'), -1))
  const row = {
    id: nextId('salary_history'),
    user_id: uid,
    monthly_salary: monthly,
    salary_hour: body.salary_hour != null ? num(body.salary_hour) : null,
    smpy, whpm,
    hourly_rate: hourly,
    effective_from: from,
    effective_to: null,
    note: body.note || 'Increment',
  }
  db.salary_history.push(row)
  u.salary_month = monthly
  u.hourly_rate = hourly
  logAudit('update', 'salary', uid, `Salary revised for ${u.name}`)
  return row
})

route('DELETE', '/salary/period/:id', ({ params }) => {
  const i = db.salary_history.findIndex((h) => h.id === Number(params.id))
  if (i >= 0) db.salary_history.splice(i, 1)
  return null
})

// ─── Salary slips ───
function slipOut(s) {
  const emp = findUser(s.employee_id)
  return {
    ...s,
    employee_name: emp ? emp.name : null,
    designation: emp ? emp.designation : null,
    employee: emp ? { id: emp.id, name: emp.name, designation: emp.designation } : null,
  }
}

route('GET', '/salary-slips', ({ query }) => {
  let rows = db.salary_slips.slice()
  if (query.month) rows = rows.filter((s) => s.month === query.month)
  if (query.employee_id) rows = rows.filter((s) => s.employee_id === Number(query.employee_id))
  return rows.sort((a, b) => (a.month < b.month ? 1 : a.employee_id - b.employee_id)).map(slipOut)
})

route('GET', '/salary-slips/my', () => {
  const uid = currentUserId()
  return db.salary_slips
    .filter((s) => s.employee_id === uid)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map(slipOut)
})

route('GET', '/salary-slips/:id', ({ params }) => {
  const s = db.salary_slips.find((x) => x.id === Number(params.id))
  if (!s) throw httpError(404, 'Salary slip not found')
  return slipOut(s)
})

route('POST', '/salary-slips/generate', ({ body, query }) => {
  const month = body.month || query.month || monthKey(addMonths(NOW, -1))
  const created = []
  db.users.filter((u) => u.is_active).forEach((u) => {
    if (db.salary_slips.some((s) => s.employee_id === u.id && s.month === month)) return
    const base = num(u.salary_month)
    const tdsPercent = num(db.settings.tds_percent)
    const [y, m] = month.split('-').map(Number)
    const payout = new Date(y, m, 7)
    const slip = {
      id: nextId('salary_slips'),
      employee_id: u.id,
      month,
      base_salary: base,
      tds_percent: tdsPercent,
      tds_amount: D.r2(base * (tdsPercent / 100)),
      reimbursement_total: 0,
      paid_leave_days: 0,
      unpaid_leave_days: 0,
      leave_deduction: 0,
      net_total: 0,
      payout_date: iso(payout),
      status: 'pending',
      created_at: new Date().toISOString(),
      approved_at: null,
    }
    D.recomputeSlip(slip)
    db.salary_slips.push(slip)
    created.push(slipOut(slip))
  })
  logAudit('create', 'salary_slip', null, `Generated slips for ${month}`)
  return { month, created: created.length, slips: created }
})

route('PATCH', '/salary-slips/:id', ({ params, body }) => {
  const s = db.salary_slips.find((x) => x.id === Number(params.id))
  if (!s) throw httpError(404, 'Salary slip not found')
  Object.assign(s, body)
  D.recomputeSlip(s)
  return slipOut(s)
})

route('PATCH', '/salary-slips/:id/approve', ({ params }) => {
  const s = db.salary_slips.find((x) => x.id === Number(params.id))
  if (!s) throw httpError(404, 'Salary slip not found')
  s.status = 'approved'
  s.approved_at = new Date().toISOString()
  logAudit('approve', 'salary_slip', s.id, 'Approved a salary slip')
  return slipOut(s)
})

route('POST', '/salary-slips/approve-bulk', ({ body }) => {
  const ids = new Set((body.ids || body.slip_ids || []).map(Number))
  let n = 0
  db.salary_slips.forEach((s) => {
    if (ids.has(s.id) && s.status !== 'approved') {
      s.status = 'approved'
      s.approved_at = new Date().toISOString()
      n++
    }
  })
  return { approved: n }
})

route('POST', '/salary-slips/approve-month', ({ body, query }) => {
  const month = body.month || query.month
  let n = 0
  db.salary_slips.forEach((s) => {
    if (s.month === month && s.status !== 'approved') {
      s.status = 'approved'
      s.approved_at = new Date().toISOString()
      n++
    }
  })
  return { month, approved: n }
})

route('POST', '/salary-slips/bulk-set-tds', ({ body }) => {
  const pct = num(body.tds_percent)
  const month = body.month
  let n = 0
  db.salary_slips.forEach((s) => {
    if (!month || s.month === month) {
      s.tds_percent = pct
      D.recomputeSlip(s)
      n++
    }
  })
  return { updated: n }
})
