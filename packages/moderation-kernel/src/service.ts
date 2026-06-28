import { Context, Service } from 'koishi'
import type { ModerationConfig } from './config'
import { DEFAULT_ALLOW_DECISION } from './constants'
import { logModerationEvent } from './audit/logger'
import { evaluateLocalRules } from './policy/engine'
import { DEFAULT_KEYWORD_RULES, keywordGroupRules } from './policy/rules'
import { applyAdminCommands } from './admin/commands'
import { defineModerationModels } from './storage/model'
import { ModerationRepository } from './storage/repository'
import type {
    ModerationAction,
    ModerationDecision,
    ModerationLlmRecheckBackend,
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
    static inject = ['database']

    public readonly repository: ModerationRepository
    private _llmRecheckBackend?: ModerationLlmRecheckBackend

    constructor(
        public readonly ctx: Context,
        public readonly config: ModerationConfig
    ) {
        super(ctx, 'moderation')
        defineModerationModels(ctx)
        this.repository = new ModerationRepository(ctx, config)
        applyAdminCommands(ctx, this)
    }

    registerLlmRecheckBackend(backend: ModerationLlmRecheckBackend) {
        this._llmRecheckBackend = backend
    }

    clearLlmRecheckBackend() {
        this._llmRecheckBackend = undefined
    }

    async evaluate(req: ModerationRequest): Promise<ModerationDecision> {
        if (!this.config.enabled) {
            return normalizeDecision(DEFAULT_ALLOW_DECISION)
        }

        const state = await this.getUserRiskState(req.userKey)
        const decision = normalizeDecision(
            this.config.backend.useKeywordRules
                ? evaluateLocalRules(req, state, [
                      ...DEFAULT_KEYWORD_RULES,
                      ...keywordGroupRules(
                          this.config.rules.blockKeywordGroups,
                          'block',
                          this.config.rules.shortKeywordContextRules
                      ),
                      ...keywordGroupRules(
                          this.config.rules.reviewKeywordGroups,
                          'review',
                          this.config.rules.shortKeywordContextRules
                      )
                  ])
                : DEFAULT_ALLOW_DECISION
        )
        logModerationEvent(this.ctx, 'moderation.decision', req, decision, {
            shadowMode: this.config.shadowMode
        })

        const checked = await this._recheck(req, decision)
        const event = await this.recordEvent(req, checked)
        const result = normalizeDecision({
            ...checked,
            eventId: event.id
        })

        if (result.action === 'review') {
            logModerationEvent(this.ctx, 'moderation.review', req, result, {
                eventId: event.id,
                shadowMode: this.config.shadowMode
            })
        }

        if (isBlockingDecision(result)) {
            logModerationEvent(this.ctx, 'moderation.block', req, result, {
                eventId: event.id,
                shadowMode: this.config.shadowMode
            })
        }

        if (this.config.shadowMode && isBlockingDecision(result)) {
            logModerationEvent(
                this.ctx,
                'moderation.shadow_mismatch',
                req,
                result,
                {
                    eventId: event.id,
                    shadowMode: this.config.shadowMode
                }
            )

            return normalizeDecision({
                ...result,
                action: 'allow'
            })
        }

        return result
    }

    private async _recheck(
        req: ModerationRequest,
        decision: ModerationDecision
    ) {
        if (
            decision.action !== 'review' ||
            !this.config.backend.useLlmRecheck ||
            this.config.enforcement.maxRechecksPerRequest < 1 ||
            this._llmRecheckBackend == null
        ) {
            return decision
        }

        try {
            const raw = await this._llmRecheckBackend({
                request: req,
                decision
            })

            if (
                raw == null ||
                raw.action == null ||
                (raw.action !== 'allow' &&
                    raw.action !== 'review' &&
                    raw.action !== 'block')
            ) {
                return normalizeDecision({
                    ...decision,
                    reasons: [...decision.reasons, 'llm_recheck_failed']
                })
            }

            const checked = normalizeDecision(raw)

            const result = normalizeDecision({
                ...decision,
                ...checked,
                labels:
                    checked.labels.length > 0
                        ? checked.labels
                        : decision.labels,
                reasons: [
                    ...decision.reasons,
                    ...checked.reasons,
                    `llm_recheck.${checked.action}`
                ],
                riskScore: Math.max(decision.riskScore, checked.riskScore),
                severity: Math.min(
                    5,
                    Math.max(decision.severity, checked.severity)
                ) as ModerationDecision['severity']
            })

            logModerationEvent(this.ctx, 'moderation.recheck', req, result, {
                shadowMode: this.config.shadowMode
            })

            return result
        } catch {
            const result = normalizeDecision({
                ...decision,
                reasons: [...decision.reasons, 'llm_recheck_failed']
            })

            logModerationEvent(
                this.ctx,
                'moderation.recheck_failed',
                req,
                result,
                {
                    shadowMode: this.config.shadowMode
                }
            )

            return result
        }
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
        logModerationEvent(
            this.ctx,
            'moderation.override',
            {
                stage: 'appeal-replay',
                userKey
            },
            {
                action: 'review',
                labels: ['admin_override'],
                confidence: 1,
                severity: 0,
                riskScore: patch.trustScore ?? 0
            },
            {
                shadowMode: this.config.shadowMode
            }
        )
    }

    async recordOverride(
        eventId: string,
        action: ModerationAction,
        operator: string,
        reason?: string
    ) {
        const review = await this.repository.recordOverride(
            eventId,
            action,
            operator,
            reason
        )
        logModerationEvent(
            this.ctx,
            'moderation.override',
            {
                stage: 'appeal-replay',
                userKey: review.userId
            },
            {
                action,
                labels: ['manual_override'],
                confidence: 1,
                severity: 0,
                riskScore: 0
            },
            {
                eventId,
                shadowMode: this.config.shadowMode
            }
        )

        return review
    }

    async purgeExpiredEvidence(now: Date = new Date()): Promise<number> {
        const count = await this.repository.purgeExpiredEvidence(now)
        logModerationEvent(
            this.ctx,
            'moderation.retention_purge',
            {
                stage: 'appeal-replay',
                userKey: 'system'
            },
            {
                action: 'allow',
                labels: [],
                confidence: 1,
                severity: 0,
                riskScore: 0
            },
            {
                count,
                shadowMode: this.config.shadowMode
            }
        )

        return count
    }

    private async recordEvent(
        req: ModerationRequest,
        decision: ModerationDecision
    ) {
        try {
            const event = await this.repository.recordEvent(req, decision)
            logModerationEvent(
                this.ctx,
                'moderation.event_recorded',
                req,
                decision,
                {
                    eventId: event.id,
                    shadowMode: this.config.shadowMode
                }
            )

            return event
        } catch (error) {
            logModerationEvent(
                this.ctx,
                'moderation.storage_failure',
                req,
                decision,
                {
                    shadowMode: this.config.shadowMode
                }
            )
            throw error
        }
    }
}

declare module 'koishi' {
    interface Context {
        moderation: ModerationService
    }
}
