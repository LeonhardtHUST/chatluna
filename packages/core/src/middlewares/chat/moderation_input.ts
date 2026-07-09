import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import type {} from 'moderation-kernel'
import { repairBenignRefusal } from '../../utils/safe_response'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('moderation_input', async (session, context) => {
            const moderation = ctx.moderation

            if (
                !moderation?.config.enabled ||
                !moderation.config.inputEnabled
            ) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const decision = await moderation.evaluateInput(
                session,
                session.content ?? '',
                {
                    source: 'chatluna-core-input',
                    conversationId:
                        context.options?.conversation?.conversationId ??
                        context.options?.conversation?.conversation?.id
                }
            )

            if (moderation.config.shadowMode) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (
                decision.action === 'block' ||
                decision.action === 'suspend' ||
                decision.action === 'review'
            ) {
                const reply =
                    decision.fixedReply ??
                    moderation.config.enforcement.fixedBlockReply
                context.message =
                    repairBenignRefusal(session.content ?? '', reply) ?? reply
                return ChainMiddlewareRunStatus.STOP
            }

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-handle_command')
        .after('resolve_conversation')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        moderation_input: never
    }
}
