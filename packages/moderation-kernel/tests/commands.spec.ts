import { assert } from 'chai'
import { cfg, createService } from './service.spec'
import { formatEventCase, recordUserStateOverride, userPatch } from '../src'
import { decision } from './storage.spec'

describe('moderation admin commands', () => {
    it('formats cases without raw evidence by default', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 7
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.notInclude(formatEventCase(event), 'private raw evidence')
        await app.stop()
    })

    it('formats raw evidence only with explicit raw option', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 7
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.include(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: true,
                now
            }),
            'private raw evidence'
        )
        await app.stop()
    })

    it('hides raw evidence when raw option is unavailable or expired', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 1
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.notInclude(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: false,
                now
            }),
            'private raw evidence'
        )
        assert.notInclude(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: true,
                now: new Date('2026-06-25T00:00:00.000Z')
            }),
            'private raw evidence'
        )
        await app.stop()
    })

    it('changes user state and creates review audit rows', async () => {
        const { app, service } = await createService()

        await recordUserStateOverride(
            service,
            'user-1',
            userPatch({
                suspend: true
            }),
            'admin',
            'manual suspend'
        )

        const state = await service.getUserRiskState('user-1')
        const reviews = await app.database.get('chatluna_moderation_review', {})

        assert.equal(state.state, 'suspended')
        assert.equal(state.reviewLevel, 3)
        assert.lengthOf(reviews, 1)
        assert.equal(reviews[0].status, 'open')
        await app.stop()
    })

    it('restores users to normal state', () => {
        assert.deepEqual(
            userPatch({
                restore: true
            }),
            {
                state: 'normal',
                reviewLevel: 0,
                strikeCount: 0,
                trustScore: 0
            }
        )
    })
})
