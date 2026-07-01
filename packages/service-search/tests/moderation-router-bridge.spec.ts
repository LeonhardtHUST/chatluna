/// <reference types="mocha" />

import { assert } from 'chai'
import { readFileSync } from 'fs'
import { Config } from '../src/config'
import { parseSearchAction } from '../src/utils/parse'
import {
    formatCompressedContext,
    normalizeReferencesMarkdown
} from '../src/utils/references'

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

    it('keeps explicit no-search intent above mechanical triggers', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'userForbidsSearch')
        assert.include(source, '!forbidsSearch')
        assert.include(source, 'user explicitly forbids search')
        assert.include(source, '不需要')
    })

    it('adds safe answering guidance for benign high-risk-looking contexts', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'addAllowedSafeHandling')
        assert.include(source, '性传播疾病预防')
        assert.include(source, '法轮盘')
        assert.include(source, 'Do not use a fixed safety refusal')
    })

    it('formats compressed json context with standard references', () => {
        const context = formatCompressedContext(
            JSON.stringify({
                status: 'ok',
                summary: 'summary',
                key_points: [
                    {
                        claim: 'claim',
                        source_ids: [1]
                    }
                ],
                references: [
                    {
                        id: 1,
                        title: 'Title',
                        url: 'https://example.com'
                    }
                ],
                warnings: []
            }),
            []
        )

        assert.include(context, 'claim[^1]')
        assert.include(context, '## References')
        assert.include(context, '[^1]: [Title](https://example.com)')
    })

    it('normalizes legacy inline reference formatting', () => {
        const text = normalizeReferencesMarkdown(
            'References<p>[^1]: 标题（https://example.com/a）[^2]: Other(https://example.com/b)</p>'
        )

        assert.include(text, '[^1]: [标题](https://example.com/a)')
        assert.include(text, '\n[^2]: [Other](https://example.com/b)')
    })
})
