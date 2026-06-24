/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply as applyCensor } from '../src/middlewares/chat/censor'

function getRun(ctx: unknown, shadowMode: boolean, decision: unknown) {
    let run:
        | ((
              session: unknown,
              context: unknown
          ) => Promise<ChainMiddlewareRunStatus>)
        | undefined

    applyCensor(
        {
            ...ctx,
            moderation: {
                config: {
                    enabled: true,
                    shadowMode,
                    outputEnabled: true,
                    enforcement: {
                        fixedBlockReply: 'fixed block'
                    },
                    compatibility: {
                        mapCoreCensor: false
                    }
                },
                evaluateOutput: async () => decision
            }
        } as never,
        {
            censor: false,
            rawOnCensor: false
        } as never,
        {
            middleware: (_name, fn) => {
                run = fn as never
                return {
                    before() {
                        return this
                    },
                    after() {
                        return this
                    }
                }
            }
        } as never
    )

    return run!
}

describe('core moderation output bridge', () => {
    it('keeps blocked output in shadow mode', async () => {
        const run = getRun({}, true, {
            action: 'block',
            fixedReply: 'blocked'
        })
        const message = {
            content: 'original'
        }
        const status = await run(
            {},
            {
                options: {
                    responseMessage: message
                }
            }
        )

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(message.content, 'original')
    })

    it('replaces blocked output in enforce mode', async () => {
        const run = getRun({}, false, {
            action: 'block',
            fixedReply: 'blocked'
        })
        const message = {
            content: 'original'
        }
        const status = await run(
            {},
            {
                options: {
                    responseMessage: message
                }
            }
        )

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(message.content, 'blocked')
    })

    it('uses fixed block reply when decision has no reply', async () => {
        const run = getRun({}, false, {
            action: 'block'
        })
        const message = {
            content: 'original'
        }

        await run(
            {},
            {
                options: {
                    responseMessage: message
                }
            }
        )

        assert.equal(message.content, 'fixed block')
    })

    it('applies rewrite decisions to element arrays', async () => {
        const elements = [
            {
                type: 'text',
                text: 'clean'
            },
            {
                type: 'image',
                src: 'https://example.com/image.png'
            }
        ]
        const run = getRun({}, false, {
            action: 'rewrite',
            transformedElements: elements
        })
        const message = {
            content: [
                {
                    type: 'text',
                    text: 'original'
                }
            ]
        }

        await run(
            {},
            {
                options: {
                    responseMessage: message
                }
            }
        )

        assert.deepEqual(message.content, elements)
    })
})
