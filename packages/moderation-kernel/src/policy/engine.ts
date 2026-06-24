import { DEFAULT_ALLOW_DECISION, DEFAULT_BLOCK_REPLY } from '../constants'
import type {
    ModerationDecision,
    ModerationRequest,
    UserRiskState
} from '../types'
import { normalizeDecision } from '../types'
import { addSeverityScore, clampRiskScore } from './scoring'
import { DEFAULT_KEYWORD_RULES } from './rules'

export function evaluateLocalRules(
    req: ModerationRequest,
    state: UserRiskState
): ModerationDecision {
    const text = req.contentText ?? ''
    const rule = DEFAULT_KEYWORD_RULES.find((item) => item.pattern.test(text))

    if (!rule) {
        return normalizeDecision({
            ...DEFAULT_ALLOW_DECISION,
            riskScore: clampRiskScore(state.trustScore)
        })
    }

    const riskScore = addSeverityScore(state.trustScore, rule.severity)

    return normalizeDecision({
        action: rule.action,
        labels: rule.labels,
        reasons: [rule.id],
        confidence: rule.confidence,
        severity: rule.severity,
        riskScore,
        fixedReply: rule.action === 'block' ? DEFAULT_BLOCK_REPLY : undefined
    })
}
