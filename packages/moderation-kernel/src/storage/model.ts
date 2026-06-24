import { Context } from 'koishi'

export interface ModerationUserRow {
    id: string
    platform: string
    channelId?: string | null
    trustScore: number
    reviewLevel: number
    state: string
    strikeCount: number
    lastEventAt?: Date | null
    createdAt: Date
    updatedAt: Date
    version: number
}

export interface ModerationEventRow {
    id: string
    userId: string
    conversationId?: string | null
    stage: string
    action: string
    labels: string[]
    reasons: string[]
    confidence: number
    severity: number
    riskScore: number
    evidenceHash: string
    rawText?: string | null
    redactedText?: string | null
    ruleVersion: string
    operator?: string | null
    createdAt: Date
    expireAt?: Date | null
}

export interface ModerationReviewRow {
    id: string
    eventId: string
    userId: string
    status: string
    decision: string
    operator?: string | null
    note?: string | null
    createdAt: Date
    updatedAt: Date
}

export function defineModerationModels(ctx: Context) {
    ctx.database.extend(
        'chatluna_moderation_user',
        {
            id: {
                type: 'char',
                length: 255
            },
            platform: {
                type: 'char',
                length: 255
            },
            channelId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            trustScore: {
                type: 'float',
                initial: 0
            },
            reviewLevel: {
                type: 'integer',
                initial: 0
            },
            state: {
                type: 'char',
                length: 20
            },
            strikeCount: {
                type: 'integer',
                initial: 0
            },
            lastEventAt: {
                type: 'timestamp',
                nullable: true
            },
            createdAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            },
            updatedAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            },
            version: {
                type: 'integer',
                initial: 1
            }
        },
        {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        }
    )

    ctx.database.extend(
        'chatluna_moderation_event',
        {
            id: {
                type: 'char',
                length: 255
            },
            userId: {
                type: 'char',
                length: 255
            },
            conversationId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            stage: {
                type: 'char',
                length: 40
            },
            action: {
                type: 'char',
                length: 40
            },
            labels: 'json',
            reasons: 'json',
            confidence: {
                type: 'float',
                initial: 0
            },
            severity: {
                type: 'integer',
                initial: 0
            },
            riskScore: {
                type: 'float',
                initial: 0
            },
            evidenceHash: {
                type: 'char',
                length: 255
            },
            rawText: {
                type: 'text',
                nullable: true
            },
            redactedText: {
                type: 'text',
                nullable: true
            },
            ruleVersion: {
                type: 'char',
                length: 80
            },
            operator: {
                type: 'char',
                length: 255,
                nullable: true
            },
            createdAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            },
            expireAt: {
                type: 'timestamp',
                nullable: true
            }
        },
        {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        }
    )

    ctx.database.extend(
        'chatluna_moderation_review',
        {
            id: {
                type: 'char',
                length: 255
            },
            eventId: {
                type: 'char',
                length: 255
            },
            userId: {
                type: 'char',
                length: 255
            },
            status: {
                type: 'char',
                length: 40
            },
            decision: 'text',
            operator: {
                type: 'char',
                length: 255,
                nullable: true
            },
            note: {
                type: 'text',
                nullable: true
            },
            createdAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            },
            updatedAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            }
        },
        {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        }
    )
}

declare module 'koishi' {
    interface Tables {
        chatluna_moderation_user: ModerationUserRow
        chatluna_moderation_event: ModerationEventRow
        chatluna_moderation_review: ModerationReviewRow
    }
}
