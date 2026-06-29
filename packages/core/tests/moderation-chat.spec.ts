/// <reference types="mocha" />

import { assert } from 'chai'
import { HumanMessage } from '@langchain/core/messages'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { ChatInterface } from '../src/llm-core/chat/app'
import { apply as applyCensor } from '../src/middlewares/chat/censor'
import { apply as applyInputModeration } from '../src/middlewares/chat/moderation_input'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from '../src/utils/error'

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

describe('core remote api moderation block', () => {
    it('uses remote api fixed reply and records moderation event', async () => {
        const calls: unknown[] = []
        const chat = new ChatInterface(
            {
                on() {},
                parallel: async () => {},
                moderation: {
                    config: {
                        enforcement: {
                            remoteApiBlockReply: 'remote fixed reply'
                        }
                    },
                    recordRemoteApiBlock: async (...args: unknown[]) => {
                        calls.push(args)
                    }
                }
            } as never,
            {
                chatMode: 'chat',
                model: 'deepseek/deepseek-v4-flash-instant',
                conversationId: 'conversation-1'
            },
            {} as never
        )
        const err = new ChatLunaError(
            ChatLunaErrorCode.API_UNSAFE_CONTENT,
            new Error(
                '{"error":{"message":"Content Exists Risk","code":"invalid_request_error"}}'
            )
        )

        try {
            await (
                chat as unknown as {
                    handleChatError(
                        arg: unknown,
                        wrapper: unknown,
                        error: unknown
                    ): Promise<void>
                }
            ).handleChatError(
                {
                    session: {
                        platform: 'test',
                        userId: 'user-1',
                        channelId: 'channel-1'
                    },
                    conversationId: 'conversation-1',
                    requestId: 'request-1',
                    message: new HumanMessage('remote blocked text'),
                    variables: {}
                },
                {
                    model: {
                        modelName: 'deepseek-v4-flash-instant'
                    }
                },
                err
            )
            assert.fail('expected unsafe content error')
        } catch (e) {
            assert.instanceOf(e, ChatLunaError)
            assert.equal((e as ChatLunaError).message, 'remote fixed reply')
        }

        assert.lengthOf(calls, 1)
        assert.deepEqual(calls[0], [
            {
                platform: 'test',
                userId: 'user-1',
                channelId: 'channel-1'
            },
            'remote blocked text',
            {
                source: 'remote-api',
                provider: 'deepseek',
                conversationId: 'conversation-1',
                requestId: 'request-1'
            }
        ])
    })

    it('keeps non-deepseek unsafe errors on the original path', async () => {
        const calls: unknown[] = []
        const chat = new ChatInterface(
            {
                on() {},
                parallel: async () => {},
                moderation: {
                    config: {
                        enforcement: {
                            remoteApiBlockReply: 'remote fixed reply'
                        }
                    },
                    recordRemoteApiBlock: async (...args: unknown[]) => {
                        calls.push(args)
                    }
                }
            } as never,
            {
                chatMode: 'chat',
                model: 'openai/gpt-4o',
                conversationId: 'conversation-1'
            },
            {} as never
        )
        const err = new ChatLunaError(
            ChatLunaErrorCode.API_UNSAFE_CONTENT,
            new Error('content_filter')
        )

        try {
            await (
                chat as unknown as {
                    handleChatError(
                        arg: unknown,
                        wrapper: unknown,
                        error: unknown
                    ): Promise<void>
                }
            ).handleChatError(
                {
                    session: {
                        platform: 'test',
                        userId: 'user-1',
                        channelId: 'channel-1'
                    },
                    conversationId: 'conversation-1',
                    requestId: 'request-1',
                    message: new HumanMessage('remote blocked text'),
                    variables: {}
                },
                {
                    model: {
                        modelName: 'gpt-4o'
                    }
                },
                err
            )
            assert.fail('expected unsafe content error')
        } catch (e) {
            assert.instanceOf(e, ChatLunaError)
            assert.notEqual((e as ChatLunaError).message, 'remote fixed reply')
        }

        assert.lengthOf(calls, 0)
    })

    it('uses default reply without recording when moderation is disabled', async () => {
        const calls: unknown[] = []
        const chat = new ChatInterface(
            {
                on() {},
                parallel: async () => {},
                moderation: {
                    config: {
                        enabled: false,
                        enforcement: {
                            remoteApiBlockReply: 'disabled custom reply'
                        }
                    },
                    recordRemoteApiBlock: async (...args: unknown[]) => {
                        calls.push(args)
                    }
                }
            } as never,
            {
                chatMode: 'chat',
                model: 'deepseek/deepseek-v4-flash-instant',
                conversationId: 'conversation-1'
            },
            {} as never
        )
        const err = new ChatLunaError(
            ChatLunaErrorCode.API_UNSAFE_CONTENT,
            new Error('Content Exists Risk')
        )

        try {
            await (
                chat as unknown as {
                    handleChatError(
                        arg: unknown,
                        wrapper: unknown,
                        error: unknown
                    ): Promise<void>
                }
            ).handleChatError(
                {
                    session: {
                        platform: 'test',
                        userId: 'user-1',
                        channelId: 'channel-1'
                    },
                    conversationId: 'conversation-1',
                    requestId: 'request-1',
                    message: new HumanMessage('remote blocked text'),
                    variables: {}
                },
                {
                    model: {
                        modelName: 'deepseek-v4-flash-instant'
                    }
                },
                err
            )
            assert.fail('expected unsafe content error')
        } catch (e) {
            assert.instanceOf(e, ChatLunaError)
            assert.equal(
                (e as ChatLunaError).message,
                '基于模型内容安全策略，服务端 API 拒绝为本次内容提供响应。请求记录已存档备查。若有问题，请联系管理员。'
            )
        }

        assert.lengthOf(calls, 0)
    })
})
