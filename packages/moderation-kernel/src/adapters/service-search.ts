import {
    DEFAULT_MODERATION_CONFIG,
    ModerationConfig,
    ModerationKeywordGroup
} from '../config'

interface SearchKeywordGroup {
    name: string
    keywords: string
}

interface SearchConfig {
    replySafetyCheckFails?: string
    safetyBlockKeywordGroups?: SearchKeywordGroup[]
    safetyRecheckKeywordGroups?: SearchKeywordGroup[]
    promptAttackWarning?: string
}

interface Logger {
    warn(msg: string): void
}

const warned = new Set<string>()

function warn(logger: Logger | undefined, key: string, path: string) {
    if (warned.has(key)) {
        return
    }

    warned.add(key)
    logger?.warn(
        `[moderation] deprecated config key ${key} is mapped to ${path}; please migrate.`
    )
}

function groups(items: SearchKeywordGroup[] = []): ModerationKeywordGroup[] {
    return items
        .map((group) => ({
            name: group.name,
            keywords: group.keywords
                .split(/[,，\r\n]+/)
                .map((keyword) => keyword.trim())
                .filter((keyword) => keyword.length > 0)
        }))
        .filter((group) => group.keywords.length > 0)
}

export function applyServiceSearchCompatibility(
    moderation: ModerationConfig,
    config: SearchConfig,
    logger?: Logger
) {
    if (!moderation.compatibility.mapSearchSafetyConfig) {
        return
    }

    if (
        moderation.enforcement.fixedBlockReply ===
            DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply &&
        config.replySafetyCheckFails?.trim()
    ) {
        warn(
            logger,
            'replySafetyCheckFails',
            'moderation.enforcement.fixedBlockReply'
        )
        moderation.enforcement.fixedBlockReply = config.replySafetyCheckFails
    }

    if (
        moderation.rules.blockKeywordGroups.length < 1 &&
        config.safetyBlockKeywordGroups?.length
    ) {
        warn(
            logger,
            'safetyBlockKeywordGroups',
            'moderation.rules.blockKeywordGroups'
        )
        moderation.rules.blockKeywordGroups = groups(
            config.safetyBlockKeywordGroups
        )
    }

    if (
        moderation.rules.reviewKeywordGroups.length < 1 &&
        config.safetyRecheckKeywordGroups?.length
    ) {
        warn(
            logger,
            'safetyRecheckKeywordGroups',
            'moderation.rules.reviewKeywordGroups'
        )
        moderation.rules.reviewKeywordGroups = groups(
            config.safetyRecheckKeywordGroups
        )
    }

    if (
        moderation.rules.promptAttackWarning.length < 1 &&
        config.promptAttackWarning?.trim()
    ) {
        warn(
            logger,
            'promptAttackWarning',
            'moderation.rules.promptAttackWarning'
        )
        moderation.rules.promptAttackWarning = config.promptAttackWarning
    }
}
