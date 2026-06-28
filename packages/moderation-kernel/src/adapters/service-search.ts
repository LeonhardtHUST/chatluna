import {
    DEFAULT_MODERATION_CONFIG,
    ModerationConfig,
    ModerationKeywordGroup,
    ModerationShortKeywordContextRule,
    splitKeywords
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

export interface ServiceSearchSafetyConfig {
    replySafetyCheckFails?: string
    safetyBlockKeywordGroups: ModerationKeywordGroup[]
    safetyRecheckKeywordGroups: ModerationKeywordGroup[]
    shortKeywordContextRules: ModerationShortKeywordContextRule[]
    promptAttackWarning: string
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
            keywords: splitKeywords(group.keywords)
        }))
        .filter((group) => group.keywords.length > 0)
}

function sameGroups(
    left: ModerationKeywordGroup[],
    right: ModerationKeywordGroup[]
) {
    return JSON.stringify(left) === JSON.stringify(right)
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
        config.replySafetyCheckFails?.trim() &&
        config.replySafetyCheckFails !==
            DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply
    ) {
        warn(
            logger,
            'replySafetyCheckFails',
            'moderation.enforcement.fixedBlockReply'
        )
        moderation.enforcement.fixedBlockReply = config.replySafetyCheckFails
    }

    const blockGroups = groups(config.safetyBlockKeywordGroups)

    if (
        (moderation.rules.blockKeywordGroups.length < 1 ||
            sameGroups(
                moderation.rules.blockKeywordGroups,
                DEFAULT_MODERATION_CONFIG.rules.blockKeywordGroups
            )) &&
        blockGroups.length > 0 &&
        !sameGroups(
            blockGroups,
            DEFAULT_MODERATION_CONFIG.rules.blockKeywordGroups
        )
    ) {
        warn(
            logger,
            'safetyBlockKeywordGroups',
            'moderation.rules.blockKeywordGroups'
        )
        moderation.rules.blockKeywordGroups = blockGroups
    }

    const reviewGroups = groups(config.safetyRecheckKeywordGroups)

    if (
        (moderation.rules.reviewKeywordGroups.length < 1 ||
            sameGroups(
                moderation.rules.reviewKeywordGroups,
                DEFAULT_MODERATION_CONFIG.rules.reviewKeywordGroups
            )) &&
        reviewGroups.length > 0 &&
        !sameGroups(
            reviewGroups,
            DEFAULT_MODERATION_CONFIG.rules.reviewKeywordGroups
        )
    ) {
        warn(
            logger,
            'safetyRecheckKeywordGroups',
            'moderation.rules.reviewKeywordGroups'
        )
        moderation.rules.reviewKeywordGroups = reviewGroups
    }

    if (
        (moderation.rules.promptAttackWarning.length < 1 ||
            moderation.rules.promptAttackWarning ===
                DEFAULT_MODERATION_CONFIG.rules.promptAttackWarning) &&
        config.promptAttackWarning?.trim() &&
        config.promptAttackWarning !==
            DEFAULT_MODERATION_CONFIG.rules.promptAttackWarning
    ) {
        warn(
            logger,
            'promptAttackWarning',
            'moderation.rules.promptAttackWarning'
        )
        moderation.rules.promptAttackWarning = config.promptAttackWarning
    }
}

export function serviceSearchSafetyConfig(
    moderation: ModerationConfig | undefined,
    config: SearchConfig
): ServiceSearchSafetyConfig {
    if (moderation?.enabled) {
        return {
            replySafetyCheckFails:
                moderation.enforcement.fixedBlockReply ||
                config.replySafetyCheckFails,
            safetyBlockKeywordGroups: moderation.rules.blockKeywordGroups,
            safetyRecheckKeywordGroups: moderation.rules.reviewKeywordGroups,
            shortKeywordContextRules: moderation.rules.shortKeywordContextRules,
            promptAttackWarning:
                moderation.rules.promptAttackWarning ||
                config.promptAttackWarning ||
                ''
        }
    }

    const blockGroups = groups(config.safetyBlockKeywordGroups)
    const reviewGroups = groups(config.safetyRecheckKeywordGroups)

    return {
        replySafetyCheckFails:
            config.replySafetyCheckFails ||
            DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply,
        safetyBlockKeywordGroups:
            blockGroups.length > 0
                ? blockGroups
                : DEFAULT_MODERATION_CONFIG.rules.blockKeywordGroups,
        safetyRecheckKeywordGroups:
            reviewGroups.length > 0
                ? reviewGroups
                : DEFAULT_MODERATION_CONFIG.rules.reviewKeywordGroups,
        shortKeywordContextRules:
            DEFAULT_MODERATION_CONFIG.rules.shortKeywordContextRules,
        promptAttackWarning:
            config.promptAttackWarning ||
            DEFAULT_MODERATION_CONFIG.rules.promptAttackWarning
    }
}
