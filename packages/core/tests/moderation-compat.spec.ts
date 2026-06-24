/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply as applyCensor } from '../src/middlewares/chat/censor'

function getRun(ctx: unknown, config: unknown) {
    let run:
        | ((
              session: unknown,
              context: unknown
          ) => Promise<ChainMiddlewareRunStatus>)
        | undefined

    applyCensor(ctx as never, config as never, {
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
    } as never)

    return run!
}

describe('core moderation compatibility', () => {
    it('uses old censor behavior when moderation is unavailable', async () => {
        const ctx = {
            censor: {
                transform: (text: string) => text.replace('blocked', '***')
            }
        }
        const run = getRun(ctx, {
            censor: true,
            rawOnCensor: false
        })
        const message = {
            content: 'blocked text'
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
        assert.equal(message.content, '*** text')
    })

    it('passes rawOnCensor through moderation metadata', async () => {
        let metadata: Record<string, unknown> | undefined
        const ctx = {
            moderation: {
                config: {
                    enabled: true,
                    shadowMode: false,
                    outputEnabled: true,
                    enforcement: {
                        fixedBlockReply: 'blocked'
                    },
                    compatibility: {
                        mapCoreCensor: false
                    }
                },
                evaluateOutput: async (
                    _session: unknown,
                    _message: unknown,
                    meta?: Record<string, unknown>
                ) => {
                    metadata = meta
                    return {
                        action: 'allow'
                    }
                }
            }
        }
        const run = getRun(ctx, {
            censor: false,
            rawOnCensor: true
        })
        const status = await run(
            {},
            {
                options: {
                    responseMessage: {
                        content: 'hello'
                    }
                }
            }
        )

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.deepEqual(metadata, {
            source: 'chatluna-core-censor',
            rawOnCensor: true
        })
    })
})
