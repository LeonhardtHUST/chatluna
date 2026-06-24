import { assert } from 'chai'
import memory from '@koishijs/plugin-database-memory'
import { Context } from 'koishi'
import {
    DEFAULT_MODERATION_CONFIG,
    ModerationService
} from '../src'
import type {
    ModerationConfig,
    ModerationDecision,
    ModerationRequest
} from '../src'

function cfg(config: Partial<ModerationConfig> = {}): ModerationConfig {
    return {
        ...DEFAULT_MODERATION_CONFIG,
        ...config,
        backend: {
            ...DEFAULT_MODERATION_CONFIG.backend,
            ...config.backend
        },
        storage: {
            ...DEFAULT_MODERATION_CONFIG.storage,
            ...config.storage
        },
        enforcement: {
            ...DEFAULT_MODERATION_CONFIG.enforcement,
            ...config.enforcement
        },
        compatibility: {
            ...DEFAULT_MODERATION_CONFIG.compatibility,
            ...config.compatibility
        }
    }
}

async function createService(config: ModerationConfig = cfg()) {
    const app = new Context()
    app.plugin(memory)
    app.plugin(ModerationService, config)
    await app.start()

    return {
        app,
        service: app.moderation
    }
}

const session = {
    platform: 'test',
    userId: 'user-1',
    channelId: 'channel-1'
}

describe('moderation service', () => {
    it('registers ctx.moderation', async () => {
        const { app, service } = await createService()

        assert.instanceOf(service, ModerationService)
        assert.exists(service.repository)
        await app.stop()
    })

    it('returns allow without recording when disabled', async () => {
        const { app, service } = await createService(
            cfg({
                enabled: false,
                shadowMode: false
            })
        )
        const decision = await service.evaluateInput(
            session,
            'moderation-block-test'
        )
        const events = await app.database.get('chatluna_moderation_event', {})

        assert.equal(decision.action, 'allow')
        assert.lengthOf(events, 0)
        await app.stop()
    })

    it('records shadow block but returns allow', async () => {
        const { app, service } = await createService()
        const decision = await service.evaluateInput(
            session,
            'moderation-block-test'
        )
        const events = await app.database.get('chatluna_moderation_event', {})

        assert.equal(decision.action, 'allow')
        assert.lengthOf(events, 1)
        assert.equal(events[0].action, 'block')
        assert.equal(decision.eventId, events[0].id)
        await app.stop()
    })

    it('returns actionable block when enforce mode is enabled', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false
            })
        )
        const decision = await service.evaluateInput(
            session,
            'moderation-block-test'
        )

        assert.equal(decision.action, 'block')
        assert.exists(decision.fixedReply)
        await app.stop()
    })

    it('keeps raw text private by default', async () => {
        const { app, service } = await createService()
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test private evidence'
        )
        const event = await service.repository.getEvent(decision.eventId!)

        assert.equal(event?.rawText, null)
        assert.notInclude(event?.redactedText ?? '', 'private evidence')
        await app.stop()
    })

    it('stage wrappers call the common evaluate path', async () => {
        const { app, service } = await createService()
        const stages: string[] = []
        const evaluate = service.evaluate.bind(service)

        service.evaluate = (req: ModerationRequest) => {
            stages.push(req.stage)
            return evaluate(req)
        }

        await service.evaluateInput(session, 'hello')
        await service.evaluatePreSearch(session, 'hello', [])
        await service.evaluateOutput(session, 'hello')

        assert.deepEqual(stages, ['input', 'pre-search', 'output'])
        await app.stop()
    })
})

export { cfg, createService, session }
