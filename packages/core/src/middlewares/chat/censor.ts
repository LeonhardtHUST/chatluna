import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import type {} from '@koishijs/censor'
import { isMessageContentText } from 'koishi-plugin-chatluna/utils/string'
import {
    coreOutputModerationMetadata,
    shouldUseCoreOutputModeration
} from 'moderation-kernel'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            const message = context.options.responseMessage

            if (message == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const moderation = ctx.moderation

            if (
                moderation &&
                shouldUseCoreOutputModeration(
                    config,
                    moderation.config,
                    ctx.logger
                )
            ) {
                const decision = await moderation.evaluateOutput(
                    session,
                    message,
                    coreOutputModerationMetadata(config)
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
