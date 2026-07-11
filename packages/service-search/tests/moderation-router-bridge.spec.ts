/// <reference types="mocha" />

import { assert } from 'chai'
import { readFileSync } from 'fs'
import {
    Config,
    DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS,
    DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS,
    DEFAULT_SAFE_RISK_EXPLANATION_CONTEXT_KEYWORDS,
    DEFAULT_SAFE_RISK_EXPLANATION_EXCLUDE_KEYWORDS,
    DEFAULT_SAFE_RISK_EXPLANATION_LABELS,
    DEFAULT_SAFE_SEARCH_SYNTAX_TERMS,
    DEFAULT_SIMPLE_NON_BROWSING_PHRASES
} from '../src/config'
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
        assert.include(text, 'providerTimeoutMs')
        assert.include(text, 'searchEarlyReturnResults')
        assert.include(text, 'contextualCompressionMinChars')
        assert.include(text, 'maxRouterSearchQueries')
        assert.include(text, 'searchTriggerKeywords')
        assert.include(text, 'enableFastNonBrowsingSkip')
        assert.include(text, 'simpleNonBrowsingPhrases')
        assert.include(text, 'fastSkipStableTaskKeywords')
        assert.include(text, 'fastSkipStableTaskExcludeKeywords')
        assert.include(text, 'enableSafeSearchSyntaxSkip')
        assert.include(text, 'safeSearchSyntaxTerms')
        assert.include(text, 'safeSearchSyntaxSearchIntentKeywords')
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

    it('does not mechanically search for search-syntax risk training', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(DEFAULT_SAFE_SEARCH_SYNTAX_TERMS, '搜索语法')
        assert.include(DEFAULT_SAFE_SEARCH_SYNTAX_TERMS, '搜索引擎高级语法')
        assert.include(DEFAULT_SAFE_SEARCH_SYNTAX_TERMS, '检索语法')
        assert.notInclude(
            DEFAULT_SAFE_SEARCH_SYNTAX_TERMS.toLocaleLowerCase(),
            'google dork'
        )
        assert.notInclude(
            DEFAULT_SAFE_SEARCH_SYNTAX_TERMS.toLocaleLowerCase(),
            'dork'
        )
        assert.include(source, 'safeSearchSyntaxTraining')
        assert.include(source, 'safeSearchSyntaxSearchIntentKeywords')
        assert.include(
            source,
            'search syntax risk training does not need browsing'
        )
        assert.include(source, '!hasKeyword(input, searchIntents)')
    })

    it('fast-skips safe risk explanations from moderation labels', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )
        const text = JSON.stringify(
            (Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.include(text, 'enableSafeRiskExplanationSkip')
        assert.include(text, 'safeRiskExplanationLabels')
        assert.include(text, 'safeRiskExplanationContextKeywords')
        assert.include(text, 'safeRiskExplanationExcludeKeywords')
        assert.include(DEFAULT_SAFE_RISK_EXPLANATION_LABELS, 'search_misuse_risk')
        assert.include(DEFAULT_SAFE_RISK_EXPLANATION_CONTEXT_KEYWORDS, '风险')
        assert.include(DEFAULT_SAFE_RISK_EXPLANATION_EXCLUDE_KEYWORDS, '最新')
        assert.include(DEFAULT_SAFE_RISK_EXPLANATION_EXCLUDE_KEYWORDS, 'site:')
        assert.notInclude(
            DEFAULT_SAFE_RISK_EXPLANATION_LABELS.toLocaleLowerCase(),
            'google dork'
        )
        assert.notInclude(
            DEFAULT_SAFE_RISK_EXPLANATION_LABELS.toLocaleLowerCase(),
            'dork'
        )
        assert.include(source, 'safeRiskExplanation')
        assert.include(source, 'decision.labels')
        assert.include(source, 'decision.reasons.join')
        assert.include(source, 'precheck.categories')
        assert.include(source, 'semantic.safe_context')
        assert.include(
            source,
            'safe risk explanation does not need browsing'
        )
        assert.include(source, '安全培训和合规替代流程')
        assert.include(source, '主要风险包括')
    })

    it('fast-skips simple non-browsing requests after moderation', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'simpleNonBrowsingRequest')
        assert.include(source, 'simple non-browsing request')
        assert.include(DEFAULT_SIMPLE_NON_BROWSING_PHRASES, '你是谁')
        assert.include(DEFAULT_SIMPLE_NON_BROWSING_PHRASES, '晚安')
    })

    it('fast-skips stable local tasks with external fact exclusions', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'stableNonBrowsingTask')
        assert.include(source, 'stable non-browsing task')
        assert.include(source, '!hasKeyword(input, excludes)')
        assert.include(DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS, '翻译')
        assert.include(DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS, '二叉树')
        assert.include(DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS, '最新')
        assert.include(DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS, 'api')
        assert.include(DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS, 'https://')
    })

    it('limits router search queries in code and prompt', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )
        const text = JSON.stringify(
            (Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.include(text, 'maxRouterSearchQueries')
        assert.include(text, 'max_router_search_queries')
        assert.include(source, 'this.maxRouterSearchQueries')
        assert.include(source, 'trim router search queries')
        assert.include(source, 'searchAction.content.slice')
    })

    it('adds provider timeout and early-return controls', () => {
        const source = readFileSync(require.resolve('../src/provide'), 'utf8')
        const text = JSON.stringify(
            (Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.include(text, 'providerTimeoutMs')
        assert.include(text, 'searchEarlyReturnResults')
        assert.include(source, 'searchWithTimeout')
        assert.include(source, 'Search provider timed out')
        assert.include(source, 'this.config.searchEarlyReturnResults')
    })

    it('uses adaptive contextual compression mode', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )
        const index = readFileSync(require.resolve('../src/index'), 'utf8')
        const text = JSON.stringify(
            (Config as unknown as { toJSON(): unknown }).toJSON()
        )

        assert.include(text, 'contextualCompressionMinChars')
        assert.include(text, 'boolean')
        assert.include(index, "config.contextualCompression === true")
        assert.include(index, "compressionMode !== 'off'")
        assert.include(source, "this.contextualCompressionMode === 'always'")
        assert.include(source, "this.contextualCompressionMode === 'auto'")
        assert.include(source, 'context.length >= this.contextualCompressionMinChars')
    })

    it('keeps latency optimization defaults visible in config source', () => {
        const source = readFileSync(require.resolve('../src/config'), 'utf8')

        assert.include(source, 'DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS')
        assert.include(source, 'DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS')
        assert.include(source, 'DEFAULT_SAFE_RISK_EXPLANATION_LABELS')
        assert.include(source, 'maxRouterSearchQueries')
        assert.include(source, 'default(2)')
        assert.include(source, 'providerTimeoutMs')
        assert.include(source, 'default(12000)')
        assert.include(source, 'searchEarlyReturnResults')
        assert.include(source, 'default(3)')
        assert.include(source, 'contextualCompressionMinChars')
        assert.include(source, 'Schema.boolean()')
        assert.include(source, 'default(6000)')
    })

    it('adds safe answering guidance for benign high-risk-looking contexts', () => {
        const source = readFileSync(
            require.resolve('../src/chain/browsing_chain'),
            'utf8'
        )

        assert.include(source, 'addAllowedSafeHandling')
        assert.include(source, '性传播疾病预防')
        assert.include(source, '法轮盘')
        assert.include(source, 'mechanical indexing')
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
        assert.include(context, 'References:')
        assert.include(context, '[^1]: [Title](https://example.com)')
    })

    it('normalizes legacy inline reference formatting', () => {
        const text = normalizeReferencesMarkdown(
            'References<p>[^1]: 标题（https://example.com/a）[^2]: Other(https://example.com/b)</p>'
        )

        assert.include(text, '[^1]: [标题](https://example.com/a)')
        assert.include(text, '\n[^2]: [Other](https://example.com/b)')
    })

    it('normalizes final response references on separate lines', () => {
        const text = normalizeReferencesMarkdown(
            'References[^1]: 标题（https://example.com/a） [^2]: Other(https://example.com/b)注：来源2权威性较低。'
        )

        assert.include(text, 'References:')
        assert.include(text, '\n[^1]: [标题](https://example.com/a)')
        assert.include(text, '\n[^2]: [Other](https://example.com/b)')
        assert.include(text, '\n注：来源2权威性较低。')
    })

    it('normalizes references headings before rendering', () => {
        const text = normalizeReferencesMarkdown(
            '## References\n\n[^1]: [标题](https://example.com/a)'
        )

        assert.include(text, 'References:\n[^1]: [标题](https://example.com/a)')
        assert.notInclude(text, '## References')
    })

    it('extracts inline citation links into markdown references', () => {
        const text = normalizeReferencesMarkdown(
            '研究院已成立^1 ([华中科技大学低空经济研究院揭牌成立](https://example.com/news))。'
        )

        assert.include(text, '研究院已成立[^1]。')
        assert.include(
            text,
            '[^1]: [华中科技大学低空经济研究院揭牌成立](https://example.com/news)'
        )
    })
})
