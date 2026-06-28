/// <reference types="mocha" />

import { assert } from 'chai'
import { readFileSync } from 'fs'
import memory from '@koishijs/plugin-database-memory'
import * as path from 'path'
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
    it('keeps moderation schema under a single section title', () => {
        const zh = readFileSync(
            path.resolve(__dirname, '../src/locales/zh-CN.schema.yml'),
            'utf8'
        )
        const en = readFileSync(
            path.resolve(__dirname, '../src/locales/en-US.schema.yml'),
            'utf8'
        )

        assert.include(zh, '- $desc: 内容安全')
        assert.notInclude(zh, 'moderation:\n          $desc: 内容安全')
        assert.include(en, '- $desc: Moderation')
        assert.notInclude(en, 'moderation:\n          $desc: Moderation')
    })

    it('uses empty moderation keyword defaults in core schema', () => {
        const text = JSON.stringify(
            (chatluna.Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.include(text, '"blockKeywordGroups":[]')
        assert.include(text, '"reviewKeywordGroups":[]')
        assert.include(text, 'shortKeywordContextRules')
        assert.include(text, '"term":"中共"')
        assert.include(text, '"recheckModel":""')
    })

    it('declares moderation as an optional entrypoint dependency', () => {
        const text = readFileSync(
            path.resolve(__dirname, '../src/index.ts'),
            'utf8'
        )

        assert.include(text, 'moderation: { required: false }')
    })

    it('registers llm recheck with explicit model fallback order', () => {
        const text = readFileSync(
            path.resolve(__dirname, '../src/index.ts'),
            'utf8'
        )

        assert.include(text, 'registerLlmRecheckBackend')
        assert.include(text, 'moderation.backend.recheckModel')
        assert.include(text, ': config.defaultModel')
    })

    it('keeps llm recheck prompt free of keyword rule details', () => {
        const text = readFileSync(
            path.resolve(__dirname, '../src/index.ts'),
            'utf8'
        )
        const prompt = text.slice(
            text.indexOf('const RECHECK_PROMPT'),
            text.indexOf('export function apply')
        )

        assert.exists(prompt)
        assert.notInclude(prompt, 'blockKeywordGroups')
        assert.notInclude(prompt, 'reviewKeywordGroups')
        assert.notInclude(prompt, 'keyword')
        assert.include(prompt, 'Return JSON only.')
    })

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
