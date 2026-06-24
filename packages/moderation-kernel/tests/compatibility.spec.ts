import { assert } from 'chai'
import {
    applyServiceSearchCompatibility,
    DEFAULT_BLOCK_REPLY,
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
})
