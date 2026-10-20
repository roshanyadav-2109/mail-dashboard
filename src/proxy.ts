export { auth as proxy } from '@/auth'

// Public: login, Auth.js routes, unsubscribe pages/links, and the SNS webhook (it verifies its own signature).
export const config = {
  matcher: ['/((?!api/auth|api/ses|api/unsubscribe|api/cron|api/subscribe|subscribe|unsubscribe|preferences|login|fonts|_next|favicon.ico).*)'],
}
