import { Context, Service } from 'koishi'
import type { ModerationConfig } from './config'
import { DEFAULT_ALLOW_DECISION } from './constants'
import { evaluateLocalRules } from './policy/engine'
import { applyAdminCommands } from './admin/commands'
import { defineModerationModels } from './storage/model'
import { ModerationRepository } from './storage/repository'
import type {
    ModerationAction,
    ModerationDecision,
    ModerationRequest,
    UserRiskState
} from './types'
import { isBlockingDecision, normalizeDecision } from './types'

interface ModerationSession {
    platform?: string
    userId?: string
    channelId?: string
    guildId?: string
}

interface OutputMessage {
    content?: string | unknown[]
}

function getUserKey(sessionOrUserKey: ModerationSession | string): string {
    if (typeof sessionOrUserKey === 'string') {
        return sessionOrUserKey
    }

    return `${sessionOrUserKey.platform ?? 'unknown'}:${
        sessionOrUserKey.userId ?? 'unknown'
    }`
}

function getChannelKey(session: ModerationSession): string | undefined {
    return session.channelId ?? session.guildId
}

export class ModerationService extends Service {
    static inject = ['database'] as const

    public readonly repository: ModerationRepository

    constructor(
        ctx: Context,
        public readonly config: ModerationConfig
    ) {
        super(ctx, 'moderation')
        defineModerationModels(ctx)
        this.repository = new ModerationRepository(ctx, config)
        applyAdminCommands(ctx, this)
    }

    async evaluate(req: ModerationRequest): Promise<ModerationDecision> {
        if (!this.config.enabled) {
            return normalizeDecision(DEFAULT_ALLOW_DECISION)
        }

        const state = await this.getUserRiskState(req.userKey)
        const decision = normalizeDecision(
            this.config.backend.useKeywordRules
                ? evaluateLocalRules(req, state)
                : DEFAULT_ALLOW_DECISION
        )
        const event = await this.repository.recordEvent(req, decision)
        const result = normalizeDecision({
            ...decision,
            eventId: event.id
        })

        if (this.config.shadowMode && isBlockingDecision(result)) {
            return normalizeDecision({
                ...result,
                action: 'allow'
            })
        }

        return result
    }

    evaluateInput(
        session: ModerationSession,
        text: string,
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        return this.evaluate({
            stage: 'input',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            contentText: text,
            metadata: {
                ...metadata,
                platform: session.platform
            }
        })
    }

    evaluatePreSearch(
        session: ModerationSession,
        text: string,
        history: unknown[] = [],
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        return this.evaluate({
            stage: 'pre-search',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            contentText: text,
            metadata: {
                ...metadata,
                platform: session.platform,
                historyLength: history.length
            }
        })
    }

    evaluateOutput(
        session: ModerationSession,
        message: string | unknown[] | OutputMessage,
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        const content =
            typeof message === 'object' &&
            !Array.isArray(message) &&
            message != null
                ? message.content
                : message

        return this.evaluate({
            stage: 'output',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            contentText: typeof content === 'string' ? content : undefined,
            contentElements: Array.isArray(content) ? content : undefined,
            metadata: {
                ...metadata,
                platform: session.platform
            }
        })
    }

    getUserRiskState(
        sessionOrUserKey: ModerationSession | string
    ): Promise<UserRiskState> {
        if (typeof sessionOrUserKey === 'string') {
            return this.repository.getOrCreateUserState(sessionOrUserKey)
        }

        return this.repository.getOrCreateUserState(
            getUserKey(sessionOrUserKey),
            sessionOrUserKey.platform,
            getChannelKey(sessionOrUserKey)
        )
    }

    async setUserRiskState(
        userKey: string,
        patch: Partial<UserRiskState>,
        operator: string
    ): Promise<void> {
        await this.repository.updateUserState(userKey, patch)
    }

    recordOverride(
        eventId: string,
        action: ModerationAction,
        operator: string,
        reason?: string
    ) {
        return this.repository.recordOverride(eventId, action, operator, reason)
    }

    purgeExpiredEvidence(now: Date = new Date()): Promise<number> {
        return this.repository.purgeExpiredEvidence(now)
    }
}

declare module 'koishi' {
    interface Context {
        moderation: ModerationService
    }
}
