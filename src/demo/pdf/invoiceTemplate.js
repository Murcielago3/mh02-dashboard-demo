// Port of the backend's render_invoice_html(). Same fixed-mm layout maths and
// the same CSS, so the printed page matches the production PDF. Logo is loaded
// same-origin from /static/logo.jpg (public/static in the demo).
import {
  formatIndianCurrency, numberToWords, cleanPlaceOfSupply,
  formattedInvoiceNumber, fmtRate, ddmmyyyy, esc, nl2br,
} from './format'

export function renderInvoiceHtml(invoice, items, bank, settings) {
  const breakdown = invoice.tax_breakdown || []
  const numBrackets = breakdown.length
  const rowsPerBracket = invoice.tax_type === 'CGST_SGST' ? 2 : 1
  const baseTaxRows = invoice.tax_type === 'CGST_SGST' ? 2 : 1
  const renderedTaxRows = numBrackets > 1 ? numBrackets * rowsPerBracket : baseTaxRows
  const extraTaxRows = Math.max(0, renderedTaxRows - baseTaxRows)

  // A4 printable area with 8mm margins = 194mm x 281mm; every band has a fixed
  // mm height and the items area absorbs the remainder = always one page.
  const HEADER_H = 32
  const DATE_ROW_H = 8
  const BILLSHIP_H = 26
  const SUBJECT_H = 9
  const ITEMS_THEAD_H = 7
  const FOOTER_H = 36 + extraTaxRows * 4
  const TC_H = 13
  const SIG_H = 26
  const PRINTABLE_H = 265
  const ITEMS_AREA_H = PRINTABLE_H - (HEADER_H + DATE_ROW_H + BILLSHIP_H + SUBJECT_H + FOOTER_H + TC_H + SIG_H)
  const numItems = items.length
  const ITEMS_ROWS_AREA_H = ITEMS_AREA_H - ITEMS_THEAD_H
  const MIN_ROW_H = 11.0
  const MAX_ROW_H = 18.0
  const ITEMS_ROW_H = numItems > 0
    ? Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, ITEMS_ROWS_AREA_H / numItems))
    : MAX_ROW_H
  const spacerHeight = Math.max(0, ITEMS_ROWS_AREA_H - numItems * ITEMS_ROW_H)

  const base = 'padding:5px 6px; font-size:11px; border-top:1px solid #000 !important;'
  const itemsRows = items.map((item, i) => `
          <tr class="items-row" style="height:${ITEMS_ROW_H}mm;">
            <td class="col-num" style="${base} border-right:1px solid #000 !important;">${i + 1}</td>
            <td style="${base} border-right:1px solid #000 !important;">${esc(item.description)}</td>
            <td style="${base} border-right:1px solid #000 !important;">${esc(item.hsn_sac || '')}</td>
            <td style="${base} text-align:right;">₹${formatIndianCurrency(Number(item.amount))}</td>
          </tr>`).join('')

  const bankHtml = bank ? `
        <tr><td class="bank-label">Bank Name</td><td>${esc(bank.bank_name)}</td></tr>
        <tr><td class="bank-label">Account Holder Name</td><td>${esc(bank.account_holder_name)}</td></tr>
        <tr><td class="bank-label">Account Number</td><td>${esc(bank.account_number)}</td></tr>
        <tr><td class="bank-label">IFSC Code</td><td>${esc(bank.ifsc_code)}</td></tr>
        ` : ''

  const invoiceTypeLabel = invoice.invoice_type === 'tax' ? 'TAX INVOICE' : 'PROFORMA INVOICE'
  const formattedNum = formattedInvoiceNumber(invoice)
  const invoiceNumberHtml = formattedNum ? `<div class="invoice-num">#${formattedNum}</div>` : ''

  let taxRows
  if (numBrackets <= 1) {
    const rate = numBrackets ? breakdown[0].rate : 18
    taxRows = invoice.tax_type === 'CGST_SGST'
      ? `<tr><td class="tot-label">CGST(${fmtRate(rate / 2)}%)</td><td class="tot-val">₹${formatIndianCurrency(Number(invoice.cgst))}</td></tr>
         <tr><td class="tot-label">SGST(${fmtRate(rate / 2)}%)</td><td class="tot-val">₹${formatIndianCurrency(Number(invoice.sgst))}</td></tr>`
      : `<tr><td class="tot-label">IGST(${fmtRate(rate)}%)</td><td class="tot-val">₹${formatIndianCurrency(Number(invoice.igst))}</td></tr>`
  } else {
    taxRows = breakdown.map((b) => {
      const taxable = formatIndianCurrency(Number(b.taxable_value))
      return invoice.tax_type === 'CGST_SGST'
        ? `<tr><td class="tot-label">CGST(${fmtRate(b.rate / 2)}%) on ₹${taxable}</td><td class="tot-val">₹${formatIndianCurrency(Number(b.cgst))}</td></tr>
           <tr><td class="tot-label">SGST(${fmtRate(b.rate / 2)}%) on ₹${taxable}</td><td class="tot-val">₹${formatIndianCurrency(Number(b.sgst))}</td></tr>`
        : `<tr><td class="tot-label">IGST(${fmtRate(b.rate)}%) on ₹${taxable}</td><td class="tot-val">₹${formatIndianCurrency(Number(b.igst))}</td></tr>`
    }).join('')
  }

  let billToTaxId = ''
  if (invoice.customer_type === 'individual' && invoice.bill_to_pan) billToTaxId = `<br>PAN ${esc(invoice.bill_to_pan)}`
  else if (invoice.bill_to_gstin) billToTaxId = `<br>GSTIN ${esc(invoice.bill_to_gstin)}`

  const subtotal = Number(invoice.subtotal) || 0
  const total = Number(invoice.total) || 0
  const totalWords = numberToWords(total)
  const dateStr = ddmmyyyy(invoice.invoice_date)
  const subjectVal = esc(invoice.subject || '')

  const s = settings || {}
  const companyName = s.company_name || 'Demo Studio LLP'
  const companyAddress = s.company_address || ''
  const companyGstin = s.company_gstin || ''
  const companyPhone = s.company_phone || ''
  const companyEmail = s.company_email || ''
  const signatoryName = s.company_signatory_name || ''
  const signatoryRole = s.company_signatory_role || ''
  const companyAddressHtml = nl2br(companyAddress)
  const logoSrc = '/static/logo.jpg'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: Arial, sans-serif;
    font-size: 7px;
    color: #000;
    line-height: 1.25;
    width: 194mm;
    height: 281mm;
    max-height: 281mm;
    overflow: hidden;
  }
  .sheet {
    width: 100%; height: 100%; max-height: 281mm; overflow: hidden;
    border-collapse: collapse; table-layout: fixed; page-break-inside: avoid;
    border: 1px solid #000;
  }
  .sheet > tbody > tr > td { border: 1px solid #000; vertical-align: top; }
  .inner, .inner td, .inner th, .bank-tbl, .bank-tbl td, .totals-tbl, .totals-tbl td { border: 0 !important; }
  .inner { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
  .inner td { vertical-align: top; padding: 0; }

  .hdr-left { width: 60%; padding: 5mm !important; vertical-align: middle !important; }
  .hdr-right { width: 40%; padding: 5mm 8mm 5mm 5mm !important; vertical-align: middle !important; text-align: right; }
  .logo-img { width: 80px; height: 80px; object-fit: contain; display: block; }
  .firm-name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
  .firm-details { font-size: 9.5px; line-height: 1.4; color: #222; }
  .invoice-type { font-size: 18px; font-weight: bold; letter-spacing: 0.6px; }
  .invoice-num { font-size: 11px; margin-top: 4px; color: #333; }
  .subject-line { font-size: 9.5px; }

  .meta-label { font-size: 8.5px; color: #555; margin-bottom: 2px; }
  .meta-val-bold { font-weight: bold; font-size: 10.5px; margin-bottom: 2px; }
  .meta-val { font-size: 10.5px; font-weight: 600; }

  .items-head td { background: #f5f5f5; padding: 5px 6px; font-size: 7px; font-weight: 600; }
  .items-row td { padding: 5px 6px; font-size: 7px; }
  .col-num { width: 32px; text-align: center; }
  .col-hsn { width: 85px; }
  .col-amt { width: 110px; text-align: right; }

  .foot-left { width: 55%; padding: 8px 10px; }
  .foot-right { width: 45%; padding: 8px 10px; }
  .bank-tbl td { padding: 2px 0; font-size: 10.5px; }
  .bank-label { width: 150px; color: #444; font-weight: 600; }
  .totals-tbl td { padding: 3px 6px; font-size: 10.5px; }
  .tot-val { text-align: right; }
  .total-final td { font-weight: bold; font-size: 11.5px; border-top: 1.5px solid #000 !important; padding-top: 5px; }
  .words-section { margin-top: 8px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 10px; font-style: italic; color: #333; }
  .words-label { font-weight: bold; font-style: normal; margin-bottom: 2px; }

  .tc-cell { padding: 6px 10px; font-size: 9.5px; line-height: 1.4; }
  .tc-label { font-weight: bold; font-size: 10.5px; margin-bottom: 3px; }
  .sig-cell { padding: 8px 10px; font-size: 10.5px; }
  .sig-name { font-weight: bold; font-size: 11.5px; margin-top: 12mm; }
  .sig-role { color: #444; margin-top: 2px; }
  .auth-label { font-size: 9.5px; color: #555; }
</style>
</head>
<body>
<table class="sheet">
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tbody>
    <tr style="height:${HEADER_H}mm;">
      <td colspan="2" style="padding:0;">
        <table class="inner"><tr>
          <td class="hdr-left">
            <table style="border-collapse:collapse;"><tr>
              <td style="vertical-align:middle; padding-right:10px;">
                <img src="${logoSrc}" class="logo-img" alt="Logo"/>
              </td>
              <td style="vertical-align:middle;">
                <div class="firm-name">${esc(companyName)}</div>
                <div class="firm-details">
                  ${companyAddressHtml}<br>
                  ${esc(companyPhone)} | ${esc(companyEmail)}<br>
                  GSTIN ${esc(companyGstin)}
                </div>
              </td>
            </tr></table>
          </td>
          <td class="hdr-right">
            <div class="invoice-type">${invoiceTypeLabel}</div>
            ${invoiceNumberHtml}
          </td>
        </tr></table>
      </td>
    </tr>
    <tr style="height:${DATE_ROW_H}mm;">
      <td style="padding:5px 8px;">
        <span class="meta-label">Invoice Date:</span> <span class="meta-val">${dateStr}</span>
      </td>
      <td style="padding:5px 8px;">
        <span class="meta-label">Place of Supply:</span> <span class="meta-val">${esc(cleanPlaceOfSupply(invoice.place_of_supply))}</span>
      </td>
    </tr>
    <tr style="height:${BILLSHIP_H}mm;">
      <td style="padding:5px 8px;">
        <div style="max-height:${BILLSHIP_H - 1}mm; overflow:hidden;">
        <div class="meta-label">Bill To</div>
        <div class="meta-val-bold">${esc(invoice.bill_to_name || '')}</div>
        <div style="font-size:10.5px; line-height:1.4; margin-top:2px;">
          ${nl2br(invoice.bill_to_address || '')}
          ${billToTaxId}
        </div>
        </div>
      </td>
      <td style="padding:5px 8px;">
        <div style="max-height:${BILLSHIP_H - 1}mm; overflow:hidden;">
        <div class="meta-label">Ship To</div>
        <div class="meta-val-bold">${esc(invoice.ship_to_name || '')}</div>
        <div style="font-size:10.5px; line-height:1.4; margin-top:2px;">
          ${nl2br(invoice.ship_to_address || '')}
          ${invoice.ship_to_gstin ? '<br>GSTIN ' + esc(invoice.ship_to_gstin) : ''}
        </div>
        </div>
      </td>
    </tr>
    <tr style="height:${SUBJECT_H}mm;">
      <td colspan="2" class="subject-line" style="padding:5px 8px;">
        <div style="max-height:${SUBJECT_H - 2}mm; overflow:hidden;">
          <span class="meta-label" style="font-size:10.5px;">Subject:</span> ${subjectVal}
        </div>
      </td>
    </tr>
    <tr style="height:${ITEMS_AREA_H}mm;">
      <td colspan="2" style="padding:0; height:${ITEMS_AREA_H}mm;">
        <div style="height:${ITEMS_AREA_H}mm; overflow:hidden;">
        <table class="inner" style="border-collapse:collapse; height:auto;">
          <colgroup><col style="width:32px"><col><col style="width:85px"><col style="width:110px"></colgroup>
          <tr class="items-head" style="height:${ITEMS_THEAD_H}mm;">
            <td class="col-num" style="border-right:1px solid #000 !important;">#</td>
            <td style="padding:5px 6px; border-right:1px solid #000 !important;">Service / Description</td>
            <td style="padding-left:6px; border-right:1px solid #000 !important;">HSN/SAC</td>
            <td style="padding-right:6px; text-align:right;">Amount</td>
          </tr>
          ${itemsRows}
          <tr style="height:${spacerHeight}mm;">
            <td style="border-right:1px solid #000 !important;"></td>
            <td style="border-right:1px solid #000 !important;"></td>
            <td style="border-right:1px solid #000 !important;"></td>
            <td></td>
          </tr>
        </table>
        </div>
      </td>
    </tr>
    <tr style="height:${FOOTER_H}mm;">
      <td class="foot-left">
        <table class="bank-tbl" style="border-collapse:collapse;">${bankHtml}</table>
      </td>
      <td class="foot-right">
        <table class="totals-tbl" style="width:100%; border-collapse:collapse;">
          <tr>
            <td>Sub Total</td>
            <td class="tot-val">₹${formatIndianCurrency(subtotal)}</td>
          </tr>
          ${taxRows}
          <tr class="total-final">
            <td>Total</td>
            <td class="tot-val">₹${formatIndianCurrency(total)}</td>
          </tr>
        </table>
        <div class="words-section">
          <div class="words-label">Total in Words</div>
          ${totalWords}
        </div>
      </td>
    </tr>
    <tr style="height:${TC_H}mm;">
      <td colspan="2" class="tc-cell">
        <div class="tc-label">Terms &amp; Conditions</div>
        Kindly Process the payment to the bank details given below or in cheque.
        You are requested to revert in 7 days, in order to seek clarity on this
        invoice. Please process the payment within 30 days from the date of
        receiving this order to avoid further charges.
      </td>
    </tr>
    <tr style="height:${SIG_H}mm;">
      <td colspan="2" class="sig-cell">
        <div class="auth-label">Authorized Signatory</div>
        <div class="sig-name">${esc(signatoryName)}</div>
        <div class="sig-role">${esc(signatoryRole)}</div>
        <div class="sig-role">${esc(companyName)}</div>
      </td>
    </tr>
  </tbody>
</table>
</body></html>`
}
