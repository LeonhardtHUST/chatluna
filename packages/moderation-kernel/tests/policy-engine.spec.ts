import { assert } from 'chai'
import {
    DEFAULT_SHORT_KEYWORD_CONTEXT_RULES,
    evaluateLocalRules,
    keywordGroupRules
} from '../src'
import type { UserRiskState } from '../src'

const state: UserRiskState = {
    userKey: 'user-1',
    trustScore: 0,
    reviewLevel: 0,
    state: 'normal',
    strikeCount: 0
}

describe('moderation policy engine', () => {
    it('allows when no rule matches', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'hello world'
            },
            state
        )

        assert.equal(decision.action, 'allow')
        assert.equal(decision.riskScore, 0)
    })

    it('returns review for ambiguous placeholder rule', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'please check moderation-review-test'
            },
            state
        )

        assert.equal(decision.action, 'review')
        assert.deepEqual(decision.labels, ['placeholder_review'])
    })

    it('returns block for high-confidence critical placeholder rule', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'please check moderation-block-test'
            },
            state
        )

        assert.equal(decision.action, 'block')
        assert.deepEqual(decision.labels, ['placeholder_block'])
        assert.equal(decision.severity, 5)
    })

    it('clamps accumulated risk score', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'moderation-block-test'
            },
            {
                ...state,
                trustScore: 90
            }
        )

        assert.equal(decision.riskScore, 100)
    })

    it('does not increase score for clean math and programming messages', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'solve 2 + 2 and explain a TypeScript interface'
            },
            state
        )

        assert.equal(decision.action, 'allow')
        assert.equal(decision.riskScore, 0)
    })

    it('blocks long exact keyword phrases', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '有人喊打倒中共'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'politics',
                        keywords: ['打倒中共']
                    }
                ],
                'block',
                DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
            )
        )

        assert.equal(decision.action, 'block')
        assert.deepEqual(decision.labels, ['politics'])
    })

    it('downgrades bare two-character block keywords to review', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '中共'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'politics',
                        keywords: ['中共']
                    }
                ],
                'block',
                DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
            )
        )

        assert.equal(decision.action, 'review')
        assert.equal(decision.severity, 2)
    })

    it('blocks short keywords with high-risk context', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '支持台独势力'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'politics',
                        keywords: ['台独']
                    }
                ],
                'block',
                DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
            )
        )

        assert.equal(decision.action, 'block')
    })

    it('ignores common embedded short keyword false positives', () => {
        const rules = keywordGroupRules(
            [
                {
                    name: 'politics',
                    keywords: ['中共', '法轮', '东突', '台独']
                }
            ],
            'block',
            DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
        )
        const samples = [
            '这些样本中共有三个',
            '中共有哪些普通误写样本',
            '法轮盘结构',
            '东突发新闻',
            '港台独服活动'
        ]

        for (const sample of samples) {
            const decision = evaluateLocalRules(
                {
                    stage: 'input',
                    userKey: 'user-1',
                    contentText: sample
                },
                state,
                rules
            )

            assert.equal(decision.action, 'allow', sample)
        }
    })

    it('keeps short review keywords as review', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '民运'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'context',
                        keywords: ['民运']
                    }
                ],
                'review',
                DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
            )
        )

        assert.equal(decision.action, 'review')
    })

    it('prefers block over review when multiple keyword rules match', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '民运 打倒中共'
            },
            state,
            [
                ...keywordGroupRules(
                    [
                        {
                            name: 'review',
                            keywords: ['民运']
                        }
                    ],
                    'review',
                    DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
                ),
                ...keywordGroupRules(
                    [
                        {
                            name: 'block',
                            keywords: ['打倒中共']
                        }
                    ],
                    'block',
                    DEFAULT_SHORT_KEYWORD_CONTEXT_RULES
                )
            ]
        )

        assert.equal(decision.action, 'block')
        assert.deepEqual(decision.labels, ['block'])
    })

    it('uses custom short keyword context rules', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '触发短词后缀'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'custom',
                        keywords: ['短词']
                    }
                ],
                'block',
                [
                    {
                        term: '短词',
                        blockIfPrecededBy: [],
                        blockIfFollowedBy: ['后缀'],
                        ignoreIfFollowedBy: [],
                        standaloneAction: 'review'
                    }
                ]
            )
        )

        assert.equal(decision.action, 'block')
        assert.deepEqual(decision.labels, ['custom'])
    })

    it('does not restore bare short keyword blocking when context rules are empty', () => {
        const decision = evaluateLocalRules(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: '中共'
            },
            state,
            keywordGroupRules(
                [
                    {
                        name: 'politics',
                        keywords: ['中共']
                    }
                ],
                'block',
                []
            )
        )

        assert.equal(decision.action, 'review')
    })
})
