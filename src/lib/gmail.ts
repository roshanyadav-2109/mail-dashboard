// Opens Gmail's compose window for the desk@ mailbox (a new tab). Sent through Google, so it uses no AWS credit.
export function gmailCompose(from: string, to: string, subject = '', body = '') {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  if (from) p.set('authuser', from)
  return `https://mail.google.com/mail/?${p}`
}
