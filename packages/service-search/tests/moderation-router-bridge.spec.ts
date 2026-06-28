/// <reference types="mocha" />

import { assert } from 'chai'
import { readFileSync } from 'fs'
import { Config } from '../src/config'
import { parseSearchAction } from '../src/utils/parse'

describe('service-search moderation router parser', () => {
    it('returns review for invalid router json', () => {
        const action = parseSearchAction('{not json')

        assert.equal(action.safety, 'recheck')
        assert.equal(action.action, 'skip')
        assert.deepEqual(action.content, [])
    })

    it('returns review for missing router safety', () => {
        const action = parseSearchAction(
            JSON.stringify({
                action: 'search',
                content: ['koishi docs']
            })
        )

        assert.equal(action.safety, 'recheck')
        assert.equal(action.action, 'skip')
    })

    it('maps risk_event into risk categories', () => {
        const action = parseSearchAction(
            JSON.stringify({
                thought: 'review',
                safety: 'recheck',
                risk_event: {
                    category: 'jailbreak',
                    severity: 3,
                    confidence: 0.8,
                    redline: false
                },
                action: 'search',
                content: ['prompt bypass']
            })
        )

        assert.equal(action.safety, 'recheck')
        assert.equal(action.risk_level, 'medium')
        assert.deepEqual(action.risk_categories, ['jailbreak'])
        assert.deepEqual(action.content, [])
    })

    it('preserves block as no-search decision', () => {
        const action = parseSearchAction(
            JSON.stringify({
                thought: 'block',
                safety: 'block',
                action: 'search',
                content: ['blocked query']
            })
        )

        assert.equal(action.safety, 'block')
        assert.equal(action.action, 'skip')
        assert.deepEqual(action.content, [])
    })

    it('keeps legacy safety fields out of the service-search schema', () => {
        const text = JSON.stringify(
            (Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.notInclude(text, 'replySafetyCheckFails')
        assert.notInclude(text, 'safetyBlockKeywordGroups')
        assert.notInclude(text, 'safetyRecheckKeywordGroups')
        assert.notInclude(text, 'promptAttackWarning')
        assert.include(text, 'searchTriggerKeywords')
    })

    it('uses moderation keyword matcher for service-search safety fallback', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'matchKeywordRule')
        assert.notInclude(source, 'lower.includes')
        assert.include(source, "hit?.action === 'block'")
        assert.include(source, 'shortKeywordContextRules')
    })
})
