import type { ModerationUserState } from '../types'

export interface RiskThresholds {
    watch: number
    restricted: number
    suspended: number
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
    watch: 25,
    restricted: 55,
    suspended: 85
}

export function getUserStateByRiskScore(
    score: number,
    thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS
): ModerationUserState {
    if (score >= thresholds.suspended) {
        return 'suspended'
    }

    if (score >= thresholds.restricted) {
        return 'restricted'
    }

    if (score >= thresholds.watch) {
        return 'watch'
    }

    return 'normal'
}
