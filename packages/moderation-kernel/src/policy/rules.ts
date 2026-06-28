import type {
    ModerationKeywordGroup,
    ModerationShortKeywordContextRule
} from '../config'
import type { ModerationAction, ModerationSeverity } from '../types'

export interface KeywordRule {
    id: string
    pattern?: RegExp
    keyword?: string
    labels: string[]
    severity: ModerationSeverity
    confidence: number
    action: ModerationAction
    shortKeywordContextRules?: ModerationShortKeywordContextRule[]
}

export interface KeywordMatch {
    rule: KeywordRule
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

export function normalizeKeywordText(text: string) {
    return text
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[A-Z]/g, (char) => char.toLowerCase())
}

function isShortTerm(text: string) {
    return /^[\p{Script=Han}]{2}$/u.test(text) || /^[a-z0-9]{2,4}$/u.test(text)
}

function hasHanAround(text: string, index: number, keyword: string) {
    return (
        /\p{Script=Han}/u.test(text[index - 1] ?? '') ||
        /\p{Script=Han}/u.test(text[index + keyword.length] ?? '')
    )
}

function findContextualAction(
    text: string,
    keyword: string,
    base: ModerationAction,
    rules: ModerationShortKeywordContextRule[] = []
) {
    const rule = rules.find(
        (item) => normalizeKeywordText(item.term) === keyword
    )
    let index = text.indexOf(keyword)

    while (index >= 0) {
        const before = text.slice(0, index)
        const after = text.slice(index + keyword.length)

        if (
            rule?.ignoreIfFollowedBy.some((item) =>
                after.startsWith(normalizeKeywordText(item))
            )
        ) {
            index = text.indexOf(keyword, index + keyword.length)
            continue
        }

        if (
            rule != null &&
            (rule.blockIfPrecededBy.some((item) =>
                before.endsWith(normalizeKeywordText(item))
            ) ||
                rule.blockIfFollowedBy.some((item) =>
                    after.startsWith(normalizeKeywordText(item))
                ))
        ) {
            return base
        }

        if (!hasHanAround(text, index, keyword)) {
            return base === 'block'
                ? (rule?.standaloneAction ?? 'review')
                : base
        }

        index = text.indexOf(keyword, index + keyword.length)
    }
}

export function keywordGroupRules(
    groups: ModerationKeywordGroup[],
    action: ModerationAction,
    shortKeywordContextRules: ModerationShortKeywordContextRule[] = []
): KeywordRule[] {
    return groups.flatMap((group) =>
        group.keywords
            .filter((keyword) => keyword.trim().length > 0)
            .map((keyword) => ({
                id: `compat.${action}.${group.name}.${keyword}`,
                keyword: normalizeKeywordText(keyword.trim()),
                labels: [group.name],
                severity: action === 'block' ? 5 : 2,
                confidence: action === 'block' ? 1 : 0.6,
                action,
                shortKeywordContextRules
            }))
    )
}

export function matchKeywordRule(rule: KeywordRule, input: string) {
    if (rule.pattern != null) {
        return rule.pattern.test(input)
            ? {
                  rule,
                  action: rule.action
              }
            : undefined
    }

    if (rule.keyword == null) return

    const text = normalizeKeywordText(input)
    const keyword = normalizeKeywordText(rule.keyword)

    if (!text.includes(keyword)) return

    if (!isShortTerm(keyword)) {
        return {
            rule,
            action: rule.action
        }
    }

    const action = findContextualAction(
        text,
        keyword,
        rule.action,
        rule.shortKeywordContextRules
    )

    return action == null
        ? undefined
        : {
              rule,
              action
          }
}
