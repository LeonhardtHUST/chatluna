import { assert } from 'chai'
import { isDeepseekContentRiskError } from '../src/requester'

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
