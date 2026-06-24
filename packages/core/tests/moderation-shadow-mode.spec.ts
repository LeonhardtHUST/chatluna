/// <reference types="mocha" />

import { assert } from 'chai'
import memory from '@koishijs/plugin-database-memory'
import { Context } from 'koishi'
import * as chatluna from '../src'
import {
    DEFAULT_MODERATION_CONFIG,
    ModerationService
} from '../../moderation-kernel/src'
import { createConfig } from './helpers'

interface CommandLike {
    config: {
        authority?: number
    }
}

function command(app: Context, name: string) {
    return (
        app as unknown as {
            $commander: {
                get(name: string): CommandLike | undefined
            }
        }
    ).$commander.get(name)
}

describe('core moderation shadow-mode integration', () => {
    it('registers moderation service and chatluna moderation commands from core', async () => {
        const app = new Context()
        app.plugin(memory)
        app.plugin(chatluna, createConfig())
        await app.start()

        try {
            assert.exists(app.moderation)
            assert.exists(command(app, 'chatluna.moderation.case'))
            assert.equal(
                command(app, 'chatluna.moderation.case')?.config.authority,
                3
            )
        } finally {
            await app.stop()
        }
    })

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
