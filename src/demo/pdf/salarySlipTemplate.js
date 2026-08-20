// Port of the backend's render_salary_slip_html(). Same A4 CSS and row logic.
import { formatIndianCurrency, esc } from './format'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (v) => '&#8377; ' + formatIndianCurrency(Number(v) || 0)
const days = (v) => (Number.isInteger(Number(v)) ? Number(v) : v)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function underThousand(n) {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + underThousand(n % 100) : '')
}
function wordsRupees(amount) {
  let n = Math.floor(Number(amount) || 0)
  if (n === 0) return 'Zero Rupees Only'
  const crore = Math.floor(n / 10000000); n %= 10000000
  const lakh = Math.floor(n / 100000); n %= 100000
  const thousand = Math.floor(n / 1000); n %= 1000
  const parts = []
  if (crore) parts.push(underThousand(crore) + ' Crore')
  if (lakh) parts.push(underThousand(lakh) + ' Lakh')
  if (thousand) parts.push(underThousand(thousand) + ' Thousand')
  if (n) parts.push(underThousand(n))
  return parts.join(' ') + ' Rupees Only'
}

export function renderSalarySlipHtml(slip, employee, settings) {
  const [y, m] = String(slip.month).split('-').map(Number)
  const calendarDays = new Date(y, m, 0).getDate()
  let workingDays = 0
  for (let d = 1; d <= calendarDays; d++) {
    const dow = new Date(y, m - 1, d).getDay()
    if (dow !== 0 && dow !== 6) workingDays++
  }
  const paidLeaves = Number(slip.paid_leave_days) || 0
  const unpaidLeaves = Number(slip.unpaid_leave_days) || 0
  const leaveDeduction = Number(slip.leave_deduction) || 0

  // Days employed this month (prorated for a mid-month join), less unpaid leave.
  let payableDays = calendarDays
  if (employee.joining_date) {
    const j = new Date(employee.joining_date)
    if (j.getFullYear() === y && j.getMonth() + 1 === m) payableDays = calendarDays - j.getDate() + 1
  }
  const totalPayDays = days(payableDays - unpaidLeaves)

  const base = Number(slip.base_salary) || 0
  const reimb = Number(slip.reimbursement_total) || 0
  const gross = base + reimb
  const tdsPct = Number(slip.tds_percent) || 0
  const tdsAmount = Number(slip.tds_amount) || 0
  const totalDeductions = tdsAmount + leaveDeduction
  const net = Number(slip.net_total) || 0

  const payPeriod = `${MONTH_ABBR[m - 1]}-${String(y).slice(2)}`
  let payDate = ''
  if (slip.payout_date) {
    const p = new Date(slip.payout_date)
    payDate = `${p.getMonth() + 1}/${p.getDate()}/${p.getFullYear()}`
  }
  let doj = ''
  if (employee.joining_date) {
    const j = new Date(employee.joining_date)
    doj = `${String(j.getDate()).padStart(2, '0')} ${MONTH_ABBR[j.getMonth()]} ${j.getFullYear()}`
  }

  const s = settings || {}
  const companyName = (s.company_name || 'Demo Studio LLP').toUpperCase()
  const companyAddressHtml = (s.company_address || '').replace(/\n/g, ', ')
  const companyEmail = s.company_email || ''
  const logoSrc = '/static/logo.jpg'

  const earnRows = [
    ['Basic', money(base), money(base)],
    ['Allowance', money(0), money(0)],
    ['Other Allowance', money(0), money(0)],
    ['Bonus', money(0), money(0)],
  ]
  if (reimb > 0) earnRows.push(['Reimbursements', '', money(reimb)])

  const dedRows = [[`TDS ${tdsPct}%`, money(tdsAmount)]]
  if (unpaidLeaves > 0) {
    dedRows.push([`Unpaid Leave (${days(unpaidLeaves)} day${unpaidLeaves !== 1 ? 's' : ''})`, money(leaveDeduction)])
  }
  const nRows = Math.max(earnRows.length, dedRows.length, 4)
  while (earnRows.length < nRows) earnRows.push(['', '', ''])
  while (dedRows.length < nRows) dedRows.push(['', ''])

  const bodyRows = earnRows.map((e, i) => {
    const d = dedRows[i]
    return `
        <tr>
          <td class="cell">${e[0]}</td>
          <td class="cell num">${e[1]}</td>
          <td class="cell num">${e[2]}</td>
          <td class="cell">${d[0]}</td>
          <td class="cell num">${d[1]}</td>
        </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 14mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }

  .header { display: flex; align-items: flex-start; gap: 18px; margin-bottom: 26px; }
  .logo { width: 96px; height: 96px; object-fit: contain; flex-shrink: 0; }
  .head-right { flex: 1; }
  .company { font-size: 22px; font-weight: bold; color: #287475; letter-spacing: 0.5px;
             border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 6px; }
  .addr { font-size: 12px; line-height: 1.5; }

  .info { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
  .info td { padding: 3px 0; font-size: 12px; vertical-align: top; }
  .info .lbl { width: 16%; }
  .info .val { width: 34%; }

  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.grid td, table.grid th { border: 1px solid #000; padding: 5px 8px; font-size: 12px; }
  table.grid th { text-align: left; font-weight: bold; }
  .num { text-align: right; }
  .days td { text-align: right; }
  .days th { text-align: left; }

  .cell { height: 22px; }
  .row-head td { font-weight: bold; }
  .totals td { font-weight: bold; }

  .netbox { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .netbox td { border: 1px solid #000; padding: 7px 10px; font-size: 12px; }
  .netbox .nlbl { width: 18%; font-weight: bold; }

  .footer { display: flex; justify-content: space-between; margin-top: 60px; }
  .footer .bold { font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <img src="${logoSrc}" class="logo" alt="Logo"/>
    <div class="head-right">
      <div class="company">${esc(companyName)}</div>
      <div class="addr">${companyAddressHtml}<br>Email: ${esc(companyEmail)}</div>
    </div>
  </div>

  <table class="info">
    <tr>
      <td class="lbl">Pay Period</td><td class="val">${payPeriod}</td>
      <td class="lbl">Pay Date</td><td class="val">${payDate}</td>
    </tr>
    <tr>
      <td class="lbl">Name:</td><td class="val">${esc(employee.name || '')}</td>
      <td class="lbl">Bank Name:</td><td class="val">${esc(employee.bank_name || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Designation:</td><td class="val">${esc(employee.designation || '')}</td>
      <td class="lbl">A/C No.:</td><td class="val">${esc(employee.bank_account_number || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Emp DOJ:</td><td class="val">${doj}</td>
      <td class="lbl">IFSC:</td><td class="val">${esc(employee.bank_ifsc_code || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Location:</td><td class="val">${esc(employee.location || '')}</td>
      <td class="lbl">Gender:</td><td class="val">${esc(employee.gender || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Emp PAN:</td><td class="val">${esc(employee.pan_number || '')}</td>
      <td class="lbl"></td><td class="val"></td>
    </tr>
  </table>

  <table class="grid days">
    <tr class="row-head">
      <th>CALENDAR DAYS</th><th>WORKING DAYS</th><th>PAID LEAVES</th>
      <th>UNPAID LEAVES</th><th>TOTAL PAY DAYS</th>
    </tr>
    <tr>
      <td>${calendarDays}</td><td>${workingDays}</td><td>${days(paidLeaves)}</td>
      <td>${days(unpaidLeaves)}</td><td>${totalPayDays}</td>
    </tr>
  </table>

  <table class="grid">
    <tr class="row-head">
      <td>EARNINGS</td><td>RATE</td><td>CURRENT MONTH</td>
      <td>DEDUCTIONS</td><td>CURRENT MONTH</td>
    </tr>
    ${bodyRows}
    <tr class="totals">
      <td>GROSS EARNINGS</td><td></td><td class="num">${money(gross)}</td>
      <td>TOTAL DEDUCTIONS</td><td class="num">${money(totalDeductions)}</td>
    </tr>
  </table>

  <table class="netbox">
    <tr>
      <td class="nlbl">NET PAY (Rs.)</td>
      <td>${money(net)}</td>
    </tr>
  </table>

  <table class="netbox">
    <tr>
      <td class="nlbl">NET PAY (Rs.)<br>(In Words)</td>
      <td>${wordsRupees(net)}</td>
    </tr>
  </table>

  <div class="footer">
    <div>
      <div>Accounts Team</div>
      <div class="bold">${esc(s.company_name || 'Demo Studio LLP')}</div>
    </div>
    <div class="bold" style="align-self: flex-end;">Employee Signature</div>
  </div>
</body>
</html>`
}
