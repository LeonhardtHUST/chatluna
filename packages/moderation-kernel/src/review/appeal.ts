import type { ModerationEventRow } from '../storage/model'

interface EventCaseOptions {
    raw?: boolean
    storeRawTextForAppeal?: boolean
    now?: Date
}

export function formatEventCase(
    event: ModerationEventRow | undefined,
    opts: EventCaseOptions = {}
) {
    if (!event) {
        return 'Moderation case not found.'
    }

    const now = opts.now ?? new Date()
    const showRaw =
        opts.raw === true &&
        opts.storeRawTextForAppeal === true &&
        event.rawText != null &&
        (event.expireAt == null || event.expireAt.getTime() > now.getTime())
    const raw = showRaw
        ? `\nrawText: ${event.rawText}`
        : event.rawText == null
          ? '\nrawText: [hidden or expired]'
          : '\nrawText: [hidden]'

    return [
        `eventId: ${event.id}`,
        `userId: ${event.userId}`,
        `stage: ${event.stage}`,
        `action: ${event.action}`,
        `labels: ${event.labels.join(', ')}`,
        `reasons: ${event.reasons.join(', ')}`,
        `severity: ${event.severity}`,
        `riskScore: ${event.riskScore}`,
        `evidenceHash: ${event.evidenceHash}`,
        `createdAt: ${event.createdAt.toISOString()}${raw}`
    ].join('\n')
}
