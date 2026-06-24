import { randomUUID } from 'node:crypto'
import { Context } from 'koishi'
import type { ModerationConfig } from '../config'
import type {
    ModerationAction,
    ModerationDecision,
    ModerationRequest,
    UserRiskState
} from '../types'
import { normalizeDecision } from '../types'
import { hashEvidence } from '../audit/evidence'
import { redactEvidence } from '../audit/redaction'
import { MODERATION_RULE_VERSION } from './migration'
import type {
    ModerationEventRow,
    ModerationReviewRow,
    ModerationUserRow
} from './model'

export interface RecordEventOptions {
    now?: Date
    operator?: string
    ruleVersion?: string
    salt?: string
}

export class ModerationRepository {
    constructor(
        public readonly ctx: Context,
        public readonly config: ModerationConfig
    ) {}

    async getOrCreateUserState(
        userKey: string,
        platform: string = 'unknown',
        channelId?: string
    ): Promise<UserRiskState> {
        const [row] = await this.ctx.database.get('chatluna_moderation_user', {
            id: userKey
        })

        if (row) {
            return this.toState(row)
        }

        const now = new Date()
        const created = await this.ctx.database.create(
            'chatluna_moderation_user',
            {
                id: userKey,
                platform,
                channelId: channelId ?? null,
                trustScore: 0,
                reviewLevel: 0,
                state: 'normal',
                strikeCount: 0,
                lastEventAt: null,
                createdAt: now,
                updatedAt: now,
                version: 1
            }
        )

        return this.toState(created)
    }

    async updateUserState(
        userKey: string,
        patch: Partial<UserRiskState>
    ): Promise<UserRiskState> {
        await this.getOrCreateUserState(userKey)
        await this.ctx.database.set(
            'chatluna_moderation_user',
            { id: userKey },
            {
                trustScore: patch.trustScore,
                reviewLevel: patch.reviewLevel,
                state: patch.state,
                strikeCount: patch.strikeCount,
                lastEventAt:
                    patch.lastEventAt == null
                        ? undefined
                        : new Date(patch.lastEventAt),
                updatedAt: new Date()
            }
        )

        return this.getOrCreateUserState(userKey)
    }

    async recordEvent(
        req: ModerationRequest,
        rawDecision: ModerationDecision,
        opts: RecordEventOptions = {}
    ): Promise<ModerationEventRow> {
        const decision = normalizeDecision(rawDecision)
        const now = opts.now ?? new Date()
        const text = req.contentText ?? ''
        const expireAt = this.config.storage.storeRawTextForAppeal
            ? new Date(
                  now.getTime() +
                      this.config.storage.rawTextRetentionDays *
                          24 *
                          60 *
                          60 *
                          1000
              )
            : null

        await this.getOrCreateUserState(
            req.userKey,
            req.metadata?.platform as string,
            req.channelKey
        )

        const row = await this.ctx.database.create(
            'chatluna_moderation_event',
            {
                id: randomUUID(),
                userId: req.userKey,
                conversationId: req.conversationId ?? null,
                stage: req.stage,
                action: decision.action,
                labels: decision.labels,
                reasons: decision.reasons,
                confidence: decision.confidence,
                severity: decision.severity,
                riskScore: decision.riskScore,
                evidenceHash: hashEvidence(text, opts.salt),
                rawText: this.config.storage.storeRawTextForAppeal
                    ? text
                    : null,
                redactedText:
                    this.config.storage.redactBeforePersist && text.length > 0
                        ? redactEvidence(text)
                        : null,
                ruleVersion: opts.ruleVersion ?? MODERATION_RULE_VERSION,
                operator: opts.operator ?? null,
                createdAt: now,
                expireAt
            }
        )

        await this.ctx.database.set(
            'chatluna_moderation_user',
            { id: req.userKey },
            {
                lastEventAt: now,
                updatedAt: now
            }
        )

        return row
    }

    async listUserEvents(
        userKey: string,
        limit: number = 20
    ): Promise<ModerationEventRow[]> {
        return this.ctx.database.get(
            'chatluna_moderation_event',
            {
                userId: userKey
            },
            {
                sort: {
                    createdAt: 'desc'
                },
                limit
            }
        )
    }

    async getEvent(eventId: string): Promise<ModerationEventRow | undefined> {
        const [row] = await this.ctx.database.get('chatluna_moderation_event', {
            id: eventId
        })
        return row
    }

    async createReview(
        eventId: string,
        decision: string,
        operator?: string,
        note?: string
    ): Promise<ModerationReviewRow> {
        const event = await this.getEvent(eventId)
        if (!event) {
            throw new Error('moderation event not found')
        }

        const now = new Date()
        return this.ctx.database.create('chatluna_moderation_review', {
            id: randomUUID(),
            eventId,
            userId: event.userId,
            status: 'open',
            decision,
            operator: operator ?? null,
            note: note ?? null,
            createdAt: now,
            updatedAt: now
        })
    }

    async recordOverride(
        eventId: string,
        action: ModerationAction,
        operator: string,
        reason?: string
    ): Promise<ModerationReviewRow> {
        const event = await this.getEvent(eventId)
        if (!event) {
            throw new Error('moderation event not found')
        }

        const now = new Date()
        return this.ctx.database.create('chatluna_moderation_review', {
            id: randomUUID(),
            eventId,
            userId: event.userId,
            status: 'override',
            decision: action,
            operator,
            note: reason ?? null,
            createdAt: now,
            updatedAt: now
        })
    }

    async purgeExpiredEvidence(now: Date = new Date()): Promise<number> {
        const rows = await this.ctx.database.get(
            'chatluna_moderation_event',
            {}
        )
        const expired = rows.filter(
            (row) =>
                row.expireAt != null &&
                row.expireAt.getTime() <= now.getTime() &&
                (row.rawText != null || row.redactedText != null)
        )

        await Promise.all(
            expired.map((row) =>
                this.ctx.database.set(
                    'chatluna_moderation_event',
                    { id: row.id },
                    {
                        rawText: null,
                        redactedText: null,
                        expireAt: null
                    }
                )
            )
        )

        return expired.length
    }

    private toState(row: ModerationUserRow): UserRiskState {
        return {
            userKey: row.id,
            trustScore: row.trustScore,
            reviewLevel: row.reviewLevel as 0 | 1 | 2 | 3,
            state: row.state as UserRiskState['state'],
            strikeCount: row.strikeCount,
            lastEventAt: row.lastEventAt?.getTime()
        }
    }
}
