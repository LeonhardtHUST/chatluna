import { assert } from 'chai'
import {
    isDeepseekContentRiskError,
    parseDeepseekV4Model
} from '../src/requester'

describe('deepseek content risk detection', () => {
    it('recognizes content exists risk response bodies', () => {
        assert.isTrue(
            isDeepseekContentRiskError(
                JSON.stringify({
                    error: {
                        message: 'Content Exists Risk',
                        type: 'invalid_request_error',
                        param: null,
                        code: 'invalid_request_error'
                    }
                })
            )
        )
    })

    it('recognizes content exists risk errors', () => {
        assert.isTrue(
            isDeepseekContentRiskError(
                new Error('400 Bad Request: Content Exists Risk')
            )
        )
    })

    it('keeps other invalid request errors separate', () => {
        assert.isFalse(
            isDeepseekContentRiskError(
                JSON.stringify({
                    error: {
                        message: 'Invalid request format',
                        type: 'invalid_request_error',
                        code: 'invalid_request_error'
                    }
                })
            )
        )
    })
})

describe('deepseek v4 virtual model mapping', () => {
    it('maps instant model to flash with thinking disabled', () => {
        const parsed = parseDeepseekV4Model('deepseek-v4-flash-instant')

        assert.equal(parsed.model, 'deepseek-v4-flash')
        assert.isTrue(parsed.disabled)
    })

    it('keeps flash model as thinking enabled', () => {
        const parsed = parseDeepseekV4Model('deepseek-v4-flash')

        assert.equal(parsed.model, 'deepseek-v4-flash')
        assert.isFalse(parsed.disabled)
    })

    it('maps thinking effort variants to the real flash model', () => {
        const parsed = parseDeepseekV4Model('deepseek-v4-flash-high-thinking')

        assert.equal(parsed.model, 'deepseek-v4-flash')
        assert.isFalse(parsed.disabled)
    })

    it('keeps instance typo as a disabled compatibility alias', () => {
        const parsed = parseDeepseekV4Model('deepseek-v4-flash-instance')

        assert.equal(parsed.model, 'deepseek-v4-flash')
        assert.isTrue(parsed.disabled)
    })
})
