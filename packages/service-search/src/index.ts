/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaBrowsingChain } from './chain/browsing_chain'
import {
    Config,
    apply as configApply,
    DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS,
    DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS,
    DEFAULT_SAFE_SEARCH_SYNTAX_CONTEXT_KEYWORDS,
    DEFAULT_SAFE_SEARCH_SYNTAX_EXCLUDE_KEYWORDS,
    DEFAULT_SAFE_SEARCH_SYNTAX_SEARCH_INTENT_KEYWORDS,
    DEFAULT_SAFE_SEARCH_SYNTAX_TERMS,
    DEFAULT_SEARCH_TRIGGER_KEYWORDS,
    DEFAULT_SIMPLE_NON_BROWSING_PHRASES
} from './config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { SearchManager } from './provide'
import { providerPlugin } from './plugin'
import { SEARCH_TOOL_DESCRIPTION, SearchTool } from './tools/search'
import { SummaryType } from './types'
import { computed } from 'koishi-plugin-chatluna'
import { BrowserManager } from './tools/browser/manager'
import { registerBrowserTools } from './tools/browser/tools'
import {
    applyServiceSearchCompatibility,
    serviceSearchSafetyConfig
} from 'moderation-kernel'

export { Config } from './config'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')
    if (config.safetyBlockKeywordGroups == null) {
        const legacy = Array.isArray(config.safetyBlockKeywords)
            ? config.safetyBlockKeywords.join(',')
            : config.safetyBlockKeywords

        config.safetyBlockKeywordGroups =
            legacy?.trim().length > 0
                ? [{ name: 'Legacy', keywords: legacy }]
                : []
    }

    config.searchTriggerKeywords ??= DEFAULT_SEARCH_TRIGGER_KEYWORDS
    config.providerTimeoutMs ??= 8000
    config.searchEarlyReturnResults ??= 3
    config.enableFastNonBrowsingSkip ??= true
    config.simpleNonBrowsingPhrases ??= DEFAULT_SIMPLE_NON_BROWSING_PHRASES
    config.fastSkipStableTaskKeywords ??= DEFAULT_FAST_SKIP_STABLE_TASK_KEYWORDS
    config.fastSkipStableTaskExcludeKeywords ??=
        DEFAULT_FAST_SKIP_STABLE_TASK_EXCLUDE_KEYWORDS
    config.fastSkipNumericOnly ??= true
    config.enableSafeSearchSyntaxSkip ??= true
    config.safeSearchSyntaxTerms ??= DEFAULT_SAFE_SEARCH_SYNTAX_TERMS
    config.safeSearchSyntaxContextKeywords ??=
        DEFAULT_SAFE_SEARCH_SYNTAX_CONTEXT_KEYWORDS
    config.safeSearchSyntaxExcludeKeywords ??=
        DEFAULT_SAFE_SEARCH_SYNTAX_EXCLUDE_KEYWORDS
    config.safeSearchSyntaxSearchIntentKeywords ??=
        DEFAULT_SAFE_SEARCH_SYNTAX_SEARCH_INTENT_KEYWORDS

    if (ctx.moderation?.config) {
        applyServiceSearchCompatibility(ctx.moderation.config, config, logger)
    }

    ctx.on('ready', async () => {
        const keywordExtractModel =
            config.summaryModel && config.summaryModel !== 'empty'
                ? await createModel(ctx, config.summaryModel)
                : null

        const plugin = new ChatLunaPlugin<ClientConfig, Config>(
            ctx,
            config,
            'search-service',
            false
        )

        const searchManager = new SearchManager(ctx, config)
        if (config.enableBrowser && !ctx.puppeteer) {
            logger.warn(
                'Browser tools are disabled because puppeteer is not available.'
            )
        }

        const browserManager =
            config.enableBrowser && ctx.puppeteer
                ? new BrowserManager(ctx, config)
                : undefined
        const summaryModel = computed(() => keywordExtractModel?.value)

        if (browserManager) {
            registerBrowserTools(plugin, browserManager, summaryModel)
        }

        if (config.searchEngine.length > 0) {
            await providerPlugin(ctx, config, plugin, searchManager)

            plugin.registerTool('web_search', {
                description: SEARCH_TOOL_DESCRIPTION,
                createTool(params) {
                    const summaryType: SummaryType =
                        params['summaryType'] ?? config.summaryType

                    const browserModelRef = computed(
                        () => keywordExtractModel?.value ?? null
                    )
                    return new SearchTool(
                        searchManager,
                        browserManager,
                        params.embeddings,
                        browserModelRef,
                        summaryType
                    )
                },
                selector() {
                    return true
                },
                meta: {
                    source: 'extension',
                    group: 'search',
                    tags: ['search', 'web'],
                    defaultAvailability: {
                        enabled: true,
                        main: true,
                        chatluna: true,
                        characterScope: 'all'
                    }
                }
            })
        }

        if (config.searchEngine.length > 0) {
            plugin.registerChatChainProvider(
                'browsing',
                {
                    'zh-CN': '浏览模式，可以从外部获取信息',
                    'en-US': 'Browsing mode, can get information from web'
                },
                (params) => {
                    const tools = getTools(
                        ctx.chatluna.platform,
                        (name) =>
                            name === 'web_search' ||
                            (config.enableBrowser &&
                                name.startsWith('browser_'))
                    )

                    const summaryModel = computed(
                        () => keywordExtractModel?.value ?? params.model
                    )

                    const model = params.model
                    const safety = serviceSearchSafetyConfig(
                        ctx.moderation?.config,
                        config
                    )
                    const blockGroups = safety.safetyBlockKeywordGroups.map(
                        (group) => ({
                            name: group.name,
                            keywords: group.keywords.join(',')
                        })
                    )
                    const reviewGroups = safety.safetyRecheckKeywordGroups.map(
                        (group) => ({
                            name: group.name,
                            keywords: group.keywords.join(',')
                        })
                    )
                    const options = {
                        preset: params.preset,
                        botName: params.botName,
                        botNames: [
                            ...ctx.chatluna.config.botNames,
                            params.botName
                        ],
                        embeddings: params.embeddings,
                        historyMemory: params.historyMemory,
                        summaryType: config.summaryType,
                        summaryModel,
                        thoughtMessage: ctx.chatluna.config.showThoughtMessage,
                        searchPrompt: config.searchPrompt,
                        newQuestionPrompt: config.newQuestionPrompt,
                        maxRouterSearchQueries: config.maxRouterSearchQueries,
                        contextualCompressionPrompt:
                            config.contextualCompression
                                ? config.contextualCompressionPrompt
                                : undefined,
                        searchFailedPrompt: config.searchFailedPrompt,
                        replySafetyCheckFails: safety.replySafetyCheckFails,
                        safetyBlockKeywordGroups: blockGroups.map((group) => ({
                            name: group.name,
                            keywords: group.keywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0)
                        })),
                        safetyRecheckKeywordGroups: reviewGroups.map(
                            (group) => ({
                                name: group.name,
                                keywords: group.keywords
                                    .split(/[,，\r\n]+/)
                                    .map((keyword) => keyword.trim())
                                    .filter((keyword) => keyword.length > 0)
                            })
                        ),
                        shortKeywordContextRules:
                            safety.shortKeywordContextRules,
                        promptAttackWarning: safety.promptAttackWarning,
                        searchTriggerKeywords: config.searchTriggerKeywords
                            .split(/[,，\r\n]+/)
                            .map((keyword) => keyword.trim())
                            .filter((keyword) => keyword.length > 0),
                        enableFastNonBrowsingSkip:
                            config.enableFastNonBrowsingSkip,
                        simpleNonBrowsingPhrases:
                            config.simpleNonBrowsingPhrases
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        fastSkipStableTaskKeywords:
                            config.fastSkipStableTaskKeywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        fastSkipStableTaskExcludeKeywords:
                            config.fastSkipStableTaskExcludeKeywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        fastSkipNumericOnly: config.fastSkipNumericOnly,
                        enableSafeSearchSyntaxSkip:
                            config.enableSafeSearchSyntaxSkip,
                        safeSearchSyntaxTerms: config.safeSearchSyntaxTerms
                            .split(/[,，\r\n]+/)
                            .map((keyword) => keyword.trim())
                            .filter((keyword) => keyword.length > 0),
                        safeSearchSyntaxContextKeywords:
                            config.safeSearchSyntaxContextKeywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        safeSearchSyntaxExcludeKeywords:
                            config.safeSearchSyntaxExcludeKeywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        safeSearchSyntaxSearchIntentKeywords:
                            config.safeSearchSyntaxSearchIntentKeywords
                                .split(/[,，\r\n]+/)
                                .map((keyword) => keyword.trim())
                                .filter((keyword) => keyword.length > 0),
                        variableService: ctx.chatluna.promptRenderer,
                        contextManager: ctx.chatluna.contextManager,
                        browserManager
                    }

                    return ChatLunaBrowsingChain.fromLLMAndTools(
                        model,
                        tools,
                        options
                    )
                }
            )
        }
    })

    configApply(ctx, config)
}

function getTools(service: PlatformService, filter: (name: string) => boolean) {
    const tools = service.getTools()

    return computed(() =>
        tools.value.filter(filter).map((name) => ({
            name,
            tool: service.getTool(name)
        }))
    )
}

export async function createModel(ctx: Context, model: string) {
    logger.debug('Create summary model: %s', model)
    if (model == null || model === 'empty') {
        return null
    }

    const [platform, modelName] = parseRawModelName(model)
    await ctx.chatluna.awaitLoadPlatform(platform)
    return ctx.chatluna.createChatModel(platform, modelName)
}

export const inject = {
    required: ['chatluna'],
    optional: ['puppeteer', 'chatluna_agent', 'moderation']
}

export const name = 'chatluna-search-service'
