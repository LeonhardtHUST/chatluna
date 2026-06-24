import { Schema } from 'koishi'
import { DEFAULT_BLOCK_REPLY } from './constants'

export interface ModerationConfig {
    enabled: boolean
    shadowMode: boolean

    inputEnabled: boolean
    preSearchEnabled: boolean
    outputEnabled: boolean

    backend: {
        useKoishiCensor: boolean
        useKeywordRules: boolean
        useLlmRecheck: boolean
    }

    storage: {
        storeRawTextForAppeal: boolean
        rawTextRetentionDays: number
        eventRetentionDays: number
        redactBeforePersist: boolean
    }

    enforcement: {
        fixedBlockReply: string
        maxRechecksPerRequest: number
    }

    compatibility: {
        mapCoreCensor: boolean
        mapSearchSafetyConfig: boolean
    }
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
    enabled: true,
    shadowMode: true,
    inputEnabled: true,
    preSearchEnabled: true,
    outputEnabled: true,
    backend: {
        useKoishiCensor: true,
        useKeywordRules: true,
        useLlmRecheck: false
    },
    storage: {
        storeRawTextForAppeal: false,
        rawTextRetentionDays: 7,
        eventRetentionDays: 180,
        redactBeforePersist: true
    },
    enforcement: {
        fixedBlockReply: DEFAULT_BLOCK_REPLY,
        maxRechecksPerRequest: 1
    },
    compatibility: {
        mapCoreCensor: true,
        mapSearchSafetyConfig: true
    }
}

export const Config: Schema<ModerationConfig> = Schema.object({
    enabled: Schema.boolean().default(DEFAULT_MODERATION_CONFIG.enabled),
    shadowMode: Schema.boolean().default(DEFAULT_MODERATION_CONFIG.shadowMode),
    inputEnabled: Schema.boolean().default(
        DEFAULT_MODERATION_CONFIG.inputEnabled
    ),
    preSearchEnabled: Schema.boolean().default(
        DEFAULT_MODERATION_CONFIG.preSearchEnabled
    ),
    outputEnabled: Schema.boolean().default(
        DEFAULT_MODERATION_CONFIG.outputEnabled
    ),
    backend: Schema.object({
        useKoishiCensor: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.backend.useKoishiCensor
        ),
        useKeywordRules: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.backend.useKeywordRules
        ),
        useLlmRecheck: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.backend.useLlmRecheck
        )
    }).default(DEFAULT_MODERATION_CONFIG.backend),
    storage: Schema.object({
        storeRawTextForAppeal: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.storage.storeRawTextForAppeal
        ),
        rawTextRetentionDays: Schema.number()
            .min(1)
            .step(1)
            .default(DEFAULT_MODERATION_CONFIG.storage.rawTextRetentionDays),
        eventRetentionDays: Schema.number()
            .min(1)
            .step(1)
            .default(DEFAULT_MODERATION_CONFIG.storage.eventRetentionDays),
        redactBeforePersist: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.storage.redactBeforePersist
        )
    }).default(DEFAULT_MODERATION_CONFIG.storage),
    enforcement: Schema.object({
        fixedBlockReply: Schema.string().default(
            DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply
        ),
        maxRechecksPerRequest: Schema.number()
            .min(0)
            .step(1)
            .default(
                DEFAULT_MODERATION_CONFIG.enforcement.maxRechecksPerRequest
            )
    }).default(DEFAULT_MODERATION_CONFIG.enforcement),
    compatibility: Schema.object({
        mapCoreCensor: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.compatibility.mapCoreCensor
        ),
        mapSearchSafetyConfig: Schema.boolean().default(
            DEFAULT_MODERATION_CONFIG.compatibility.mapSearchSafetyConfig
        )
    }).default(DEFAULT_MODERATION_CONFIG.compatibility)
})
