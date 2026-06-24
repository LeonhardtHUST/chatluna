import { assert } from 'chai'
import { evaluateLocalRules } from '../src'
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
})
