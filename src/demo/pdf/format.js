// Ports of the backend's currency/number helpers used by the PDF templates.

// Indian digit grouping: 531000 -> "5,31,000.00"
export function formatIndianCurrency(amount, decimals = 2) {
  const n = Number(amount) || 0
  const neg = n < 0
  const fixed = Math.abs(n).toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  let out
  if (intPart.length <= 3) {
    out = intPart
  } else {
    const last3 = intPart.slice(-3)
    const rest = intPart.slice(0, -3)
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
  }
  return (neg ? '-' : '') + out + (decPart ? '.' + decPart : '')
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function underThousand(n) {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + underThousand(n % 100) : '')
}

// "Indian Rupee One Lakh Twenty Thousand Only"
export function numberToWords(amount) {
  let n = Math.floor(Number(amount) || 0)
  if (n === 0) return 'Zero Rupees Only'
  const crore = Math.floor(n / 10000000); n %= 10000000
  const lakh = Math.floor(n / 100000); n %= 100000
  const thousand = Math.floor(n / 1000); n %= 1000
  const rest = n
  const parts = []
  if (crore) parts.push(underThousand(crore) + ' Crore')
  if (lakh) parts.push(underThousand(lakh) + ' Lakh')
  if (thousand) parts.push(underThousand(thousand) + ' Thousand')
  if (rest) parts.push(underThousand(rest))
  return 'Indian Rupee ' + parts.join(' ') + ' Only'
}

export function cleanPlaceOfSupply(val) {
  if (!val) return ''
  return String(val).replace(/^\d+\s*-\s*|^\d+\s+|\s*\(\d+\)\s*$/g, '').trim()
}

export function formattedInvoiceNumber(invoice) {
  const numStr = invoice.invoice_number
  if (!numStr) return `AO - ${String(invoice.id).padStart(3, '0')}`
  const digits = String(numStr).match(/\d+/g)
  if (digits && digits.length) {
    return `AO - ${String(Number(digits[digits.length - 1])).padStart(3, '0')}`
  }
  return `AO - ${String(numStr).replace('AO-', '').replace('AO -', '').trim()}`
}

export const fmtRate = (r) => String(Number(r))

export function ddmmyyyy(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d)) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export const esc = (s) => String(s ?? '')
export const nl2br = (s) => String(s ?? '').replace(/\n/g, '<br>')
