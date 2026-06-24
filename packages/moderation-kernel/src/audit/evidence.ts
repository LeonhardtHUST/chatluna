import { createHash } from 'node:crypto'

export function hashEvidence(text: string, salt: string = ''): string {
    return createHash('sha256')
        .update(`${salt}:${text.trim().replace(/\s+/g, ' ')}`)
        .digest('hex')
}
