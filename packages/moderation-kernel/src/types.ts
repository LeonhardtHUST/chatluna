export type ModerationStage =
    | 'input'
    | 'pre-search'
    | 'tool-args'
    | 'output'
    | 'appeal-replay'

export type ModerationAction =
    | 'allow'
    | 'review'
    | 'rewrite'
    | 'block'
    | 'suspend'

export type ModerationSeverity = 0 | 1 | 2 | 3 | 4 | 5

export type ModerationUserState =
    | 'normal'
    | 'watch'
    | 'restricted'
    | 'suspended'

export interface ModerationRequest {
    stage: ModerationStage
    session?: unknown
    userKey: string
    channelKey?: string
    conversationId?: string
    contentText?: string
    contentElements?: unknown[]
    metadata?: Record<string, unknown>
}

export interface ModerationDecision {
    action: ModerationAction
    labels: string[]
    reasons: string[]
    confidence: number
    severity: ModerationSeverity
    riskScore: number
    transformedText?: string
    transformedElements?: unknown[]
    fixedReply?: string
    eventId?: string
}

export interface UserRiskState {
    userKey: string
    trustScore: number
    reviewLevel: 0 | 1 | 2 | 3
    state: ModerationUserState
    strikeCount: number
    lastEventAt?: number
}

export function isBlockingDecision(decision: ModerationDecision) {
    return decision.action === 'block' || decision.action === 'suspend'
}

export function isReviewDecision(decision: ModerationDecision) {
    return decision.action === 'review'
}

export function normalizeDecision(
    decision: Partial<ModerationDecision>
): ModerationDecision {
    return {
        action: decision.action ?? 'allow',
        labels: decision.labels ?? [],
        reasons: decision.reasons ?? [],
        confidence: Math.min(1, Math.max(0, decision.confidence ?? 0)),
        severity: Math.min(
            5,
            Math.max(0, Math.round(decision.severity ?? 0))
        ) as ModerationSeverity,
        riskScore: Math.min(100, Math.max(0, decision.riskScore ?? 0)),
        transformedText: decision.transformedText,
        transformedElements: decision.transformedElements,
        fixedReply: decision.fixedReply,
        eventId: decision.eventId
    }
}
