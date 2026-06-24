import type { ModerationDecision } from './types'

export const DEFAULT_BLOCK_REPLY =
    '服务安全策略阻止了对有关提示词的响应。若有疑义，请联系管理员。'

export const DEFAULT_ALLOW_DECISION: ModerationDecision = {
    action: 'allow',
    labels: [],
    reasons: [],
    confidence: 1,
    severity: 0,
    riskScore: 0
}

export const DEFAULT_REVIEW_DECISION: ModerationDecision = {
    action: 'review',
    labels: [],
    reasons: [],
    confidence: 0,
    severity: 1,
    riskScore: 25
}
