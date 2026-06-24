import type { ModerationRepository } from './repository'

export function purgeExpiredEvidence(
    repository: ModerationRepository,
    now: Date = new Date()
): Promise<number> {
    return repository.purgeExpiredEvidence(now)
}
