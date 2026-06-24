export function redactEvidence(text: string): string {
    const clean = text.trim().replace(/\s+/g, ' ')

    if (clean.length === 0) {
        return '[redacted:0]'
    }

    if (clean.length <= 8) {
        return `[redacted:${clean.length}]`
    }

    return `${clean.slice(0, 2)}[redacted:${clean.length}]${clean.slice(-2)}`
}
