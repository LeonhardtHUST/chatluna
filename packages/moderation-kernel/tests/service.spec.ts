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
        rules: {
            ...DEFAULT_MODERATION_CONFIG.rules,
            ...config.rules
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

    it('records remote api blocks without raw text by default', async () => {
        const { app, service } = await createService()
        const decision = await service.recordRemoteApiBlock(
            session,
            'remote blocked text',
            {
                conversationId: 'conversation-1',
                provider: 'deepseek'
            }
        )
        const event = await service.repository.getEvent(decision.eventId!)

        assert.equal(decision.action, 'block')
        assert.equal(event?.stage, 'remote-api')
        assert.equal(event?.action, 'block')
        assert.deepEqual(event?.labels, ['remote_api_content_risk'])
        assert.equal(event?.rawText, null)
        assert.isString(event?.evidenceHash)
        await app.stop()
    })

    it('stores remote api block raw text only when explicitly enabled', async () => {
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 7,
                    eventRetentionDays: 180,
                    redactBeforePersist: true
                }
            })
        )
        const decision = await service.recordRemoteApiBlock(
            session,
            'remote blocked text'
        )
        const event = await service.repository.getEvent(decision.eventId!)

        assert.equal(event?.rawText, 'remote blocked text')
        assert.instanceOf(event?.expireAt, Date)
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

    it('keeps review decisions unchanged when llm recheck is disabled', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false
            })
        )
        let calls = 0

        service.registerLlmRecheckBackend(async () => {
            calls += 1
            return {
                action: 'allow'
            }
        })
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'review')
        assert.equal(calls, 0)
        await app.stop()
    })

    it('allows review decisions after llm recheck allow', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => ({
            action: 'allow',
            confidence: 0.9,
            severity: 0,
            riskScore: 0,
            reasons: ['safe_context']
        }))
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'allow')
        assert.include(decision.reasons, 'llm_recheck.allow')
        await app.stop()
    })

    it('blocks review decisions after llm recheck block', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => ({
            action: 'block',
            labels: ['llm_block'],
            confidence: 0.95,
            severity: 5,
            riskScore: 80,
            reasons: ['unsafe_context']
        }))
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )
        const event = await service.repository.getEvent(decision.eventId!)

        assert.equal(decision.action, 'block')
        assert.deepEqual(decision.labels, ['llm_block'])
        assert.include(decision.reasons, 'llm_recheck.block')
        assert.equal(event?.action, 'block')
        await app.stop()
    })

    it('keeps review decisions when llm recheck returns review', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => ({
            action: 'review',
            confidence: 0.7,
            severity: 2,
            riskScore: 20,
            reasons: ['still_ambiguous']
        }))
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'review')
        assert.include(decision.reasons, 'llm_recheck.review')
        await app.stop()
    })

    it('keeps review decisions when llm recheck fails', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => {
            throw new Error('failed')
        })
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'review')
        assert.include(decision.reasons, 'llm_recheck_failed')
        await app.stop()
    })

    it('keeps review decisions when llm recheck returns empty output', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => undefined)
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'review')
        assert.include(decision.reasons, 'llm_recheck_failed')
        await app.stop()
    })

    it('does not call llm recheck when max rechecks is zero', async () => {
        const { app, service } = await createService(
            cfg({
                shadowMode: false,
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                },
                enforcement: {
                    fixedBlockReply:
                        DEFAULT_MODERATION_CONFIG.enforcement.fixedBlockReply,
                    maxRechecksPerRequest: 0
                }
            })
        )
        let calls = 0

        service.registerLlmRecheckBackend(async () => {
            calls += 1
            return {
                action: 'allow'
            }
        })
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )

        assert.equal(decision.action, 'review')
        assert.equal(calls, 0)
        await app.stop()
    })

    it('records shadow llm block but returns allow', async () => {
        const { app, service } = await createService(
            cfg({
                backend: {
                    useKoishiCensor: true,
                    useKeywordRules: true,
                    useLlmRecheck: true,
                    recheckModel: ''
                }
            })
        )

        service.registerLlmRecheckBackend(async () => ({
            action: 'block',
            confidence: 0.95,
            severity: 5,
            riskScore: 80
        }))
        const decision = await service.evaluateInput(
            session,
            'moderation-review-test'
        )
        const event = await service.repository.getEvent(decision.eventId!)

        assert.equal(decision.action, 'allow')
        assert.equal(event?.action, 'block')
        await app.stop()
    })
})

export { cfg, createService, session }
