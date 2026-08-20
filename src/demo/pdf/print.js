// Isolated print: render a standalone HTML document into a hidden iframe and
// print THAT frame — never window.print() on the SPA, which would drag the app
// chrome and Tailwind's reset into the output. The templates carry their own
// @page/A4 rules, so the browser's print engine reproduces what WeasyPrint
// produced server-side (Chrome's engine is a superset of WeasyPrint's).
export function printDoc(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(iframe)

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        resolve()
      }, 1000)
    }

    iframe.onload = () => {
      try {
        iframe.contentWindow.focus()
        // Give images (the logo) a moment to decode before printing.
        setTimeout(() => {
          iframe.contentWindow.print()
          cleanup()
        }, 250)
      } catch {
        cleanup()
      }
    }

    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(html)
    doc.close()
  })
}

// Print several standalone documents as one job by concatenating their bodies
// with a hard page break between them (the monthly invoice export).
export function printMany(htmlDocs) {
  if (!htmlDocs.length) return Promise.resolve()
  if (htmlDocs.length === 1) return printDoc(htmlDocs[0])

  // Take the first doc's <head> (shared CSS) and stack every <body>.
  const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(htmlDocs[0])
  const head = headMatch ? headMatch[1] : ''
  const bodies = htmlDocs.map((h) => {
    const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(h)
    return m ? m[1] : h
  })
  const combined = `<!DOCTYPE html><html><head>${head}
<style>.__page-break { page-break-after: always; break-after: page; }</style>
</head><body>${bodies
    .map((b, i) => `<div class="${i < bodies.length - 1 ? '__page-break' : ''}">${b}</div>`)
    .join('')}</body></html>`
  return printDoc(combined)
}
