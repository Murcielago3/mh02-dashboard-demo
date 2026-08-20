// DEMO BUILD: the real axios client is replaced by an in-memory mock router.
// Every api/*.js module imports this default `client` and calls .get/.post/etc,
// so swapping this one file redirects the whole app to the local seeded store
// with zero changes to the api modules or the views.
import client, { API_BASE_URL } from '../demo/mockClient'
import '../demo/handlers' // side-effect: registers all route handlers

export { API_BASE_URL }
export default client
