import { assert } from 'chai'
import {
    isBlockingDecision,
    isReviewDecision,
    normalizeDecision
} from '../src'

describe('moderation decisions', () => {
    it('recognizes block as blocking', () => {
        assert.equal(
            isBlockingDecision(
                normalizeDecision({
                    action: 'block'
                })
            ),
            true
        )
    })

    it('recognizes suspend as blocking', () => {
        assert.equal(
            isBlockingDecision(
                normalizeDecision({
                    action: 'suspend'
                })
            ),
            true
        )
    })

    it('does not treat review as blocking', () => {
        const decision = normalizeDecision({
            action: 'review'
        })

        assert.equal(isBlockingDecision(decision), false)
        assert.equal(isReviewDecision(decision), true)
    })

    it('clamps invalid confidence and risk score', () => {
        const decision = normalizeDecision({
            confidence: 2,
            riskScore: -10,
            severity: 9
        })

        assert.equal(decision.confidence, 1)
        assert.equal(decision.riskScore, 0)
        assert.equal(decision.severity, 5)
    })

    it('normalizes missing labels and reasons', () => {
        const decision = normalizeDecision({
            action: 'allow'
        })

        assert.deepEqual(decision.labels, [])
        assert.deepEqual(decision.reasons, [])
    })
})
