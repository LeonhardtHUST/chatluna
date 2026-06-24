import { assert } from 'chai'
import {
    DEFAULT_MODERATION_CONFIG,
    DEFAULT_ALLOW_DECISION,
    ModerationService
} from '../src'

describe('moderation-kernel exports', () => {
    it('exports default config and service', () => {
        assert.equal(DEFAULT_MODERATION_CONFIG.enabled, true)
        assert.equal(DEFAULT_MODERATION_CONFIG.shadowMode, true)
        assert.equal(DEFAULT_ALLOW_DECISION.action, 'allow')
        assert.equal(typeof ModerationService, 'function')
    })
})
