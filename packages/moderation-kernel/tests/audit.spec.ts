import { assert } from 'chai'
import { logModerationEvent } from '../src'

describe('moderation audit logs', () => {
    it('does not log raw text or raw user keys', () => {
        const logs: string[] = []
        const decision = {
            action: 'block' as const,
            labels: ['safety'],
            reasons: ['raw private text'],
            confidence: 1,
            severity: 5 as const,
            riskScore: 100
        }

        logModerationEvent(
            {
                logger: {
                    info(msg: string) {
                        logs.push(msg)
                    }
                }
            } as never,
            'moderation.decision',
            {
                stage: 'input',
                userKey: 'secret-user-key',
                contentText: 'raw private text'
            },
            decision,
            {
                eventId: 'event-1',
                shadowMode: true
            }
        )

        const log = logs.join('\n')
        const payload = JSON.parse(log)

        assert.notInclude(log, 'raw private text')
        assert.notInclude(log, 'secret-user-key')
        assert.equal(payload.event, 'moderation.decision')
        assert.equal(payload.stage, 'input')
        assert.equal(payload.action, 'block')
        assert.deepEqual(payload.labels, ['safety'])
        assert.equal(payload.severity, 5)
        assert.equal(payload.confidence, 1)
        assert.equal(payload.riskScore, 100)
        assert.equal(payload.eventId, 'event-1')
        assert.equal(payload.shadowMode, true)
        assert.isString(payload.userKeyHash)
    })
})
