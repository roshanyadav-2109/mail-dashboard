import { createVerify } from 'crypto'

export type SnsMessage = Record<string, string> & { Type: string; SignatureVersion: string; Signature: string; SigningCertURL: string }

const FIELDS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}

const AWS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

/** True when the URL is an https SNS host, so we never fetch an attacker-chosen address. */
export function isSnsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && AWS_HOST.test(url.hostname)
  } catch {
    return false
  }
}

/** Verifies the signature SNS puts on every message, using Amazon's signing certificate. */
export async function verifySns(msg: SnsMessage): Promise<boolean> {
  const fields = FIELDS[msg.Type]
  if (!fields || !isSnsUrl(msg.SigningCertURL)) return false
  const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256' : msg.SignatureVersion === '1' ? 'RSA-SHA1' : null
  if (!algorithm) return false

  const toSign = fields
    .filter((name) => msg[name] !== undefined)
    .map((name) => `${name}\n${msg[name]}\n`)
    .join('')

  const cert = await (await fetch(msg.SigningCertURL)).text()
  return createVerify(algorithm).update(toSign, 'utf8').verify(cert, msg.Signature, 'base64')
}
