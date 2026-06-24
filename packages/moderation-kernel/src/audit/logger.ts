import { createHash } from 'node:crypto'
import type { Context } from 'koishi'
import type { MODERATION_LOG_EVENTS } from '../constants'
import type { ModerationDecision, ModerationRequest } from '../types'

export type ModerationLogEvent = (typeof MODERATION_LOG_EVENTS)[number]

interface LogOptions {
    eventId?: string
    shadowMode?: boolean
    count?: number
}

function hashUserKey(userKey: string) {
    return createHash('sha256').update(userKey).digest('hex').slice(0, 16)
}

export function logModerationEvent(
    ctx: Context,
    event: ModerationLogEvent,
    req: Pick<ModerationRequest, 'stage' | 'userKey'>,
    decision: Pick<
        ModerationDecision,
        'action' | 'labels' | 'severity' | 'confidence' | 'riskScore'
    >,
    opts: LogOptions = {}
) {
    ctx.logger.info(
        JSON.stringify({
            event,
            stage: req.stage,
            action: decision.action,
            labels: decision.labels,
            severity: decision.severity,
            confidence: decision.confidence,
            riskScore: decision.riskScore,
            userKeyHash: hashUserKey(req.userKey),
            eventId: opts.eventId,
            shadowMode: opts.shadowMode,
            count: opts.count
        })
    )
}
