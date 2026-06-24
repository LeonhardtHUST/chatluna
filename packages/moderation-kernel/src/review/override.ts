import type { ModerationService } from '../service'
import type { ModerationAction, UserRiskState } from '../types'

export async function recordUserStateOverride(
    service: ModerationService,
    userKey: string,
    patch: Partial<UserRiskState>,
    operator: string,
    note: string
) {
    await service.setUserRiskState(userKey, patch, operator)

    const event = await service.repository.recordEvent(
        {
            stage: 'appeal-replay',
            userKey,
            contentText: '',
            metadata: {
                platform: 'admin'
            }
        },
        {
            action: 'review',
            labels: ['admin_override'],
            reasons: [note],
            confidence: 1,
            severity: 0,
            riskScore: patch.trustScore ?? 0
        },
        {
            operator
        }
    )

    return service.repository.createReview(
        event.id,
        'user-state',
        operator,
        note
    )
}

export function recordManualOverride(
    service: ModerationService,
    eventId: string,
    action: ModerationAction,
    operator: string,
    reason?: string
) {
    return service.recordOverride(eventId, action, operator, reason)
}
