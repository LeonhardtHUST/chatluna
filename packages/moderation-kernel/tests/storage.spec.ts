import { assert } from 'chai'
import memory from '@koishijs/plugin-database-memory'
import { Context } from 'koishi'
import {
    DEFAULT_MODERATION_CONFIG,
    ModerationService
} from '../src'
import type { ModerationConfig, ModerationDecision } from '../src'

function cfg(
    storage: Partial<ModerationConfig['storage']> = {}
): ModerationConfig {
    return {
        ...DEFAULT_MODERATION_CONFIG,
        storage: {
            ...DEFAULT_MODERATION_CONFIG.storage,
            ...storage
        }
    }
}

async function createRepo(config: ModerationConfig = cfg()) {
    const app = new Context()
    app.plugin(memory)
    app.plugin(ModerationService, config)
    await app.start()

    return {
        app,
        repo: (app as unknown as { moderation: ModerationService }).moderation
            .repository
    }
}

const decision: ModerationDecision = {
    action: 'block',
    labels: ['test'],
    reasons: ['policy'],
    confidence: 0.8,
    severity: 3,
    riskScore: 60
}

describe('moderation storage', () => {
    it('does not store raw text by default', async () => {
        const { app, repo } = await createRepo()
        const event = await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private evidence'
            },
            decision
        )

        assert.equal(event.rawText, null)
        assert.notEqual(event.evidenceHash, '')
        assert.notInclude(event.redactedText ?? '', 'private evidence')
        await app.stop()
    })

    it('stores raw text with expiration when explicitly enabled', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
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
                contentText: 'appeal evidence'
            },
            decision,
            { now }
        )

        assert.equal(event.rawText, 'appeal evidence')
        assert.equal(
            event.expireAt?.toISOString(),
            '2026-07-01T00:00:00.000Z'
        )
        await app.stop()
    })

    it('creates and updates user state', async () => {
        const { app, repo } = await createRepo()

        assert.deepInclude(await repo.getOrCreateUserState('user-1'), {
            userKey: 'user-1',
            trustScore: 0,
            reviewLevel: 0,
            state: 'normal',
            strikeCount: 0
        })

        assert.deepInclude(
            await repo.updateUserState('user-1', {
                trustScore: 42,
                reviewLevel: 2,
                state: 'restricted',
                strikeCount: 3
            }),
            {
                userKey: 'user-1',
                trustScore: 42,
                reviewLevel: 2,
                state: 'restricted',
                strikeCount: 3
            }
        )
        await app.stop()
    })

    it('lists events by user', async () => {
        const { app, repo } = await createRepo()

        await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'first'
            },
            decision,
            { now: new Date('2026-06-24T00:00:00.000Z') }
        )
        await repo.recordEvent(
            {
                stage: 'output',
                userKey: 'user-1',
                contentText: 'second'
            },
            decision,
            { now: new Date('2026-06-25T00:00:00.000Z') }
        )
        await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-2',
                contentText: 'third'
            },
            decision
        )

        const events = await repo.listUserEvents('user-1', 1)
        assert.lengthOf(events, 1)
        assert.equal(events[0].stage, 'output')
        await app.stop()
    })

    it('creates reviews and overrides', async () => {
        const { app, repo } = await createRepo()
        const event = await repo.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'review evidence'
            },
            decision
        )

        const review = await repo.createReview(
            event.id,
            'needs-admin',
            'admin',
            'case note'
        )
        const override = await repo.recordOverride(
            event.id,
            'allow',
            'admin',
            'appeal accepted'
        )

        assert.equal(review.status, 'open')
        assert.equal(review.decision, 'needs-admin')
        assert.equal(override.status, 'override')
        assert.equal(override.decision, 'allow')
        await app.stop()
    })
})

export { createRepo, cfg, decision }
