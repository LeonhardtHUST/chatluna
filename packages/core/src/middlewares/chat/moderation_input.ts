import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'

interface ModerationContext extends Context {
    moderation?: {
        config: {
            enabled: boolean
            shadowMode: boolean
            inputEnabled: boolean
            enforcement: {
                fixedBlockReply: string
            }
        }
        evaluateInput(
            session: unknown,
            text: string,
            metadata?: Record<string, unknown>
        ): Promise<{
            action: string
            fixedReply?: string
        }>
    }
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('moderation_input', async (session, context) => {
            const moderation = (ctx as ModerationContext).moderation

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
                    source: 'chatluna-core-input'
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
                context.message =
                    decision.fixedReply ??
                    moderation.config.enforcement.fixedBlockReply
                return ChainMiddlewareRunStatus.STOP
            }

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        moderation_input: never
    }
}
