/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply as applyCensor } from '../src/middlewares/chat/censor'
import { apply as applyInputModeration } from '../src/middlewares/chat/moderation_input'

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

function getInputRun(ctx: unknown) {
    let run:
        | ((
              session: unknown,
              context: { message?: string }
          ) => Promise<ChainMiddlewareRunStatus>)
        | undefined

    applyInputModeration(ctx as never, {} as never, {
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

describe('core moderation input hook', () => {
    it('blocks input before model invocation', async () => {
        const run = getInputRun({
            moderation: {
                config: {
                    enabled: true,
                    shadowMode: false,
                    inputEnabled: true,
                    enforcement: {
                        fixedBlockReply: 'fixed block'
                    }
                },
                evaluateInput: async () => ({
                    action: 'block',
                    fixedReply: 'blocked'
                })
            }
        })
        const context = {}
        const status = await run(
            {
                content: 'blocked text'
            },
            context
        )

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(context.message, 'blocked')
    })

    it('continues shadow-mode blocks to the model path', async () => {
        const run = getInputRun({
            moderation: {
                config: {
                    enabled: true,
                    shadowMode: true,
                    inputEnabled: true,
                    enforcement: {
                        fixedBlockReply: 'fixed block'
                    }
                },
                evaluateInput: async () => ({
                    action: 'block',
                    fixedReply: 'blocked'
                })
            }
        })
        const context = {}
        const status = await run(
            {
                content: 'blocked text'
            },
            context
        )

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.notProperty(context, 'message')
    })

    it('continues when moderation is unavailable or disabled', async () => {
        const unavailable = await getInputRun({})(
            {
                content: 'hello'
            },
            {}
        )
        const disabled = await getInputRun({
            moderation: {
                config: {
                    enabled: false,
                    shadowMode: false,
                    inputEnabled: true,
                    enforcement: {
                        fixedBlockReply: 'fixed block'
                    }
                },
                evaluateInput: async () => ({
                    action: 'block'
                })
            }
        })(
            {
                content: 'hello'
            },
            {}
        )

        assert.equal(unavailable, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(disabled, ChainMiddlewareRunStatus.CONTINUE)
    })
})
