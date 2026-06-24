import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import type {} from '@koishijs/censor'
import { isMessageContentText } from 'koishi-plugin-chatluna/utils/string'

interface ModerationContext extends Context {
    moderation?: {
        config: {
            enabled: boolean
            shadowMode: boolean
            outputEnabled: boolean
            enforcement: {
                fixedBlockReply: string
            }
            compatibility: {
                mapCoreCensor: boolean
            }
        }
        evaluateOutput(
            session: unknown,
            message: unknown,
            metadata?: Record<string, unknown>
        ): Promise<{
            action: string
            transformedText?: string
            transformedElements?: unknown[]
            fixedReply?: string
        }>
    }
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            const message = context.options.responseMessage

            if (message == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const moderation = (ctx as ModerationContext).moderation

            if (
                moderation?.config.enabled &&
                moderation.config.outputEnabled &&
                (config.censor ||
                    !moderation.config.compatibility.mapCoreCensor)
            ) {
                const decision = await moderation.evaluateOutput(
                    session,
                    message,
                    {
                        source: 'chatluna-core-censor',
                        rawOnCensor: config.rawOnCensor
                    }
                )

                if (decision.action === 'rewrite') {
                    if (decision.transformedText != null) {
                        message.content = decision.transformedText
                    }

                    if (decision.transformedElements != null) {
                        message.content = decision.transformedElements
                    }

                    return ChainMiddlewareRunStatus.CONTINUE
                }

                if (
                    decision.action === 'block' ||
                    decision.action === 'suspend'
                ) {
                    if (!moderation.config.shadowMode) {
                        message.content =
                            decision.fixedReply ??
                            moderation.config.enforcement.fixedBlockReply
                    }

                    return ChainMiddlewareRunStatus.CONTINUE
                }

                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (!config.censor) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const baseContent = message.content

            if (typeof baseContent === 'string') {
                message.content = await ctx.censor.transform(
                    baseContent,
                    session
                )

                return ChainMiddlewareRunStatus.CONTINUE
            }

            message.content = await Promise.all(
                baseContent.map((content) => {
                    if (!isMessageContentText(content)) {
                        return content
                    }

                    return {
                        type: 'text',
                        text: ctx.censor.transform(content.text, session)
                    }
                })
            )
        })
        .before('lifecycle-send')
        .after('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        censor: never
    }
}
