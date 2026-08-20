import { API_BASE_URL } from '../api/client'

/** Document logo (invoices, salary slips, and the on-screen invoice preview).
 *  Served from the backend so it matches the server-rendered PDFs. */
export function getAppLogoUrl() {
  return `${API_BASE_URL.replace(/\/$/, '')}/static/logo.jpg`
}

/** Brand logo for the website chrome (sidebar, login). Static frontend asset. */
export function getBrandLogoUrl() {
  return '/MH02-Tech-Logo.png'
}
