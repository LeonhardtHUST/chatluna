interface SearchResultLike {
    title: string
    description: string
    url: string
}

interface CompressionReference {
    id?: number
    title?: string
    url?: string
}

interface CompressionKeyPoint {
    claim?: string
    source_ids?: number[]
}

interface CompressionPayload {
    status?: string
    summary?: string
    key_points?: CompressionKeyPoint[]
    references?: CompressionReference[]
    warnings?: string[]
}

export function formatSearchResultsForContext(results: SearchResultLike[]) {
    return results
        .map((result, index) =>
            [
                `source_id: ${index + 1}`,
                `title: ${result.title}`,
                `description: ${result.description}`,
                `url: ${result.url}`
            ].join('\n')
        )
        .join('\n\n')
}

export function formatCompressedContext(
    compressed: string,
    fallbackResults: SearchResultLike[]
) {
    const payload = parseCompressionPayload(compressed)

    if (payload == null) {
        return normalizeReferencesMarkdown(compressed)
    }

    if (payload.status === 'empty') {
        return ''
    }

    const references =
        payload.references?.filter((item) => item.title && item.url) ?? []
    const lines: string[] = []

    if (payload.summary?.trim()) {
        lines.push(payload.summary.trim())
    }

    for (const item of payload.key_points ?? []) {
        if (!item.claim?.trim()) continue

        const citations = (item.source_ids ?? [])
            .filter((id) => Number.isInteger(id) && id > 0)
            .map((id) => `[^${id}]`)
            .join('')

        lines.push(`- ${item.claim.trim()}${citations}`)
    }

    if (payload.warnings?.length) {
        lines.push(
            ...payload.warnings
                .filter((item) => item.trim().length > 0)
                .map((item) => `- warning: ${item.trim()}`)
        )
    }

    const refs =
        references.length > 0 ? references : fallbackReferences(fallbackResults)

    if (refs.length > 0) {
        lines.push('', '## References', '')
        lines.push(...refs.map(formatReferenceLine))
    }

    return normalizeReferencesMarkdown(lines.join('\n'))
}

export function normalizeReferencesMarkdown(text: string) {
    const refs = new Map<string, { title: string; url: string }>()
    let result = text
        .replace(/<\/?p>/gi, '\n')
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(
            /\^(\d+)\s*\(\s*\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)\s*\)/g,
            (_match, id: string, title: string, url: string) => {
                refs.set(id, {
                    title: title.trim(),
                    url: url.trim()
                })
                return `[^${id}]`
            }
        )
        .replace(/\s*(\[\^\d+\]:)/g, '\n$1')
        .replace(/(^|\n)References(?=\[\^\d+\]:)/gi, '$1## References\n')
        .replace(/(^|\n)References\s*$/gim, '$1## References')
        .replace(
            /^\[\^(\d+)\]:\s*\[?([^\]\[(\n]+)\]?\s*\((https?:\/\/[^)\s]+)\)\s*$/gim,
            (_match, id: string, title: string, url: string) =>
                `[^${id}]: [${title.trim()}](${url.trim()})`
        )

    const existing = new Set(
        Array.from(result.matchAll(/^\[\^(\d+)\]:/gim)).map((item) => item[1])
    )
    const missing = Array.from(refs.entries()).filter(
        ([id]) => !existing.has(id)
    )

    if (missing.length > 0) {
        if (!/^## References\s*$/gim.test(result)) {
            result += '\n\n## References'
        }

        result +=
            '\n' +
            missing
                .map(
                    ([id, item]) =>
                        `[^${id}]: [${item.title.trim()}](${item.url.trim()})`
                )
                .join('\n')
    }

    return result.replace(/\n{3,}/g, '\n\n').trim()
}

function parseCompressionPayload(text: string): CompressionPayload | undefined {
    const clean = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/u, '')

    try {
        return JSON.parse(clean) as CompressionPayload
    } catch {
        return undefined
    }
}

function fallbackReferences(
    results: SearchResultLike[]
): CompressionReference[] {
    return results.map((item, index) => ({
        id: index + 1,
        title: item.title,
        url: item.url
    }))
}

function formatReferenceLine(item: CompressionReference, index: number) {
    const id = item.id != null && item.id > 0 ? item.id : index + 1
    const title = (item.title ?? `source ${id}`).replace(/[\[\]\n\r]/g, ' ')
    const url = item.url ?? ''

    return `[^${id}]: [${title.trim()}](${url.trim()})`
}
