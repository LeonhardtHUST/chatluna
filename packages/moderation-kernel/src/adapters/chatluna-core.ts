import type { ModerationConfig } from '../config'

interface CoreConfig {
    censor: boolean
    rawOnCensor: boolean
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

export function shouldUseCoreOutputModeration(
    config: CoreConfig,
    moderation: ModerationConfig,
    logger?: Logger
) {
    if (!moderation.enabled || !moderation.outputEnabled) {
        return false
    }

    if (!moderation.compatibility.mapCoreCensor) {
        return true
    }

    warn(logger, 'censor', 'moderation.outputEnabled')
    warn(logger, 'rawOnCensor', 'moderation compatibility metadata')

    return config.censor
}

export function coreOutputModerationMetadata(config: CoreConfig) {
    return {
        source: 'chatluna-core-censor',
        rawOnCensor: config.rawOnCensor
    }
}
