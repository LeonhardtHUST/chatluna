import { assert } from 'chai'
import type { Context } from 'koishi'
import {
    transformWithKoishiCensor,
    type ModerationDecision,
    type ModerationRequest
} from '../src'

const req: ModerationRequest = {
    stage: 'output',
    userKey: 'user-1'
}

const allow: ModerationDecision = {
    action: 'allow',
    labels: [],
    reasons: [],
    confidence: 0,
    severity: 0,
    riskScore: 0
}

describe('koishi censor adapter', () => {
    it('returns the original decision when ctx.censor is unavailable', async () => {
        const decision = await transformWithKoishiCensor(
            {} as Context,
            {
                ...req,
                contentText: 'blocked text'
            },
            allow
        )

        assert.strictEqual(decision, allow)
    })

    it('transforms string output', async () => {
        const ctx = {
            censor: {
                transform: (text: string) => text.replace('blocked', '***')
            }
        } as Context
        const decision = await transformWithKoishiCensor(
            ctx,
            {
                ...req,
                contentText: 'blocked text'
            },
            allow
        )

        assert.equal(decision.action, 'rewrite')
        assert.equal(decision.transformedText, '*** text')
    })

    it('transforms only text elements', async () => {
        const image = {
            type: 'image',
            src: 'https://example.com/image.png'
        }
        const ctx = {
            censor: {
                transform: async (text: string) =>
                    text.replace('blocked', '***')
            }
        } as Context
        const decision = await transformWithKoishiCensor(
            ctx,
            {
                ...req,
                contentElements: [
                    {
                        type: 'text',
                        text: 'blocked text'
                    },
                    image
                ]
            },
            allow
        )

        assert.equal(decision.action, 'rewrite')
        assert.deepEqual(decision.transformedElements, [
            {
                type: 'text',
                text: '*** text'
            },
            image
        ])
    })

    it('preserves non-allow actions while transforming output', async () => {
        const ctx = {
            censor: {
                transform: (text: string) => text.replace('blocked', '***')
            }
        } as Context
        const decision = await transformWithKoishiCensor(
            ctx,
            {
                ...req,
                contentText: 'blocked text'
            },
            {
                ...allow,
                action: 'block'
            }
        )

        assert.equal(decision.action, 'block')
        assert.equal(decision.transformedText, '*** text')
    })
})
