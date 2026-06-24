import { assert } from 'chai'
import {
    addSeverityScore,
    clampRiskScore,
    getUserStateByRiskScore
} from '../src'

describe('moderation scoring', () => {
    it('clamps risk score', () => {
        assert.equal(clampRiskScore(-1), 0)
        assert.equal(clampRiskScore(101), 100)
    })

    it('transitions state by default thresholds', () => {
        assert.equal(getUserStateByRiskScore(24), 'normal')
        assert.equal(getUserStateByRiskScore(25), 'watch')
        assert.equal(getUserStateByRiskScore(55), 'restricted')
        assert.equal(getUserStateByRiskScore(85), 'suspended')
    })

    it('does not increase score for severity zero', () => {
        assert.equal(addSeverityScore(10, 0), 10)
    })
})
