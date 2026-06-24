import { assert } from 'chai'
import { hashEvidence } from '../src'
import { cfg, createRepo, decision } from './storage.spec'

describe('moderation retention', () => {
    it('removes expired raw evidence', async () => {
        const { app, repo } = await createRepo(
            cfg({
                storeRawTextForAppeal: true,
                rawTextRetentionDays: 1
            })
        )
        const event = await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'expired evidence'
            },
            decision,
            { now: new Date('2026-06-24T00:00:00.000Z') }
        )

        assert.equal(
            await repo.purgeExpiredEvidence(
                new Date('2026-06-26T00:00:00.000Z')
            ),
            1
        )

        const stored = await repo.getEvent(event.id)
        assert.equal(stored?.rawText, null)
        assert.equal(stored?.redactedText, null)
        assert.equal(stored?.expireAt, null)
        await app.stop()
    })

    it('keeps unexpired raw evidence', async () => {
        const { app, repo } = await createRepo(
            cfg({
                storeRawTextForAppeal: true,
                rawTextRetentionDays: 7
            })
        )
        const event = await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'fresh evidence'
            },
            decision,
            { now: new Date('2026-06-24T00:00:00.000Z') }
        )

        assert.equal(
            await repo.purgeExpiredEvidence(
                new Date('2026-06-25T00:00:00.000Z')
            ),
            0
        )

        const stored = await repo.getEvent(event.id)
        assert.equal(stored?.rawText, 'fresh evidence')
        await app.stop()
    })

    it('hashes normalized evidence consistently', () => {
        assert.equal(
            hashEvidence('same   text\nvalue'),
            hashEvidence(' same text value ')
        )
    })
})
