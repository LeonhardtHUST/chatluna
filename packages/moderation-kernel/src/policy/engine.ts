import { DEFAULT_ALLOW_DECISION, DEFAULT_BLOCK_REPLY } from '../constants'
import type {
    ModerationDecision,
    ModerationRequest,
    UserRiskState
} from '../types'
import { normalizeDecision } from '../types'
import { addSeverityScore, clampRiskScore } from './scoring'
import { DEFAULT_KEYWORD_RULES, KeywordRule, matchKeywordRule } from './rules'

export function evaluateLocalRules(
    req: ModerationRequest,
    state: UserRiskState,
    rules: KeywordRule[] = DEFAULT_KEYWORD_RULES
): ModerationDecision {
    const text = req.contentText ?? ''
    const match = rules
        .map((item) => matchKeywordRule(item, text))
        .filter((item) => item != null)
        .sort((left, right) => {
            const score = {
                block: 4,
                suspend: 3,
                review: 2,
                rewrite: 1,
                allow: 0
            }

            return score[right.action] - score[left.action]
        })[0]

    if (!match) {
        return normalizeDecision({
            ...DEFAULT_ALLOW_DECISION,
            riskScore: clampRiskScore(state.trustScore)
        })
    }

    const rule = match.rule
    const severity = match.action === 'review' ? 2 : rule.severity
    const riskScore = addSeverityScore(state.trustScore, severity)

    return normalizeDecision({
        action: match.action,
        labels: rule.labels,
        reasons: [rule.id],
        confidence: match.action === 'review' ? 0.6 : rule.confidence,
        severity,
        riskScore,
        fixedReply: match.action === 'block' ? DEFAULT_BLOCK_REPLY : undefined
    })
}
