import { assert } from 'chai'
import {
    applyServiceSearchCompatibility,
    DEFAULT_MODERATION_CONFIG,
    DEFAULT_BLOCK_REPLY,
    serviceSearchSafetyConfig,
    shouldUseCoreOutputModeration
} from '../src'
import { cfg, createService, session } from './service.spec'

function logger() {
    const warnings: string[] = []

    return {
        warnings,
        logger: {
            warn(msg: string) {
                warnings.push(msg)
            }
        }
    }
}

describe('moderation compatibility mapping', () => {
    it('maps core censor unless explicit moderation compatibility disables it', () => {
        const log = logger()
        const config = cfg()

        assert.isFalse(
            shouldUseCoreOutputModeration(
                {
                    censor: false,
                    rawOnCensor: false
                },
                config,
                log.logger
            )
        )
        assert.isTrue(
            shouldUseCoreOutputModeration(
                {
                    censor: false,
                    rawOnCensor: false
                },
                cfg({
                    compatibility: {
                        mapCoreCensor: false
                    }
                }),
                log.logger
            )
        )
        shouldUseCoreOutputModeration(
            {
                censor: true,
                rawOnCensor: true
            },
            config,
            log.logger
        )
        assert.equal(log.warnings.length, 2)
    })

    it('maps service-search fixed reply and keyword groups', async () => {
        const config = cfg({
            shadowMode: false
        })

        applyServiceSearchCompatibility(config, {
            replySafetyCheckFails: 'legacy fixed reply',
            safetyBlockKeywordGroups: [
                {
                    name: 'legacy-block',
                    keywords: 'blocked-legacy'
                }
            ],
            safetyRecheckKeywordGroups: [
                {
                    name: 'legacy-review',
                    keywords: 'review-legacy'
                }
            ],
            promptAttackWarning: 'legacy prompt warning'
        })

        const { app, service } = await createService(config)
        const block = await service.evaluateInput(session, 'blocked-legacy')
        const review = await service.evaluateInput(session, 'review-legacy')

        assert.equal(config.enforcement.fixedBlockReply, 'legacy fixed reply')
        assert.equal(config.rules.promptAttackWarning, 'legacy prompt warning')
        assert.equal(block.action, 'block')
        assert.deepEqual(block.labels, ['legacy-block'])
        assert.equal(review.action, 'review')
        assert.deepEqual(review.labels, ['legacy-review'])
        await app.stop()
    })

    it('keeps explicit moderation config ahead of legacy search config', () => {
        const config = cfg({
            enforcement: {
                fixedBlockReply: 'explicit reply'
            },
            rules: {
                blockKeywordGroups: [
                    {
                        name: 'explicit-block',
                        keywords: ['explicit']
                    }
                ],
                reviewKeywordGroups: [
                    {
                        name: 'explicit-review',
                        keywords: ['explicit-review']
                    }
                ],
                promptAttackWarning: 'explicit warning'
            }
        })

        applyServiceSearchCompatibility(config, {
            replySafetyCheckFails: DEFAULT_BLOCK_REPLY,
            safetyBlockKeywordGroups: [
                {
                    name: 'legacy-block',
                    keywords: 'legacy'
                }
            ],
            safetyRecheckKeywordGroups: [
                {
                    name: 'legacy-review',
                    keywords: 'legacy-review'
                }
            ],
            promptAttackWarning: 'legacy warning'
        })

        assert.equal(config.enforcement.fixedBlockReply, 'explicit reply')
        assert.deepEqual(config.rules.blockKeywordGroups, [
            {
                name: 'explicit-block',
                keywords: ['explicit']
            }
        ])
        assert.deepEqual(config.rules.reviewKeywordGroups, [
            {
                name: 'explicit-review',
                keywords: ['explicit-review']
            }
        ])
        assert.equal(config.rules.promptAttackWarning, 'explicit warning')
    })

    it('uses moderation as the effective service-search safety source', () => {
        const config = cfg({
            enforcement: {
                fixedBlockReply: 'moderation reply'
            },
            rules: {
                blockKeywordGroups: [
                    {
                        name: 'moderation-block',
                        keywords: ['moderation keyword']
                    }
                ],
                reviewKeywordGroups: [
                    {
                        name: 'moderation-review',
                        keywords: ['moderation review']
                    }
                ],
                promptAttackWarning: 'moderation warning'
            }
        })
        const safety = serviceSearchSafetyConfig(config, {
            replySafetyCheckFails: 'legacy reply',
            safetyBlockKeywordGroups: [
                {
                    name: 'legacy-block',
                    keywords: 'legacy keyword'
                }
            ],
            safetyRecheckKeywordGroups: [
                {
                    name: 'legacy-review',
                    keywords: 'legacy review'
                }
            ],
            promptAttackWarning: 'legacy warning'
        })

        assert.equal(safety.replySafetyCheckFails, 'moderation reply')
        assert.deepEqual(safety.safetyBlockKeywordGroups, [
            {
                name: 'moderation-block',
                keywords: ['moderation keyword']
            }
        ])
        assert.deepEqual(safety.safetyRecheckKeywordGroups, [
            {
                name: 'moderation-review',
                keywords: ['moderation review']
            }
        ])
        assert.equal(safety.promptAttackWarning, 'moderation warning')
    })

    it('falls back to legacy service-search safety when moderation is disabled', () => {
        const safety = serviceSearchSafetyConfig(
            cfg({
                enabled: false
            }),
            {
                replySafetyCheckFails: 'legacy reply',
                safetyBlockKeywordGroups: [
                    {
                        name: 'legacy-block',
                        keywords: 'alpha,beta'
                    }
                ],
                safetyRecheckKeywordGroups: [
                    {
                        name: 'legacy-review',
                        keywords: 'gamma,delta'
                    }
                ],
                promptAttackWarning: 'legacy warning'
            }
        )

        assert.equal(safety.replySafetyCheckFails, 'legacy reply')
        assert.deepEqual(safety.safetyBlockKeywordGroups, [
            {
                name: 'legacy-block',
                keywords: ['alpha', 'beta']
            }
        ])
        assert.deepEqual(safety.safetyRecheckKeywordGroups, [
            {
                name: 'legacy-review',
                keywords: ['gamma', 'delta']
            }
        ])
        assert.equal(safety.promptAttackWarning, 'legacy warning')
    })

    it('uses moderation defaults when legacy service-search safety is absent', () => {
        const safety = serviceSearchSafetyConfig(undefined, {})

        assert.equal(
            safety.replySafetyCheckFails,
            DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply
        )
        assert.deepEqual(
            safety.safetyBlockKeywordGroups,
            DEFAULT_MODERATION_CONFIG.rules.blockKeywordGroups
        )
        assert.deepEqual(
            safety.safetyRecheckKeywordGroups,
            DEFAULT_MODERATION_CONFIG.rules.reviewKeywordGroups
        )
        assert.equal(
            safety.promptAttackWarning,
            DEFAULT_MODERATION_CONFIG.rules.promptAttackWarning
        )
    })

    it('ships empty default keyword groups and prompt warning', () => {
        assert.deepEqual(
            DEFAULT_MODERATION_CONFIG.rules.blockKeywordGroups,
            []
        )
        assert.deepEqual(
            DEFAULT_MODERATION_CONFIG.rules.reviewKeywordGroups,
            []
        )
        assert.include(
            DEFAULT_MODERATION_CONFIG.rules.shortKeywordContextRules.map(
                (rule) => rule.term
            ),
            '中共'
        )
        assert.include(
            DEFAULT_MODERATION_CONFIG.rules.promptAttackWarning,
            'Security boundary'
        )
    })
})
