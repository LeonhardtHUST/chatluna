/// <reference types="mocha" />

import { assert } from 'chai'
import memory from '@koishijs/plugin-database-memory'
import { Context } from 'koishi'
import {
    DEFAULT_MODERATION_CONFIG,
    ModerationService
} from '../../moderation-kernel/src'

describe('core moderation shadow-mode integration', () => {
    it('records input events without raw text by default', async () => {
        const app = new Context()
        app.plugin(memory)
        app.plugin(ModerationService, DEFAULT_MODERATION_CONFIG)
        await app.start()

        try {
            const decision = await app.moderation.evaluateInput(
                {
                    platform: 'test',
                    userId: 'user-1',
                    channelId: 'channel-1'
                },
                'ordinary math question'
            )
            const event = await app.moderation.repository.getEvent(
                decision.eventId!
            )

            assert.equal(decision.action, 'allow')
            assert.exists(event)
            assert.equal(event?.rawText, null)
        } finally {
            await app.stop()
        }
    })
})
