// Bottom-up demo seeder.
//
// Golden rule: every rollup (project cost, reserve, slip net, invoice paid) is
// SUMMED FROM THE ROWS BELOW IT — never assigned a nice-looking number. That's
// what keeps the dashboard reconcilable when a prospect drills into a project,
// its timesheets and its invoice payments.
//
// Order: settings -> employees(+salary history) -> clients -> projects ->
// stages -> stage subtasks -> teams -> tasks -> timesheets(+entries -> cost) ->
// invoices(+items -> payments) -> expenses -> reimbursements -> salary slips.
//
// Labels are deliberately generic ("Employee 1", "Project 1"): this is a demo,
// and nothing should read as a real client.
import { rng, resetRng } from './rng'
import { NOW, iso, isoDateTime, addDays, addMonths, mondayOf, monthKey, recentWeekStarts } from './dates'

const EMPLOYEE_COUNT = 12
const PROJECT_COUNT = 8
const CLIENT_COUNT = 6
const WEEKS_OF_TIMESHEETS = 10

const DESIGNATIONS = ['Architect', 'Senior Architect', 'Junior Architect', 'Draftsman', '3D Visualiser', 'Interior Designer']
const STAGE_NAMES = ['Concept Design', 'Schematic Design', 'Design Development', 'Construction Docs', 'Site Supervision']
const SUBTASK_VERBS = ['Floor Plans', 'Elevations', 'Sections', 'Material Board', '3D Views', 'Site Visit Report', 'BOQ', 'Detail Drawings']
const EXPENSE_CATEGORIES = ['rent', 'utilities', 'software', 'misc', 'travel']
const PROJECT_COLORS = ['#287475', '#3525cd', '#b4530a', '#7a1fa2', '#0f766e', '#be123c', '#1d4ed8', '#4d7c0f']

// ── id helper ──
function makeSeq() {
  const counters = {}
  return (name) => {
    counters[name] = (counters[name] || 0) + 1
    return counters[name]
  }
}

export function seedDemo(db, seed) {
  // No seed -> resetRng() uses its fixed default (the rehearsed opening set).
  // A seed (passed on an explicit reset) reshuffles every figure below.
  resetRng(seed)
  const id = makeSeq()
  const r2 = (n) => Math.round(n * 100) / 100

  // ─── Settings (singleton) ───
  db.settings = {
    company_name: 'Demo Studio LLP',
    company_address: '1st Floor, Demo Building, Demo Road\nDemo City, Demo State 400001',
    company_gstin: '27AAAAA0000A1Z5',
    company_phone: '9000000000',
    company_email: 'INFO@DEMOSTUDIO.COM',
    company_signatory_name: 'Partner 1',
    company_signatory_role: 'Partner',
    working_hours_per_month: 160,
    salary_months_per_year: 13,
    tds_percent: 10,
  }
  const WHPM = db.settings.working_hours_per_month
  const SMPY = db.settings.salary_months_per_year

  // hourly = (monthly * smpy / 12) / whpm  — mirrors the backend formula.
  const hourlyFrom = (monthly) => r2((monthly * SMPY) / 12 / WHPM)

  // ─── Employees ───
  // User 1 = Admin 1, User 2 = Admin 2 (four-eyes approval needs two admins),
  // User 3-4 = PMs, rest = employees.
  const roleFor = (i) => (i <= 2 ? 'admin' : i <= 4 ? 'project_manager' : 'employee')
  const labelFor = (i, role) =>
    role === 'admin' ? `Admin ${i}` : role === 'project_manager' ? `PM ${i - 2}` : `Employee ${i - 4}`

  for (let i = 1; i <= EMPLOYEE_COUNT; i++) {
    const role = roleFor(i)
    const name = labelFor(i, role)
    const monthly = role === 'admin' ? rng.int(90, 120) * 1000
      : role === 'project_manager' ? rng.int(60, 80) * 1000
      : rng.int(25, 55) * 1000
    const joining = addDays(NOW, -rng.int(200, 1400))
    const uid = id('users')
    db.users.push({
      id: uid,
      name,
      designation: role === 'admin' ? 'Partner' : role === 'project_manager' ? 'Project Manager' : rng.pick(DESIGNATIONS),
      joining_date: iso(joining),
      end_date: null,
      salary_month: monthly,
      salary_hour: null,
      hourly_rate: hourlyFrom(monthly),
      leaves_allowed: 12,
      paid_leave_balance: rng.int(2, 16) / 2, // supports half days
      leave_accrued_through: monthKey(NOW),
      pan_number: `AAAAA${String(1000 + uid).slice(-4)}A`,
      aadhar_number: `${1000 + uid} ${2000 + uid} ${3000 + uid}`,
      gender: rng.pick(['M', 'F']),
      location: 'Demo City',
      bank_name: `Bank ${rng.int(1, 3)}`,
      bank_account_number: `00000000${String(1000 + uid)}`,
      bank_ifsc_code: `DEMO000${String(100 + uid).slice(-3)}`,
      birthdate: iso(addDays(NOW, -rng.int(8000, 14000))),
      personal_mail: `user${uid}@personal.demo`,
      studio_email: `${name.toLowerCase().replace(/\s+/g, '')}@demostudio.com`,
      photo_url: null,
      documents_url: null,
      time_tracker_login: null,
      time_tracker_password: null,
      phone_number: `90000000${String(10 + uid).slice(-2)}`,
      emergency_contact_name: `Contact ${uid}`,
      emergency_contact_number: `91000000${String(10 + uid).slice(-2)}`,
      emergency_contact_relationship: rng.pick(['Parent', 'Sibling', 'Spouse']),
      role,
      is_active: true,
      manager_id: role === 'employee' ? rng.pick([3, 4]) : null,
    })

    // Salary history: an original rate, plus a raise for ~half the staff.
    const firstFrom = joining
    db.salary_history.push({
      id: id('salary_history'),
      user_id: uid,
      monthly_salary: role === 'employee' ? r2(monthly * 0.85) : monthly,
      salary_hour: null,
      smpy: SMPY,
      whpm: WHPM,
      hourly_rate: hourlyFrom(role === 'employee' ? monthly * 0.85 : monthly),
      effective_from: iso(firstFrom),
      effective_to: null,
      note: 'Initial',
    })
    if (role === 'employee' && rng.chance(0.5)) {
      const raiseOn = addMonths(NOW, -rng.int(3, 10))
      // close the first period
      const prev = db.salary_history[db.salary_history.length - 1]
      prev.effective_to = iso(addDays(raiseOn, -1))
      db.salary_history.push({
        id: id('salary_history'),
        user_id: uid,
        monthly_salary: monthly,
        salary_hour: null,
        smpy: SMPY,
        whpm: WHPM,
        hourly_rate: hourlyFrom(monthly),
        effective_from: iso(raiseOn),
        effective_to: null,
        note: 'Annual increment',
      })
    }
  }

  const admins = db.users.filter((u) => u.role === 'admin')
  const pms = db.users.filter((u) => u.role === 'project_manager')
  const workers = db.users.filter((u) => u.role !== 'admin')
  const ADMIN1 = admins[0].id
  const ADMIN2 = admins[1].id

  // Rate in effect for a user on a given date — mirrors the backend's
  // effective-dated lookup. This is the ONLY source of timesheet cost.
  const rateOn = (userId, dateStr) => {
    const rows = db.salary_history
      .filter((h) => h.user_id === userId && h.effective_from <= dateStr)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
    if (rows.length) return { rate: Number(rows[0].hourly_rate) || 0, id: rows[0].id }
    const any = db.salary_history.find((h) => h.user_id === userId)
    return { rate: any ? Number(any.hourly_rate) || 0 : 0, id: any ? any.id : null }
  }

  // ─── Clients ───
  for (let i = 1; i <= CLIENT_COUNT; i++) {
    const isBusiness = i % 3 !== 0
    db.clients.push({
      id: id('clients'),
      name: `Client ${i}`,
      salutation: null,
      email: `client${i}@demo.com`,
      phone: `98000000${String(10 + i).slice(-2)}`,
      address: `Unit ${i}, Demo Complex\nDemo City, Demo State 4000${String(10 + i).slice(-2)}`,
      address_line1: `Unit ${i}, Demo Complex`,
      address_line2: 'Demo Road',
      city: 'Demo City',
      state: 'Demo State',
      pincode: `4000${String(10 + i).slice(-2)}`,
      customer_type: isBusiness ? 'business' : 'individual',
      gstin: isBusiness ? `27AAAAA${String(1000 + i).slice(-4)}A1Z${i % 10}` : null,
      pan: isBusiness ? null : `AAAAA${String(2000 + i).slice(-4)}B`,
    })
  }

  // ─── Bank accounts ───
  for (let i = 1; i <= 2; i++) {
    db.bank_accounts.push({
      id: id('bank_accounts'),
      bank_name: `Bank ${i}`,
      account_number: `1234567890${i}`,
      account_type: i === 1 ? 'Current' : 'Savings',
      account_holder_name: 'Demo Studio LLP',
      ifsc_code: `DEMO000${1000 + i}`,
      is_active: true,
    })
  }

  // ─── Projects ───
  const thisYear = NOW.getFullYear()
  for (let i = 1; i <= PROJECT_COUNT; i++) {
    const start = addDays(NOW, -rng.int(120, 500))
    const end = addDays(start, rng.int(200, 500))
    const value = rng.int(8, 40) * 100000
    const advance = Math.round(value * 0.1)
    db.projects.push({
      id: id('projects'),
      project_number: `P-${String(thisYear).slice(2)}${String(i).padStart(3, '0')}`,
      name: `Project ${i}`,
      display_name: null,
      location: `Demo Location ${i}`,
      gmap_link: null,
      year: start.getFullYear(),
      current_stage: null,
      is_billed: i % 4 === 0 ? 'unbilled' : 'billed',
      start_date: iso(start),
      end_date: iso(end),
      client_id: ((i - 1) % CLIENT_COUNT) + 1,
      work_order_urls: null,
      color: PROJECT_COLORS[(i - 1) % PROJECT_COLORS.length],
      partner_remuneration: 0,
      employee_remuneration: 0,
      project_remuneration: value,
      total_assigned_hours: rng.int(400, 1600),
      partner_hourly_rate: rng.int(8, 20) * 50,
      employee_budget: 0,
      partner_budget: 0,
      billed_amount: 0, // summed from invoices below
      advance_amount: advance,
    })
  }

  // ─── Assignments (who works on what) ───
  db.projects.forEach((p) => {
    const team = rng.sample(workers, rng.int(3, 6))
    team.forEach((u) => {
      db.assignments.push({
        id: id('assignments'),
        user_id: u.id,
        project_id: p.id,
        base_pay: u.salary_month,
        hourly_rate: u.hourly_rate,
      })
    })
    // One team per project, led by a PM.
    const teamId = id('teams')
    db.teams.push({
      id: teamId,
      project_id: p.id,
      name: 'Team 1',
      team_lead_id: rng.pick(pms).id,
      created_at: isoDateTime(addDays(NOW, -100)),
    })
    team.forEach((u) => {
      db.team_members.push({ id: id('team_members'), team_id: teamId, user_id: u.id })
    })
  })

  // ─── Stages + stage subtasks ───
  db.projects.forEach((p) => {
    const count = rng.int(3, 5)
    // Percentages must total 100 across the project's stages.
    const pcts = []
    let left = 100
    for (let s = 0; s < count; s++) {
      const isLast = s === count - 1
      const pct = isLast ? left : Math.min(left - (count - s - 1) * 10, rng.int(15, 30))
      pcts.push(pct)
      left -= pct
    }
    for (let s = 0; s < count; s++) {
      const completed = s < count - 2 // earlier stages done
      const stageId = id('stages')
      db.stages.push({
        id: stageId,
        project_id: p.id,
        name: STAGE_NAMES[s % STAGE_NAMES.length],
        sequence: s,
        percentage: pcts[s],
        status: completed ? 'completed' : 'active',
        completed_at: completed ? isoDateTime(addDays(NOW, -rng.int(30, 200))) : null,
        completed_by: completed ? ADMIN1 : null,
        created_by: ADMIN1,
        created_by_role: 'admin',
        created_at: isoDateTime(addDays(NOW, -rng.int(200, 400))),
      })
      // subtasks for this stage
      const subCount = rng.int(2, 4)
      for (let k = 0; k < subCount; k++) {
        const assignee = rng.pick(workers)
        // Mix of states, with dates relative to today so the board looks live.
        let status = 'pending'
        if (completed) status = 'completed'
        else if (k === 0) status = 'in-progress'
        const due = completed
          ? addDays(NOW, -rng.int(30, 120))
          : addDays(NOW, rng.int(-10, 45)) // a few overdue, most upcoming
        db.stage_subtasks.push({
          id: id('stage_subtasks'),
          stage_id: stageId,
          project_id: p.id,
          title: `${rng.pick(SUBTASK_VERBS)}`,
          description: `Subtask for ${STAGE_NAMES[s % STAGE_NAMES.length]}`,
          due_date: iso(due),
          hours: rng.int(4, 40),
          assigned_to: assignee.id,
          status,
          started_at: status !== 'pending' ? isoDateTime(addDays(due, -rng.int(5, 20))) : null,
          completed_at: status === 'completed' ? isoDateTime(addDays(due, -rng.int(0, 4))) : null,
          completed_by: status === 'completed' ? ADMIN1 : null,
          created_by: ADMIN1,
          created_by_role: 'admin',
          created_at: isoDateTime(addDays(due, -rng.int(25, 60))),
        })
      }
    }
    // current_stage label = first active stage
    const active = db.stages.find((s) => s.project_id === p.id && s.status === 'active')
    p.current_stage = active ? active.name : null
  })

  // ─── Calendar tasks ───
  db.projects.forEach((p) => {
    const stagesOf = db.stages.filter((s) => s.project_id === p.id)
    for (let t = 0; t < rng.int(2, 4); t++) {
      const startD = addDays(NOW, rng.int(-25, 25))
      const dur = rng.int(1, 6)
      const assignee = rng.pick(workers)
      const status = startD < NOW ? rng.pick(['completed', 'in-progress', 'pending']) : 'pending'
      db.tasks.push({
        id: id('tasks'),
        title: `Task ${t + 1} — ${p.name}`,
        description: 'Demo task',
        date: iso(startD),
        end_date: iso(addDays(startD, dur)),
        duration_hours: dur * 8,
        priority: rng.pick(['low', 'medium', 'high']),
        status,
        started_at: status !== 'pending' ? isoDateTime(startD) : null,
        completed_at: status === 'completed' ? isoDateTime(addDays(startD, dur)) : null,
        project_id: p.id,
        stage_id: stagesOf.length ? rng.pick(stagesOf).id : null,
        assigned_to: assignee.id,
        assigned_by: ADMIN1,
      })
    }
  })

  // ─── Holidays ───
  for (let i = 1; i <= 6; i++) {
    db.holidays.push({
      id: id('holidays'),
      date: iso(addDays(NOW, rng.int(-150, 150))),
      name: `Holiday ${i}`,
    })
  }

  // ─── Weekly timesheets + entries (THE cost source) ───
  const weeks = recentWeekStarts(WEEKS_OF_TIMESHEETS)
  workers.forEach((u) => {
    weeks.forEach((weekStart, wi) => {
      const isCurrentWeek = wi === weeks.length - 1
      const isPrevWeek = wi === weeks.length - 2
      // Current week left as a draft-in-progress; previous week awaits approval
      // (guaranteed "pending approvals" showcase); older weeks approved.
      let status = 'approved'
      if (isCurrentWeek) status = 'submitted'
      else if (isPrevWeek) status = rng.chance(0.6) ? 'submitted' : 'admin_approved'

      const weekStartDate = new Date(weekStart + 'T00:00:00')
      const weekEnd = addDays(weekStartDate, 6)
      const tsId = id('weekly_timesheets')

      // 1-3 projects worked that week
      const myProjects = db.assignments.filter((a) => a.user_id === u.id).map((a) => a.project_id)
      const picks = rng.sample(myProjects.length ? myProjects : [1], Math.min(rng.int(1, 3), myProjects.length || 1))

      let sheetHours = 0
      const entries = []
      picks.forEach((pid) => {
        // Per-day hours Mon..Sun. Occasional overtime day to exercise comp-off.
        const daily = []
        for (let d = 0; d < 7; d++) {
          if (d >= 5) {
            daily.push(d === 5 && rng.chance(0.15) ? rng.int(4, 9) : 0) // rare Saturday
          } else {
            daily.push(rng.int(2, 5)) // split across the week's projects
          }
        }
        const hours = daily.reduce((a, b) => a + b, 0)
        if (hours === 0) return
        sheetHours += hours
        const stagesOf = db.stages.filter((s) => s.project_id === pid)
        const stage = stagesOf.length ? rng.pick(stagesOf) : null
        const subsOf = stage ? db.stage_subtasks.filter((s) => s.stage_id === stage.id) : []
        entries.push({
          id: id('ts_entries'),
          timesheet_id: tsId,
          project_id: pid,
          stage_id: stage ? stage.id : null,
          subtask_id: subsOf.length ? rng.pick(subsOf).id : null,
          hours,
          description: 'Demo work entry',
          daily_hours: daily,
          employee_cost: null, // frozen below, only when approved
          cost_breakdown: null,
        })
      })

      if (!entries.length) return

      // Freeze cost on fully-approved sheets — exactly what the backend does at
      // approval. Unapproved sheets carry no cost, so they don't hit reserve.
      if (status === 'approved') {
        entries.forEach((e) => {
          const { rate, id: shId } = rateOn(u.id, iso(weekEnd))
          e.employee_cost = r2(e.hours * rate)
          e.cost_breakdown = [{ salary_history_id: shId, hours: e.hours, rate, cost: e.employee_cost }]
        })
      }

      db.weekly_timesheets.push({
        id: tsId,
        employee_id: u.id,
        week_start: weekStart,
        week_end: iso(weekEnd),
        total_hours: sheetHours,
        description: null,
        status,
        submitted_at: isoDateTime(addDays(weekEnd, 1)),
        pm_approved_by: null,
        pm_approved_at: null,
        admin_approved_by: status === 'approved' || status === 'admin_approved' ? ADMIN1 : null,
        admin_approved_at: status === 'approved' || status === 'admin_approved' ? isoDateTime(addDays(weekEnd, 2)) : null,
        admin2_approved_by: status === 'approved' ? ADMIN2 : null,
        admin2_approved_at: status === 'approved' ? isoDateTime(addDays(weekEnd, 3)) : null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
      })
      entries.forEach((e) => db.ts_entries.push(e))

      // Comp-off credits from overtime days on approved sheets (weekday 12h+ =
      // 0.5, 14h+ = 1.0; Saturday any work = 0.5, 8h+ = 1.0).
      if (status === 'approved') {
        for (let d = 0; d < 7; d++) {
          const dayTotal = entries.reduce((sum, e) => sum + (e.daily_hours[d] || 0), 0)
          let amount = 0
          if (d === 5 && dayTotal > 0) amount = dayTotal >= 8 ? 1 : 0.5
          else if (d < 5 && dayTotal >= 14) amount = 1
          else if (d < 5 && dayTotal >= 12) amount = 0.5
          if (amount > 0) {
            db.overtime_leaves.push({
              id: id('overtime_leaves'),
              employee_id: u.id,
              timesheet_id: tsId,
              work_date: iso(addDays(weekStartDate, d)),
              hours: dayTotal,
              amount,
              consumed: 0,
              expires_on: iso(addDays(weekStartDate, 365)),
              created_at: isoDateTime(addDays(weekEnd, 3)),
            })
          }
        }
      }
    })
  })

  // Project employee cost = SUM of frozen entry costs (never assigned directly).
  const projectCost = (pid) =>
    r2(db.ts_entries
      .filter((e) => e.project_id === pid && e.employee_cost != null)
      .reduce((s, e) => s + Number(e.employee_cost), 0))
  const projectHours = (pid) =>
    r2(db.ts_entries
      .filter((e) => e.project_id === pid && e.employee_cost != null)
      .reduce((s, e) => s + Number(e.hours), 0))

  // ─── Invoices (+ items, + payments) ───
  db.projects.forEach((p, idx) => {
    const client = db.clients.find((c) => c.id === p.client_id)
    const stagesOf = db.stages.filter((s) => s.project_id === p.id)
    const completedStages = stagesOf.filter((s) => s.status === 'completed')
    // Invoice the completed stages. Project 4 (idx 3) is deliberately left
    // under-invoiced so the dashboard has a real depleted-reserve showcase.
    const toInvoice = idx === 3 ? completedStages.slice(0, 1) : completedStages
    const bucket = Number(p.project_remuneration) - Number(p.advance_amount)

    toInvoice.forEach((stage, si) => {
      const subtotal = r2(bucket * (Number(stage.percentage) / 100))
      if (subtotal <= 0) return
      const invId = id('invoices')
      const taxRate = 18
      const isIgst = false
      const taxAmt = r2(subtotal * (taxRate / 100))
      const cgst = r2(taxAmt / 2)
      const sgst = r2(taxAmt - cgst)
      const invDate = addDays(NOW, -rng.int(20, 200))
      db.invoices.push({
        id: invId,
        invoice_type: 'tax',
        invoice_number: `INV-${String(invId).padStart(4, '0')}`,
        invoice_date: iso(invDate),
        place_of_supply: 'Demo State',
        bill_to_name: client ? client.name : 'Client',
        bill_to_address: client ? client.address : '',
        bill_to_gstin: client ? client.gstin : null,
        bill_to_pan: client ? client.pan : null,
        customer_type: client ? client.customer_type : 'business',
        ship_to_name: null,
        ship_to_address: null,
        ship_to_gstin: null,
        subject: `${p.name} — ${stage.name}`,
        subtotal,
        cgst: isIgst ? 0 : cgst,
        sgst: isIgst ? 0 : sgst,
        igst: isIgst ? taxAmt : 0,
        total: r2(subtotal + taxAmt),
        tax_type: isIgst ? 'IGST' : 'CGST_SGST',
        tax_breakdown: [
          { rate: taxRate, taxable_value: subtotal, cgst: isIgst ? 0 : cgst, sgst: isIgst ? 0 : sgst, igst: isIgst ? taxAmt : 0 },
        ],
        project_id: p.id,
        client_id: p.client_id,
        bank_account_id: 1,
        created_by: ADMIN1,
      })
      db.invoice_items.push({
        id: id('invoice_items'),
        invoice_id: invId,
        description: `${stage.name} — professional fees (${stage.percentage}%)`,
        hsn_sac: '998321',
        amount: subtotal,
        tax_rate: taxRate,
      })

      // Payments: older invoices fully paid, recent ones partial/unpaid.
      const total = r2(subtotal + taxAmt)
      const age = Math.round((NOW - invDate) / 86400000)
      let payFraction = 0
      if (age > 120) payFraction = 1
      else if (age > 60) payFraction = 0.5
      else if (si === 0 && rng.chance(0.5)) payFraction = 0.3
      if (payFraction > 0) {
        const settled = r2(total * payFraction)
        const tdsPercent = 10
        const tdsAmount = r2(settled * (tdsPercent / 100))
        db.invoice_payments.push({
          id: id('invoice_payments'),
          invoice_id: invId,
          received_amount: r2(settled - tdsAmount),
          tds_percent: tdsPercent,
          tds_amount: tdsAmount,
          settled_amount: settled,
          payment_date: iso(addDays(invDate, rng.int(15, 45))),
          note: 'Demo payment',
          created_by: ADMIN1,
          created_at: isoDateTime(addDays(invDate, rng.int(15, 45))),
        })
      }
    })

    // billed_amount rolls up from this project's invoices (subtotal basis,
    // matching the backend's reserve math).
    p.billed_amount = r2(
      db.invoices.filter((i) => i.project_id === p.id).reduce((s, i) => s + Number(i.subtotal), 0)
    )
    // Derived remuneration figures shown on project screens.
    p.employee_remuneration = projectCost(p.id)
    p.partner_remuneration = r2(projectHours(p.id) * Number(p.partner_hourly_rate))
  })

  // ─── Expense parties + expenses + expense payments ───
  for (let i = 1; i <= 4; i++) {
    db.expense_parties.push({
      id: id('expense_parties'),
      name: `Vendor ${i}`,
      gstin: `27BBBBB${String(1000 + i).slice(-4)}B1Z${i}`,
      pan: `BBBBB${String(3000 + i).slice(-4)}C`,
      phone: `97000000${String(10 + i).slice(-2)}`,
      email: `vendor${i}@demo.com`,
      address: `Vendor ${i} Address, Demo City`,
      default_gst_percent: 18,
      notes: null,
      created_by: ADMIN1,
      created_at: isoDateTime(addDays(NOW, -300)),
    })
  }
  for (let m = 0; m < 8; m++) {
    const monthDate = addMonths(NOW, -m)
    EXPENSE_CATEGORIES.forEach((cat, ci) => {
      const base = cat === 'rent' ? 60000 : cat === 'utilities' ? rng.int(6, 14) * 1000
        : cat === 'software' ? rng.int(8, 20) * 1000 : rng.int(3, 15) * 1000
      const gstPercent = 18
      const gstAmount = r2(base * (gstPercent / 100))
      const amount = r2(base + gstAmount)
      const expId = id('expenses')
      const expDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), rng.int(2, 26))
      db.expenses.push({
        id: expId,
        title: `${cat} — ${monthKey(monthDate)}`,
        category: cat,
        amount,
        base_amount: base,
        gst_percent: gstPercent,
        gst_amount: gstAmount,
        party_id: ((ci % 4) + 1),
        date: iso(expDate),
        recurring: cat === 'rent',
        notes: null,
        added_by: ADMIN1,
      })
      // Older expenses fully paid; the most recent month left partly open.
      if (m > 0) {
        db.expense_payments.push({
          id: id('expense_payments'),
          expense_id: expId,
          amount,
          payment_date: iso(addDays(expDate, rng.int(3, 20))),
          note: 'Demo settlement',
          created_by: ADMIN1,
          created_at: isoDateTime(addDays(expDate, 5)),
        })
      }
    })
  }

  // ─── Overheads ───
  for (let i = 1; i <= 3; i++) {
    const ohId = id('overheads')
    db.overheads.push({
      id: ohId,
      number: `OH-${String(i).padStart(3, '0')}`,
      description: `Overhead ${i}`,
      cost: rng.int(5, 30) * 1000,
      period_type: i === 3 ? 'yearly' : 'monthly',
      created_by: ADMIN1,
      created_at: isoDateTime(addDays(NOW, -200)),
    })
    rng.sample(workers, rng.int(2, 5)).forEach((u) => {
      db.overhead_employees.push({ overhead_id: ohId, employee_id: u.id })
    })
  }

  // ─── Leave requests ───
  workers.forEach((u) => {
    for (let i = 0; i < rng.int(1, 3); i++) {
      const start = addDays(NOW, rng.int(-120, 25))
      const days = rng.int(1, 3)
      const isFuture = start > NOW
      const status = isFuture ? 'pending' : rng.pick(['approved', 'approved', 'rejected'])
      db.leaves.push({
        id: id('leaves'),
        employee_id: u.id,
        start_date: iso(start),
        end_date: iso(addDays(start, days - 1)),
        reason: `Leave reason ${i + 1}`,
        status,
        days_count: days,
        paid_days: status === 'approved' ? days : 0,
        unpaid_days: 0,
        overtime_consumed: null,
      })
    }
  })

  // ─── Reimbursements ───
  workers.forEach((u) => {
    for (let i = 0; i < rng.int(1, 3); i++) {
      const d = addDays(NOW, -rng.int(5, 150))
      const status = d > addDays(NOW, -20) ? 'pending' : rng.pick(['approved', 'approved', 'rejected'])
      db.reimbursements.push({
        id: id('reimbursements'),
        employee_id: u.id,
        amount: rng.int(5, 60) * 100,
        reason: `Reimbursement ${i + 1}`,
        date: iso(d),
        proof_url: null,
        status,
        month_added: status === 'approved' ? monthKey(d) : null,
        created_at: isoDateTime(d),
      })
    }
  })

  // ─── Salary slips (derived from salary + leave + reimbursements) ───
  // Generate for the last 3 completed months.
  for (let m = 3; m >= 1; m--) {
    const slipMonth = addMonths(NOW, -m)
    const mk = monthKey(slipMonth)
    db.users.filter((u) => u.is_active).forEach((u) => {
      const { rate } = rateOn(u.id, iso(new Date(slipMonth.getFullYear(), slipMonth.getMonth() + 1, 0)))
      const base = Number(u.salary_month)
      const tdsPercent = db.settings.tds_percent
      const tdsAmount = r2(base * (tdsPercent / 100))
      // Reimbursements approved for that month roll into the slip.
      const reimb = r2(db.reimbursements
        .filter((x) => x.employee_id === u.id && x.status === 'approved' && x.month_added === mk)
        .reduce((s, x) => s + Number(x.amount), 0))
      // Unpaid leave deduction (none in demo data, but the field is wired).
      const unpaidDays = 0
      const leaveDeduction = r2(rate * 8 * unpaidDays)
      const payout = new Date(slipMonth.getFullYear(), slipMonth.getMonth() + 1, 7)
      db.salary_slips.push({
        id: id('salary_slips'),
        employee_id: u.id,
        month: mk,
        base_salary: base,
        tds_percent: tdsPercent,
        tds_amount: tdsAmount,
        reimbursement_total: reimb,
        paid_leave_days: 0,
        unpaid_leave_days: unpaidDays,
        leave_deduction: leaveDeduction,
        // net = base - tds - leave_deduction + reimbursements
        net_total: r2(base - tdsAmount - leaveDeduction + reimb),
        payout_date: iso(payout),
        status: m > 1 ? 'approved' : 'pending',
        created_at: isoDateTime(payout),
        approved_at: m > 1 ? isoDateTime(payout) : null,
      })
    })
  }

  // ─── Estimates ───
  for (let i = 1; i <= 3; i++) {
    const start = addDays(NOW, -rng.int(30, 200))
    const end = addDays(start, rng.int(90, 300))
    const estId = id('estimates')
    const emps = []
    let teamCost = 0
    ;['Junior', 'Mid-Level', 'Senior'].forEach((t) => {
      const basePay = t === 'Junior' ? 25000 : t === 'Mid-Level' ? 45000 : 70000
      const pph = hourlyFrom(basePay)
      const totalHours = rng.int(200, 600)
      const cost = r2(pph * totalHours)
      teamCost += cost
      emps.push({
        id: id('estimate_employees'),
        estimate_id: estId,
        emp_type: t,
        base_pay: basePay,
        hrs_per_day: 8,
        pay_per_hour: pph,
        total_hours: totalHours,
        total_cost: cost,
      })
    })
    const partnerPph = rng.int(8, 20) * 50
    const workingDays = rng.int(60, 200)
    const partnerCost = r2(partnerPph * workingDays * 2)
    db.estimates.push({
      id: estId,
      project_name: `Estimate ${i}`,
      start_date: iso(start),
      end_date: iso(end),
      working_days: workingDays,
      partner_pay_per_hour: partnerPph,
      partner_cost: partnerCost,
      team_cost: r2(teamCost),
      grand_total: r2(teamCost + partnerCost),
      project_color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      status: i === 1 ? 'finalized' : 'draft',
      created_by: ADMIN1,
      created_at: isoDateTime(start),
      updated_at: isoDateTime(start),
    })
    emps.forEach((e) => db.estimate_employees.push(e))
  }

  // ─── Audit log ───
  const auditSamples = [
    ['create', 'project', 'Created Project 1'],
    ['approve', 'timesheet', 'Approved a weekly timesheet'],
    ['create', 'invoice', 'Created invoice INV-0001'],
    ['approve', 'reimbursement', 'Approved a reimbursement claim'],
    ['update', 'user', 'Updated employee details'],
    ['create', 'expense', 'Recorded an expense'],
  ]
  for (let i = 0; i < 25; i++) {
    const [action, entity, summary] = auditSamples[i % auditSamples.length]
    const actor = rng.pick(admins)
    db.audit_logs.push({
      id: id('audit_logs'),
      created_at: isoDateTime(addDays(NOW, -rng.int(0, 90))),
      actor_id: actor.id,
      actor_name: actor.name,
      action,
      entity_type: entity,
      entity_id: rng.int(1, 8),
      summary,
      details: null,
    })
  }
  db.audit_logs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  // Persist the id counters so runtime creates continue the sequence.
  const counters = {}
  Object.keys(db).forEach((k) => {
    if (Array.isArray(db[k]) && db[k].length && db[k][0].id != null) {
      counters[k] = Math.max(...db[k].map((x) => Number(x.id) || 0))
    }
  })
  db.seq = counters

  return db
}
