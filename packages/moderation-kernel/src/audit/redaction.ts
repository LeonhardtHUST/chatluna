export function redactEvidence(text: string): string {
    const clean = text.trim().replace(/\s+/g, ' ')

    if (clean.length === 0) {
        return '[redacted:empty]'
    }

    return `[redacted:length=${clean.length}]`
}
