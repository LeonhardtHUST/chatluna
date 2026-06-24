import type { ModerationSeverity } from '../types'

export function clampRiskScore(score: number): number {
    return Math.min(100, Math.max(0, score))
}

export function scoreSeverity(severity: ModerationSeverity): number {
    if (severity === 0) {
        return 0
    }

    if (severity === 1) {
        return 5
    }

    if (severity === 2) {
        return 12
    }

    if (severity === 3) {
        return 25
    }

    if (severity === 4) {
        return 45
    }

    return 70
}

export function addSeverityScore(
    score: number,
    severity: ModerationSeverity
): number {
    return clampRiskScore(score + scoreSeverity(severity))
}
