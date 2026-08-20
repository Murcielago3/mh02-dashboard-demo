// A drop-in replacement for the app's axios instance. Every api/*.js module
// calls client.get/post/patch/delete('/path', body?, config?) and reads res.data.
// We match the path against a handler registry backed by the in-memory db and
// resolve an axios-shaped response. Nothing in the views changes.

const routes = [] // { method, segs, handler }

// Register a route. Pattern uses :name for path params, e.g. '/projects/:id'.
export function route(method, pattern, handler) {
  const segs = pattern.split('/').filter(Boolean).map((s) =>
    s.startsWith(':') ? { param: s.slice(1) } : { lit: s }
  )
  routes.push({ method: method.toUpperCase(), segs, handler })
}

function matchRoute(method, path) {
  const parts = path.split('/').filter(Boolean)
  let best = null
  let bestScore = -1
  for (const r of routes) {
    if (r.method !== method) continue
    if (r.segs.length !== parts.length) continue
    const params = {}
    let ok = true
    let score = 0
    for (let i = 0; i < r.segs.length; i++) {
      const seg = r.segs[i]
      if (seg.lit != null) {
        if (seg.lit !== parts[i]) { ok = false; break }
        score += 2 // literal match beats a param match
      } else {
        params[seg.param] = decodeURIComponent(parts[i])
      }
    }
    if (ok && score > bestScore) { best = { handler: r.handler, params }; bestScore = score }
  }
  return best
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function dispatch(method, url, body, config = {}) {
  // Split any inline query string; merge with config.params.
  const [rawPath, rawQuery] = String(url).split('?')
  const path = rawPath.replace(/\/+$/, '') || '/' // tolerate trailing slash
  const query = { ...(config.params || {}) }
  if (rawQuery) {
    new URLSearchParams(rawQuery).forEach((v, k) => { query[k] = v })
  }

  const m = matchRoute(method, path) || matchRoute(method, path + '/')
  await delay(40) // a touch of latency so spinners/optimistic UI behave normally

  if (!m) {
    // Unimplemented endpoint: log once and return an empty-ish payload so the
    // view degrades gracefully instead of throwing.
    console.warn(`[demo] no handler for ${method} ${path}`)
    return { data: [], status: 200, headers: {}, config }
  }

  try {
    const ctx = { params: m.params, query, body: body ?? {}, config }
    const result = await m.handler(ctx)
    if (result && result.__raw) {
      // Handler wants full control of the response (blobs, headers, etc.)
      return { status: 200, headers: {}, config, ...result.__raw }
    }
    return { data: result, status: 200, headers: {}, config }
  } catch (err) {
    const status = err.status || 400
    const detail = err.detail || err.message || 'Request failed'
    const axiosErr = new Error(detail)
    axiosErr.response = { status, data: { detail } }
    axiosErr.config = config
    throw axiosErr
  }
}

// Throwable used inside handlers for 4xx flows the UI expects.
export function httpError(status, detail) {
  return { status, detail }
}

const client = {
  get: (url, config) => dispatch('GET', url, undefined, config),
  delete: (url, config) => dispatch('DELETE', url, undefined, config),
  post: (url, body, config) => dispatch('POST', url, body, config),
  put: (url, body, config) => dispatch('PUT', url, body, config),
  patch: (url, body, config) => dispatch('PATCH', url, body, config),
}

// Relative base so users.js resolveFileUrl() and utils/logo.js resolve
// same-origin (/static/logo.jpg lives in public/static for the demo).
export const API_BASE_URL = ''

export default client
