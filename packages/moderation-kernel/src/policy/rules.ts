import type { ModerationKeywordGroup } from '../config'
import type { ModerationAction, ModerationSeverity } from '../types'

export interface KeywordRule {
    id: string
    pattern?: RegExp
    keyword?: string
    labels: string[]
    severity: ModerationSeverity
    confidence: number
    action: ModerationAction
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

const SHORT_CONTEXT = {
    中共: {
        before: ['打倒', '推翻', '消灭', '反对', '反共', '灭', '天灭', '结束'],
        after: [
            '政权',
            '当局',
            '高层',
            '领导人',
            '统治',
            '独裁',
            '专制',
            '暴政',
            '黑帮',
            '邪党',
            '倒台',
            '下台',
            '解体',
            '灭亡',
            '垮台'
        ],
        ignoreAfter: [
            '有',
            '为',
            '计',
            '享',
            '用',
            '性',
            '同',
            '通',
            '线',
            '频',
            '模',
            '集'
        ]
    },
    台独: {
        before: ['支持', '鼓吹', '宣传', '推动', '赞成', '反对'],
        after: [
            '势力',
            '分子',
            '组织',
            '路线',
            '纲领',
            '主张',
            '建国',
            '制宪',
            '入联'
        ]
    },
    港独: {
        before: ['支持', '鼓吹', '宣传', '推动', '赞成', '反对'],
        after: ['势力', '分子', '组织', '路线', '纲领', '主张', '建国']
    },
    藏独: {
        before: ['支持', '鼓吹', '宣传', '推动', '赞成', '反对'],
        after: ['势力', '分子', '组织', '路线', '纲领', '主张', '建国', '独立']
    },
    疆独: {
        before: ['支持', '鼓吹', '宣传', '推动', '赞成', '反对'],
        after: ['势力', '分子', '组织', '路线', '纲领', '主张', '建国', '独立']
    },
    东突: {
        before: ['支持', '鼓吹', '宣传', '推动', '赞成', '反对'],
        after: ['组织', '势力', '分子', '恐怖组织', '独立', '建国', '厥斯坦'],
        ignoreAfter: ['发', '然', '破', '变']
    },
    法轮: {
        before: [],
        after: ['功', '大法', '组织', '媒体', '学员'],
        ignoreAfter: ['盘', '机构', '轴', '系']
    },
    轮功: {
        before: ['法', '练', '修炼'],
        after: []
    }
} satisfies Record<
    string,
    {
        before: string[]
        after: string[]
        ignoreAfter?: string[]
    }
>

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
    base: ModerationAction
) {
    const rule = SHORT_CONTEXT[keyword as keyof typeof SHORT_CONTEXT]
    let index = text.indexOf(keyword)

    while (index >= 0) {
        const before = text.slice(0, index)
        const after = text.slice(index + keyword.length)
        const ignoreAfter =
            rule != null && 'ignoreAfter' in rule ? rule.ignoreAfter : undefined

        if (ignoreAfter?.some((item) => after.startsWith(item))) {
            index = text.indexOf(keyword, index + keyword.length)
            continue
        }

        if (
            rule != null &&
            (rule.before.some((item) => before.endsWith(item)) ||
                rule.after.some((item) => after.startsWith(item)))
        ) {
            return base
        }

        if (!hasHanAround(text, index, keyword)) {
            return base === 'block' ? 'review' : base
        }

        index = text.indexOf(keyword, index + keyword.length)
    }
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
                keyword: normalizeKeywordText(keyword.trim()),
                labels: [group.name],
                severity: action === 'block' ? 5 : 2,
                confidence: action === 'block' ? 1 : 0.6,
                action
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

    const action = findContextualAction(text, keyword, rule.action)

    return action == null
        ? undefined
        : {
              rule,
              action
          }
}
