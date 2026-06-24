import type { ModerationKeywordGroup } from '../config'
import type { ModerationAction, ModerationSeverity } from '../types'

export interface KeywordRule {
    id: string
    pattern: RegExp
    labels: string[]
    severity: ModerationSeverity
    confidence: number
    action: ModerationAction
}

export const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
    {
        id: 'placeholder.review',
        pattern: /\bmoderation-review-test\b/i,
        labels: ['placeholder_review'],
        severity: 2,
        confidence: 0.55,
        action: 'review'
    },
    {
        id: 'placeholder.block',
        pattern: /\bmoderation-block-test\b/i,
        labels: ['placeholder_block'],
        severity: 5,
        confidence: 0.95,
        action: 'block'
    }
]

function pattern(text: string) {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

export function keywordGroupRules(
    groups: ModerationKeywordGroup[],
    action: ModerationAction
): KeywordRule[] {
    return groups.flatMap((group) =>
        group.keywords
            .filter((keyword) => keyword.trim().length > 0)
            .map((keyword) => ({
                id: `compat.${action}.${group.name}.${keyword}`,
                pattern: pattern(keyword.trim()),
                labels: [group.name],
                severity: action === 'block' ? 5 : 2,
                confidence: action === 'block' ? 1 : 0.6,
                action
            }))
    )
}
