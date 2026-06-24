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
