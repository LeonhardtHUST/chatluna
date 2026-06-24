import type { ModerationEventRow } from '../storage/model'

export function formatEventCase(
    event: ModerationEventRow | undefined,
    showRaw: boolean = false
) {
    if (!event) {
        return 'Moderation case not found.'
    }

    const raw =
        showRaw && event.rawText != null
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
