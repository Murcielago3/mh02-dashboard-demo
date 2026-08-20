// Handlers: projects, assignments, teams, stages, stage subtasks, tasks.
import { route, httpError } from '../mockClient'
import { db, nextId } from '../db'
import * as D from '../derive'
import { NOW, iso } from '../dates'
import { currentUserId, findUser, logAudit } from './core'

const num = (v) => Number(v) || 0

function projectOut(p) {
  const client = db.clients.find((c) => c.id === p.client_id)
  return {
    ...p,
    client_name: client ? client.name : null,
    client: client ? { id: client.id, name: client.name } : null,
  }
}

// ─── Projects ───
route('GET', '/projects', ({ query }) => {
  let rows = db.projects.slice()
  if (query.year) rows = rows.filter((p) => String(p.year) === String(query.year))
  return rows.sort((a, b) => b.id - a.id).map(projectOut)
})

route('GET', '/projects/next-number', () => {
  const prefix = String(NOW.getFullYear()).slice(2)
  let max = 0
  db.projects.forEach((p) => {
    const sn = String(p.project_number || '').trim()
    if (sn.length === 5 && sn.slice(0, 2) === prefix && /^\d+$/.test(sn.slice(2))) {
      max = Math.max(max, Number(sn.slice(2)))
    }
  })
  return { next_number: `${prefix}${String(max + 1).padStart(3, '0')}` }
})

route('GET', '/projects/reserve-status', () =>
  db.projects.map((p) => {
    const r = D.projectReserve(p.id)
    return {
      project_id: p.id,
      project_name: p.name,
      project_number: p.project_number,
      total_invoiced: r.total_invoiced,
      employee_cost: r.employee_cost,
      partner_cost: r.partner_cost,
      grand_total: D.r2(r.employee_cost + r.partner_cost),
      reserve_balance: r.reserve_balance,
      reserve_depleted: r.reserve_depleted,
      has_reserve: r.has_reserve,
    }
  })
)

route('GET', '/projects/:id', ({ params }) => {
  const p = db.projects.find((x) => x.id === Number(params.id))
  if (!p) throw httpError(404, 'Project not found')
  return projectOut(p)
})

route('POST', '/projects', ({ body }) => {
  const p = {
    id: nextId('projects'),
    color: '#287475',
    is_billed: 'unbilled',
    billed_amount: 0,
    advance_amount: 0,
    partner_remuneration: 0,
    employee_remuneration: 0,
    project_remuneration: 0,
    total_assigned_hours: 0,
    partner_hourly_rate: 0,
    employee_budget: 0,
    partner_budget: 0,
    display_name: null,
    ...body,
  }
  db.projects.push(p)
  logAudit('create', 'project', p.id, `Created ${p.name}`)
  return projectOut(p)
})

route('PATCH', '/projects/:id', ({ params, body }) => {
  const p = db.projects.find((x) => x.id === Number(params.id))
  if (!p) throw httpError(404, 'Project not found')
  Object.assign(p, body)
  D.recomputeProject(p.id)
  logAudit('update', 'project', p.id, `Updated ${p.name}`)
  return projectOut(p)
})

route('DELETE', '/projects/:id', ({ params }) => {
  const id = Number(params.id)
  const i = db.projects.findIndex((x) => x.id === id)
  if (i >= 0) db.projects.splice(i, 1)
  // Cascade the way the FKs do.
  ;['assignments', 'stages', 'stage_subtasks', 'tasks', 'teams'].forEach((k) => {
    for (let j = db[k].length - 1; j >= 0; j--) {
      if (db[k][j].project_id === id) db[k].splice(j, 1)
    }
  })
  return null
})

route('POST', '/projects/:id/assign', ({ params, body }) => {
  const pid = Number(params.id)
  const u = findUser(body.user_id)
  if (!u) throw httpError(404, 'User not found')
  const existing = db.assignments.find((a) => a.project_id === pid && a.user_id === u.id)
  if (existing) return existing
  const a = {
    id: nextId('assignments'),
    user_id: u.id,
    project_id: pid,
    base_pay: u.salary_month,
    hourly_rate: u.hourly_rate,
  }
  db.assignments.push(a)
  return a
})

route('GET', '/projects/:id/summary', ({ params }) => {
  const pid = Number(params.id)
  const p = db.projects.find((x) => x.id === pid)
  if (!p) throw httpError(404, 'Project not found')

  // Bucket approved entry costs by (employee, salary period) — mirrors the
  // backend so a mid-project raise shows as two rows.
  const buckets = new Map()
  const hoursByUid = new Map()
  D.projectApprovedEntries(pid).forEach((e) => {
    const ts = db.weekly_timesheets.find((t) => t.id === e.timesheet_id)
    if (!ts) return
    const uid = ts.employee_id
    const bd = e.cost_breakdown && e.cost_breakdown.length
      ? e.cost_breakdown
      : [{ salary_history_id: null, hours: num(e.hours), rate: 0, cost: num(e.employee_cost) }]
    bd.forEach((b) => {
      const key = `${uid}|${b.salary_history_id ?? ''}`
      const cur = buckets.get(key) || { uid, sid: b.salary_history_id, hours: 0, cost: 0, rate: 0 }
      cur.hours += num(b.hours)
      cur.cost += num(b.cost)
      cur.rate = num(b.rate)
      buckets.set(key, cur)
      hoursByUid.set(uid, (hoursByUid.get(uid) || 0) + num(b.hours))
    })
  })

  const assignments = db.assignments.filter((a) => a.project_id === pid)
  const assignedIds = new Set(assignments.map((a) => a.user_id))
  const allIds = new Set([...hoursByUid.keys(), ...assignedIds])

  const employeeRows = []
  let totalHours = 0
  let totalSpent = 0

  allIds.forEach((uid) => {
    const user = findUser(uid)
    if (!user) return
    const assignment = assignments.find((a) => a.user_id === uid)
    const mine = [...buckets.values()].filter((b) => b.uid === uid)
    if (!mine.length) {
      employeeRows.push({
        assignment_id: assignment ? assignment.id : null,
        employee_id: uid,
        name: user.name,
        designation: user.designation,
        base_pay: num(user.salary_month),
        hourly_rate: num(user.hourly_rate),
        hours_worked: 0,
        total_spent: 0,
        effective_from: null,
      })
      return
    }
    mine.forEach((b) => {
      totalHours += b.hours
      totalSpent += b.cost
      const sh = db.salary_history.find((h) => h.id === b.sid)
      employeeRows.push({
        assignment_id: assignment ? assignment.id : null,
        employee_id: uid,
        name: user.name,
        designation: user.designation,
        base_pay: sh ? num(sh.monthly_salary) : num(user.salary_month),
        hourly_rate: D.r2(b.rate),
        hours_worked: D.r2(b.hours),
        total_spent: D.r2(b.cost),
        effective_from: sh ? sh.effective_from : null,
      })
    })
  })

  const partnerHourlyRate = num(p.partner_hourly_rate)
  const partnerCost = D.r2(partnerHourlyRate * totalHours)
  const grandTotal = D.r2(totalSpent + partnerCost)
  const totalInvoiced = D.projectInvoiced(pid)
  const reserveBalance = D.r2(totalInvoiced - grandTotal)
  const hasReserve = totalInvoiced > 0

  return {
    project_id: pid,
    project_name: p.name,
    employee_rows: employeeRows,
    totals: { total_hours: D.r2(totalHours), total_spent: D.r2(totalSpent), type: 'expense' },
    partner: {
      hourly_rate: partnerHourlyRate,
      total_hours: D.r2(totalHours),
      partner_cost: partnerCost,
      type: 'profit',
    },
    grand_total: grandTotal,
    total_invoiced: totalInvoiced,
    reserve_balance: reserveBalance,
    reserve_depleted: hasReserve && reserveBalance < 0,
    has_reserve: hasReserve,
  }
})

route('GET', '/projects/:id/billing', ({ params }) => {
  const pid = Number(params.id)
  const p = db.projects.find((x) => x.id === pid)
  if (!p) throw httpError(404, 'Project not found')
  const empCost = D.projectEmployeeCost(pid)
  const partnerCost = D.r2(D.projectHours(pid) * num(p.partner_hourly_rate))
  const totalCost = D.r2(empCost + partnerCost)
  const billed = num(p.billed_amount)
  const unbilled = Math.max(0, D.r2(totalCost - billed))
  return {
    project_id: pid,
    project_name: p.name,
    billed_amount: billed,
    unbilled_amount: unbilled,
    total_cost: totalCost,
    pie_data: [
      { label: 'Billed', value: billed },
      { label: 'Unbilled', value: unbilled },
    ],
  }
})

route('PATCH', '/projects/:id/billing', ({ params, query }) => {
  const p = db.projects.find((x) => x.id === Number(params.id))
  if (!p) throw httpError(404, 'Project not found')
  if (query.billed_amount != null) p.billed_amount = num(query.billed_amount)
  if (query.partner_hourly_rate != null) p.partner_hourly_rate = num(query.partner_hourly_rate)
  D.recomputeProject(p.id)
  return projectOut(p)
})

route('GET', '/projects/:id/projected-cost', ({ params }) => {
  const pid = Number(params.id)
  const p = db.projects.find((x) => x.id === pid)
  if (!p) throw httpError(404, 'Project not found')
  // Projected from allotted subtask hours at each assignee's current rate.
  const rows = []
  let projected = 0
  db.stage_subtasks.filter((s) => s.project_id === pid).forEach((s) => {
    const u = findUser(s.assigned_to)
    if (!u) return
    const cost = D.r2(num(s.hours) * num(u.hourly_rate))
    projected += cost
    rows.push({
      subtask_id: s.id,
      title: s.title,
      employee_id: u.id,
      name: u.name,
      hours: num(s.hours),
      hourly_rate: num(u.hourly_rate),
      projected_cost: cost,
    })
  })
  const actual = D.projectEmployeeCost(pid)
  return {
    project_id: pid,
    rows,
    projected_cost: D.r2(projected),
    actual_cost: actual,
    variance: D.r2(projected - actual),
  }
})

// ─── Teams ───
function teamOut(t) {
  const members = db.team_members
    .filter((m) => m.team_id === t.id)
    .map((m) => {
      const u = findUser(m.user_id)
      return {
        id: m.id,
        user_id: m.user_id,
        name: u ? u.name : `User ${m.user_id}`,
        designation: u ? u.designation : null,
        photo_url: u ? u.photo_url : null,
      }
    })
  const lead = findUser(t.team_lead_id)
  return {
    ...t,
    team_lead_name: lead ? lead.name : null,
    members,
    member_count: members.length,
  }
}

route('GET', '/projects/:id/teams', ({ params }) =>
  db.teams.filter((t) => t.project_id === Number(params.id)).map(teamOut)
)

route('POST', '/projects/:id/teams', ({ params, body }) => {
  const t = {
    id: nextId('teams'),
    project_id: Number(params.id),
    name: body.name || `Team ${db.teams.filter((x) => x.project_id === Number(params.id)).length + 1}`,
    team_lead_id: body.team_lead_id ?? null,
    created_at: new Date().toISOString(),
  }
  db.teams.push(t)
  return teamOut(t)
})

route('PATCH', '/projects/:pid/teams/:tid', ({ params, body }) => {
  const t = db.teams.find((x) => x.id === Number(params.tid))
  if (!t) throw httpError(404, 'Team not found')
  Object.assign(t, body)
  return teamOut(t)
})

route('DELETE', '/projects/:pid/teams/:tid', ({ params }) => {
  const id = Number(params.tid)
  const i = db.teams.findIndex((x) => x.id === id)
  if (i >= 0) db.teams.splice(i, 1)
  for (let j = db.team_members.length - 1; j >= 0; j--) {
    if (db.team_members[j].team_id === id) db.team_members.splice(j, 1)
  }
  return null
})

route('POST', '/projects/:pid/teams/:tid/members', ({ params, body }) => {
  const teamId = Number(params.tid)
  const userId = Number(body.user_id)
  const exists = db.team_members.find((m) => m.team_id === teamId && m.user_id === userId)
  if (exists) return teamOut(db.teams.find((t) => t.id === teamId))
  db.team_members.push({ id: nextId('team_members'), team_id: teamId, user_id: userId })
  return teamOut(db.teams.find((t) => t.id === teamId))
})

route('DELETE', '/projects/:pid/teams/:tid/members/:mid', ({ params }) => {
  const i = db.team_members.findIndex((m) => m.id === Number(params.mid))
  if (i >= 0) db.team_members.splice(i, 1)
  return null
})

route('GET', '/me/projects/:id/team', ({ params }) => {
  const pid = Number(params.id)
  const uid = currentUserId()
  const myTeam = db.teams.find((t) =>
    t.project_id === pid && db.team_members.some((m) => m.team_id === t.id && m.user_id === uid)
  ) || db.teams.find((t) => t.project_id === pid)
  return myTeam ? teamOut(myTeam) : null
})

// ─── Stages ───
// Money/hours are DERIVED from the project, never stored (mirrors the backend).
function stageOut(s) {
  const p = db.projects.find((x) => x.id === s.project_id)
  const bucket = p ? num(p.project_remuneration) - num(p.advance_amount) : 0
  const pct = num(s.percentage)
  const subtasks = db.stage_subtasks.filter((x) => x.stage_id === s.id).map(subtaskOut)
  return {
    ...s,
    amount: D.r2(bucket * (pct / 100)),
    hours: D.r2(num(p ? p.total_assigned_hours : 0) * (pct / 100)),
    subtasks,
    subtask_count: subtasks.length,
    completed_count: subtasks.filter((x) => x.status === 'completed').length,
  }
}

function subtaskOut(s) {
  const u = findUser(s.assigned_to)
  const p = db.projects.find((x) => x.id === s.project_id)
  const stage = db.stages.find((x) => x.id === s.stage_id)
  // Hours actually logged against this subtask.
  const logged = D.r2(db.ts_entries
    .filter((e) => e.subtask_id === s.id)
    .reduce((acc, e) => acc + num(e.hours), 0))
  return {
    ...s,
    assigned_to_name: u ? u.name : null,
    assignee_name: u ? u.name : null,
    project_name: p ? p.name : null,
    stage_name: stage ? stage.name : null,
    logged_hours: logged,
  }
}

route('GET', '/projects/:id/stages', ({ params }) => {
  const pid = Number(params.id)
  const p = db.projects.find((x) => x.id === pid)
  const stages = db.stages
    .filter((s) => s.project_id === pid)
    .sort((a, b) => a.sequence - b.sequence)
    .map(stageOut)
  const usedPct = stages.reduce((s, x) => s + num(x.percentage), 0)
  const bucket = p ? num(p.project_remuneration) - num(p.advance_amount) : 0
  return {
    project_id: pid,
    project_name: p ? p.name : null,
    total_value: p ? num(p.project_remuneration) : 0,
    advance_amount: p ? num(p.advance_amount) : 0,
    bucket,
    total_hours: p ? num(p.total_assigned_hours) : 0,
    stages,
    remaining: {
      percentage: D.r2(100 - usedPct),
      amount: D.r2(bucket * ((100 - usedPct) / 100)),
      hours: D.r2(num(p ? p.total_assigned_hours : 0) * ((100 - usedPct) / 100)),
    },
  }
})

route('GET', '/stages/all', () => {
  // Every stage across projects, for pickers.
  return db.stages
    .slice()
    .sort((a, b) => a.project_id - b.project_id || a.sequence - b.sequence)
    .map(stageOut)
})

route('POST', '/projects/:id/stages', ({ params, body }) => {
  const pid = Number(params.id)
  const me = findUser(currentUserId())
  const seq = db.stages.filter((s) => s.project_id === pid).length
  const s = {
    id: nextId('stages'),
    project_id: pid,
    name: body.name,
    sequence: body.sequence != null ? body.sequence : seq,
    percentage: num(body.percentage),
    status: 'active',
    completed_at: null,
    completed_by: null,
    created_by: me ? me.id : null,
    created_by_role: me ? me.role : null,
    created_at: new Date().toISOString(),
  }
  db.stages.push(s)
  logAudit('create', 'stage', s.id, `Added stage ${s.name}`)
  return stageOut(s)
})

route('PATCH', '/stages/:id', ({ params, body }) => {
  const s = db.stages.find((x) => x.id === Number(params.id))
  if (!s) throw httpError(404, 'Stage not found')
  Object.assign(s, body)
  if (body.status === 'completed' && !s.completed_at) {
    s.completed_at = new Date().toISOString()
    s.completed_by = currentUserId()
  }
  if (body.status === 'active') { s.completed_at = null; s.completed_by = null }
  return stageOut(s)
})

route('DELETE', '/stages/:id', ({ params }) => {
  const id = Number(params.id)
  const i = db.stages.findIndex((x) => x.id === id)
  if (i >= 0) db.stages.splice(i, 1)
  for (let j = db.stage_subtasks.length - 1; j >= 0; j--) {
    if (db.stage_subtasks[j].stage_id === id) db.stage_subtasks.splice(j, 1)
  }
  return null
})

// ─── Stage subtasks ───
route('GET', '/projects/:id/stage-subtasks', ({ params }) =>
  db.stage_subtasks.filter((s) => s.project_id === Number(params.id)).map(subtaskOut)
)

route('POST', '/stages/:id/subtasks', ({ params, body }) => {
  const stage = db.stages.find((x) => x.id === Number(params.id))
  if (!stage) throw httpError(404, 'Stage not found')
  const me = findUser(currentUserId())
  const s = {
    id: nextId('stage_subtasks'),
    stage_id: stage.id,
    project_id: stage.project_id,
    title: body.title,
    description: body.description || null,
    due_date: body.due_date || null,
    hours: body.hours != null ? num(body.hours) : null,
    assigned_to: body.assigned_to ?? null,
    status: 'pending',
    started_at: null,
    completed_at: null,
    completed_by: null,
    created_by: me ? me.id : null,
    created_by_role: me ? me.role : null,
    created_at: new Date().toISOString(),
  }
  db.stage_subtasks.push(s)
  logAudit('create', 'subtask', s.id, `Added subtask ${s.title}`)
  return subtaskOut(s)
})

route('PATCH', '/stage-subtasks/:id', ({ params, body }) => {
  const s = db.stage_subtasks.find((x) => x.id === Number(params.id))
  if (!s) throw httpError(404, 'Subtask not found')
  Object.assign(s, body)
  if (body.status === 'in-progress' && !s.started_at) s.started_at = new Date().toISOString()
  if (body.status === 'completed') {
    s.completed_at = new Date().toISOString()
    s.completed_by = currentUserId()
    if (!s.started_at) s.started_at = s.completed_at
  }
  if (body.status === 'pending') { s.started_at = null; s.completed_at = null; s.completed_by = null }
  return subtaskOut(s)
})

route('DELETE', '/stage-subtasks/:id', ({ params }) => {
  const i = db.stage_subtasks.findIndex((x) => x.id === Number(params.id))
  if (i >= 0) db.stage_subtasks.splice(i, 1)
  return null
})

route('GET', '/my/assigned-subtasks', () => {
  const uid = currentUserId()
  return db.stage_subtasks
    .filter((s) => s.assigned_to === uid && s.status !== 'completed')
    .map(subtaskOut)
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
})

route('GET', '/my/stage-subtask-deadlines', () => {
  const uid = currentUserId()
  const myProjects = new Set(db.assignments.filter((a) => a.user_id === uid).map((a) => a.project_id))
  return db.stage_subtasks
    .filter((s) => myProjects.has(s.project_id) && s.due_date)
    .map(subtaskOut)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
})

// ─── Calendar tasks ───
function taskOut(t) {
  const assignee = findUser(t.assigned_to)
  const assigner = findUser(t.assigned_by)
  const p = db.projects.find((x) => x.id === t.project_id)
  const subtasks = db.stage_subtasks.filter((s) => s.stage_id === t.stage_id)
  return {
    ...t,
    assignee_name: assignee ? assignee.name : null,
    assigned_to_name: assignee ? assignee.name : null,
    assigner_name: assigner ? assigner.name : null,
    project_name: p ? p.name : null,
    project_color: p ? p.color : null,
    subtasks: subtasks.map(subtaskOut),
  }
}

route('GET', '/tasks', ({ query }) => {
  let rows = db.tasks.slice()
  if (query.project_id) rows = rows.filter((t) => t.project_id === Number(query.project_id))
  if (query.assigned_to) rows = rows.filter((t) => t.assigned_to === Number(query.assigned_to))
  if (query.status) rows = rows.filter((t) => t.status === query.status)
  return rows.map(taskOut)
})

route('GET', '/tasks/calendar', ({ query }) => {
  let rows = db.tasks.slice()
  if (query.start) rows = rows.filter((t) => (t.end_date || t.date) >= query.start)
  if (query.end) rows = rows.filter((t) => t.date <= query.end)
  return rows.map(taskOut)
})

route('GET', '/tasks/my', () => {
  const uid = currentUserId()
  return db.tasks.filter((t) => t.assigned_to === uid).map(taskOut)
})

route('POST', '/tasks', ({ body }) => {
  const t = {
    id: nextId('tasks'),
    status: 'pending',
    priority: 'medium',
    started_at: null,
    completed_at: null,
    assigned_by: currentUserId(),
    ...body,
  }
  db.tasks.push(t)
  logAudit('create', 'task', t.id, `Created task ${t.title}`)
  return taskOut(t)
})

route('POST', '/tasks/bulk-assign', ({ body }) => {
  const created = (body.tasks || []).map((raw) => {
    const t = {
      id: nextId('tasks'),
      status: 'pending',
      priority: 'medium',
      started_at: null,
      completed_at: null,
      assigned_by: currentUserId(),
      ...raw,
    }
    db.tasks.push(t)
    return taskOut(t)
  })
  return created
})

route('PATCH', '/tasks/:id', ({ params, body }) => {
  const t = db.tasks.find((x) => x.id === Number(params.id))
  if (!t) throw httpError(404, 'Task not found')
  Object.assign(t, body)
  return taskOut(t)
})

route('PATCH', '/tasks/:id/status', ({ params, body }) => {
  const t = db.tasks.find((x) => x.id === Number(params.id))
  if (!t) throw httpError(404, 'Task not found')
  t.status = body.status
  if (body.status === 'in-progress' && !t.started_at) t.started_at = new Date().toISOString()
  if (body.status === 'completed') {
    t.completed_at = new Date().toISOString()
    if (!t.started_at) t.started_at = t.completed_at
  }
  if (body.status === 'pending') { t.started_at = null; t.completed_at = null }
  return taskOut(t)
})

route('DELETE', '/tasks/:id', ({ params }) => {
  const i = db.tasks.findIndex((x) => x.id === Number(params.id))
  if (i >= 0) db.tasks.splice(i, 1)
  return null
})
