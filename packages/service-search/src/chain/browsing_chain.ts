/* eslint-disable max-len */
import { Embeddings } from '@langchain/core/embeddings'
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { PromptTemplate } from '@langchain/core/prompts'
import { StructuredTool } from '@langchain/core/tools'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatLunaChain,
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { logger } from '..'
import {
    ChatLunaContextManagerService,
    PresetTemplate
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import {
    ChatLunaTool,
    ChatLunaToolRunnable
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { applyToolMask, ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { Session } from 'koishi'
import { SearchAction, SummaryType } from '../types'
import { parseSearchAction } from '../utils/parse'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { ChatLunaPromptRenderService } from 'koishi-plugin-chatluna/services/chat'
import { ComputedRef, Ref } from 'koishi-plugin-chatluna'
import { BrowserManager } from '../tools/browser/manager'

// github.com/langchain-ai/weblangchain/blob/main/nextjs/app/api/chat/stream_log/route.ts#L81

export interface ChatLunaBrowsingChainInput {
    botName: string
    botNames: string[]
    preset: ComputedRef<PresetTemplate>
    embeddings: Embeddings

    historyMemory: BufferMemory
    summaryType: SummaryType

    thoughtMessage: boolean

    summaryModel: Ref<ChatLunaChatModel>

    searchPrompt: string
    newQuestionPrompt: string
    contextualCompressionPrompt?: string
    searchFailedPrompt: string
    replySafetyCheckFails?: string
    safetyBlockKeywordGroups: SafetyKeywordGroup[]
    safetyRecheckKeywordGroups: SafetyKeywordGroup[]
    promptAttackWarning: string
    searchTriggerKeywords: string[]
    variableService: ChatLunaPromptRenderService
    browserManager?: BrowserManager
}

export class ChatLunaBrowsingChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaBrowsingChainInput
{
    botName: string

    botNames: string[]

    embeddings: Embeddings

    chain: ChatLunaLLMChain

    historyMemory: BufferMemory

    preset: ComputedRef<PresetTemplate>

    formatQuestionChain: ChatLunaLLMChain

    contextualCompressionChain?: ChatLunaLLMChain

    tools: ComputedRef<ChatLunaToolWrapper[]>

    newQuestionPrompt: string

    responsePrompt: PromptTemplate

    summaryType: SummaryType

    summaryModel: Ref<ChatLunaChatModel>

    contextualCompressionPrompt?: string

    variableService: ChatLunaPromptRenderService

    thoughtMessage: boolean

    searchPrompt: string

    searchFailedPrompt: string

    browserManager?: BrowserManager

    replySafetyCheckFails?: string

    safetyBlockKeywordGroups: SafetyKeywordGroup[]

    safetyRecheckKeywordGroups: SafetyKeywordGroup[]

    promptAttackWarning: string

    searchTriggerKeywords: string[]

    private _toolMask?: ToolMask

    constructor({
        botName,
        botNames,
        embeddings,
        historyMemory,
        chain,
        searchFailedPrompt,
        tools,
        formatQuestionChain,
        summaryType,
        thoughtMessage,
        searchPrompt,
        preset,
        newQuestionPrompt,
        variableService,
        browserManager,
        summaryModel,
        contextualCompressionPrompt,
        contextualCompressionChain,
        replySafetyCheckFails,
        safetyBlockKeywordGroups,
        safetyRecheckKeywordGroups,
        promptAttackWarning,
        searchTriggerKeywords
    }: ChatLunaBrowsingChainInput & {
        chain: ChatLunaLLMChain
        formatQuestionChain: ChatLunaLLMChain
        tools: ComputedRef<ChatLunaToolWrapper[]>
        searchPrompt: string
        contextualCompressionChain?: ChatLunaLLMChain
    }) {
        super()
        this.botName = botName
        this.botNames = botNames
        this.preset = preset

        this.embeddings = embeddings
        this.summaryType = summaryType

        this.formatQuestionChain = formatQuestionChain

        this.historyMemory = historyMemory
        this.thoughtMessage = thoughtMessage
        this.searchFailedPrompt = searchFailedPrompt
        this.newQuestionPrompt = newQuestionPrompt
        this.replySafetyCheckFails = replySafetyCheckFails
        this.safetyBlockKeywordGroups = safetyBlockKeywordGroups
        this.safetyRecheckKeywordGroups = safetyRecheckKeywordGroups
        this.promptAttackWarning = promptAttackWarning
        this.searchTriggerKeywords = searchTriggerKeywords
        this.variableService = variableService
        this.browserManager = browserManager
        this.searchPrompt = searchPrompt
        this.contextualCompressionPrompt = contextualCompressionPrompt

        this.responsePrompt = PromptTemplate.fromTemplate(searchPrompt)
        this.chain = chain
        this.tools = tools

        this.contextualCompressionChain = contextualCompressionChain
        this.summaryModel = summaryModel
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ComputedRef<ChatLunaToolWrapper[]>,
        {
            botName,
            botNames,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            searchPrompt,
            newQuestionPrompt,
            summaryType,
            searchFailedPrompt,
            replySafetyCheckFails,
            safetyBlockKeywordGroups,
            safetyRecheckKeywordGroups,
            promptAttackWarning,
            searchTriggerKeywords,
            variableService,
            contextManager,
            browserManager,
            contextualCompressionPrompt
        }: ChatLunaBrowsingChainInput & {
            contextManager: ChatLunaContextManagerService
        }
    ): ChatLunaBrowsingChain {
        const prompt = new ChatLunaChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize(),
            promptRenderService: variableService,
            contextManager
        })

        const chain = new ChatLunaLLMChain({ llm, prompt })
        const formatQuestionChain = new ChatLunaLLMChain({
            llm: summaryModel.value ?? llm,
            prompt: PromptTemplate.fromTemplate(newQuestionPrompt)
        })

        const contextualCompressionChain = contextualCompressionPrompt
            ? new ChatLunaLLMChain({
                  llm: summaryModel.value ?? llm,
                  prompt: PromptTemplate.fromTemplate(
                      contextualCompressionPrompt
                  )
              })
            : undefined

        return new ChatLunaBrowsingChain({
            variableService,
            browserManager,
            botName,
            botNames,
            formatQuestionChain,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            searchFailedPrompt,
            replySafetyCheckFails,
            safetyBlockKeywordGroups,
            safetyRecheckKeywordGroups,
            promptAttackWarning,
            searchTriggerKeywords,
            searchPrompt,
            newQuestionPrompt,
            chain,
            tools,
            summaryType,
            contextualCompressionPrompt,
            contextualCompressionChain
        })
    }

    private async _selectTool<T extends StructuredTool = StructuredTool>(
        name: string
    ): Promise<T> {
        const chatLunaTool = this.tools.value.find(
            (tool) => tool.name === name && applyToolMask(name, this._toolMask)
        )

        if (!chatLunaTool) {
            throw new Error(`Tool not available in current room: ${name}`)
        }

        return chatLunaTool.tool.createTool({
            embeddings: this.embeddings
        }) as T
    }

    private _findKeywordHit(input: string, groups: SafetyKeywordGroup[]) {
        const lower = input.toLocaleLowerCase()

        for (const group of groups) {
            const keyword = group.keywords.find((word) =>
                lower.includes(word.toLocaleLowerCase())
            )

            if (keyword != null) {
                return {
                    category: group.name,
                    keyword
                }
            }
        }
    }

    private _precheck(input: string): SafetyPrecheck {
        if (
            /忽略.*(指令|提示词|规则)|绕过.*(指令|提示词|规则|安全|审查)|隐藏(规则|提示词|指令)|泄露.*(提示词|规则|指令)|越狱|jailbreak|ignore.*(instruction|system|developer)|system prompt|developer message|hidden prompt/i.test(
                input
            )
        ) {
            return {
                safety: 'block',
                risk_level: 'high',
                categories: ['prompt_attack'],
                matched_rule: 'prompt_attack',
                search_allowed: false,
                url_allowed: false,
                policy_hint:
                    'Prompt attack detected before routing. Do not search or browse.'
            }
        }

        const block = this._findKeywordHit(input, this.safetyBlockKeywordGroups)

        if (block != null) {
            return {
                safety: 'block',
                risk_level: 'high',
                categories: [block.category],
                matched_rule: block.keyword,
                search_allowed: false,
                url_allowed: false,
                policy_hint:
                    'Hard-blocked before routing. Do not search or browse.'
            }
        }

        const recheck = this._findKeywordHit(
            input,
            this.safetyRecheckKeywordGroups
        )

        if (recheck != null) {
            return {
                safety: 'recheck',
                risk_level: 'medium',
                categories: [recheck.category],
                matched_rule: recheck.keyword,
                search_allowed: false,
                url_allowed: false,
                policy_hint:
                    'Soft-review match. Allow only if the intent is clearly educational, scientific, defensive, compliant, or benign.'
            }
        }

        return {
            safety: 'allow',
            risk_level: 'low',
            categories: [],
            search_allowed: true,
            url_allowed: true,
            policy_hint: 'No mechanical safety match.'
        }
    }

    async call({
        message,
        stream,
        events,
        conversationId,
        session,
        variables,
        maxToken,
        signal,
        toolMask
    }: ChatLunaLLMCallArg): Promise<ChainValues> {
        this._toolMask = toolMask
        const requests: ChainValues = {
            input: message
        }

        let chatHistory = (
            await this.historyMemory.loadMemoryVariables(requests)
        )[this.historyMemory.memoryKey] as BaseMessage[]

        chatHistory = chatHistory.slice()

        requests['chat_history'] = chatHistory
        requests['id'] = conversationId
        requests['variables'] = Object.assign(variables ?? {}, {
            prompt: getMessageContent(message.content)
        })
        requests['variables_hide'] = requests['variables']

        const input = getMessageContent(message.content)
        const question = extractQuestion(
            input,
            this.botNames,
            this.promptAttackWarning
        )
        const clean = question.clean
        const date = new Date().toISOString().slice(0, 10)
        const precheck = this._precheck(clean)

        logger?.debug(`[search-service] raw question: ${input}`)
        logger?.debug(`[search-service] clean question: ${clean}`)
        logger?.debug(`[search-service] precheck: ${JSON.stringify(precheck)}`)

        if (precheck.safety === 'block') {
            logger?.debug(
                `blocked response: ${precheck.categories.join(',')}`
            )
            return {
                message: safetyBlockMessage(this.replySafetyCheckFails)
            }
        }

        // recreate questions

        const newQuestion = (
            await callChatLunaChain(
                this.formatQuestionChain,
                {
                    chat_history: JSON.stringify(
                        formatChatHistoryAsString(chatHistory.slice(-6))
                    ),
                    time: date,
                    question: question.payload,
                    risk_level: precheck.risk_level,
                    search_triggered: JSON.stringify(
                        searchTriggered(clean, this.searchTriggerKeywords)
                    ),
                    precheck: JSON.stringify({
                        safety: precheck.safety,
                        risk_level: precheck.risk_level,
                        risk_categories: precheck.categories,
                        search_allowed_by_default: precheck.search_allowed,
                        url_allowed_by_default: precheck.url_allowed,
                        policy_hint: precheck.policy_hint
                    }),
                    safetyBlockKeywords: this.safetyBlockKeywordGroups
                        .map((group) => group.name)
                        .join('\n'),
                    temperature: 0,
                    signal
                },
                {
                    'llm-used-token-count': events['llm-used-token-count']
                }
            )
        )['text'] as string

        const searchAction = parseSearchAction(newQuestion)

        logger?.debug(`action: ${JSON.stringify(searchAction)}`)

        // safety check — block if LLM flagged the content

        if (
            searchAction.safety === 'block' ||
            searchAction.safety === 'recheck' ||
            (precheck.safety === 'recheck' && searchAction.safety !== 'allow')
        ) {
            logger?.debug(
                `blocked response: router ${searchAction.safety ?? 'missing safety'}`
            )
            return {
                message: safetyBlockMessage(this.replySafetyCheckFails)
            }
        }

        const action =
            searchAction.action === 'skip' && precheck.safety === 'allow'
                ? (fixedUrlAction(clean) ?? searchAction)
                : searchAction

        if (action !== searchAction) {
            logger?.debug(`fixed action: ${JSON.stringify(action)}`)
        }

        if (Array.isArray(action?.content)) {
            const queryHit = action.content
                .map((item) =>
                    this._findKeywordHit(item, this.safetyBlockKeywordGroups)
                )
                .find((hit) => hit != null)

            if (queryHit) {
                logger?.debug(
                    `blocked response: search keyword ${queryHit.keyword}`
                )
                return {
                    message: safetyBlockMessage(this.replySafetyCheckFails)
                }
            }
        }

        // search questions

        if (action != null && action.action !== 'skip') {
            await this._search(
                action,
                message,
                chatHistory,
                session,
                events,
                conversationId,
                signal
            )
        }

        // format and call

        return await this._answer(
            requests,
            stream,
            signal,
            session,
            maxToken,
            events
        )
    }

    private async _answer(
        requests: ChainValues,
        stream: ChatLunaLLMCallArg['stream'],
        signal: AbortSignal,
        session: Session,
        maxToken: ChatLunaLLMCallArg['maxToken'],
        events: ChatLunaLLMCallArg['events']
    ) {
        const finalResponse = await callChatLunaChain(
            this.chain,
            {
                ...requests,
                stream,
                signal,
                configurable: {
                    session
                },
                maxTokens: maxToken
            },
            events
        )

        logger?.debug(`final response %c`, finalResponse.text)

        // remove to reduce context length
        /* if (responsePrompt.length > 0) {
            await this.historyMemory.chatHistory.addMessage(new SystemMessage(responsePrompt))
            await this.historyMemory.chatHistory.addAIChatMessage(
                "OK. I understand. I will respond to the user's question using the same language as their input. What's the user's question?"
            )
        } */

        const aiMessage =
            (finalResponse?.message as AIMessage) ??
            new AIMessage(finalResponse.text)

        return {
            message: aiMessage
        }
    }

    private async _search(
        action: SearchAction,
        message: HumanMessage,
        chatHistory: BaseMessage[],
        session: Session,
        events: ChatLunaLLMCallArg['events'],
        conversationId: string,
        signal: AbortSignal
    ) {
        if (!Array.isArray(action.content)) {
            logger?.error(
                `search action content is not an array: ${JSON.stringify(action)}`
            )
            return
        }

        if (this.thoughtMessage) {
            await session.send(
                `Search Action: ${action.action}\nThought: ${action.thought}\nContent: ${action.content.join('\n')}`
            )
        }

        const results =
            action.action === 'url'
                ? await this._browseUrls(
                      action.content,
                      session,
                      conversationId,
                      signal
                  )
                : await this._searchQuestions(
                      action.content,
                      session,
                      conversationId,
                      signal
                  )

        return await this._appendSearchPrompt(
            action,
            message,
            chatHistory,
            results,
            events,
            signal
        )
    }

    private async _searchQuestions(
        questions: string[],
        session: Session,
        conversationId: string,
        signal: AbortSignal
    ) {
        const tool = await this._selectTool('web_search')
        const results = await raceAbort(
            Promise.allSettled(
                questions.map(async (question) => {
                    const raw = await tool
                        .invoke(question, {
                            configurable: {
                                model: this.model,
                                session,
                                conversationId
                            }
                        })
                        .then((text) => text as string)
                    const parsed = JSON.parse(raw) as SearchResultLike[]

                    if (this.thoughtMessage) {
                        await session.send(
                            `Find ${parsed.length} search results about ${question}.`
                        )
                    }

                    return parsed
                })
            ),
            signal
        )

        return results.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : []
        )
    }

    private async _browseUrls(
        urls: string[],
        session: Session,
        conversationId: string,
        signal: AbortSignal
    ) {
        if (!this.browserManager) return []

        const runConfig = {
            configurable: {
                model: this.model,
                session,
                conversationId
            }
        } as ChatLunaToolRunnable

        const results = await raceAbort(
            Promise.allSettled(
                urls.map(async (url) => {
                    const text = await this.browserManager.readText(
                        { url },
                        runConfig
                    )

                    if (this.thoughtMessage) {
                        await session.send(`Open ${url} and read the content.`)
                    }

                    return {
                        title: url,
                        description: text,
                        url
                    }
                })
            ),
            signal
        )

        return results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : []
        )
    }

    private async _appendSearchPrompt(
        action: SearchAction,
        message: HumanMessage,
        chatHistory: BaseMessage[],
        results: SearchResultLike[],
        events: ChatLunaLLMCallArg['events'],
        signal: AbortSignal
    ) {
        let context = formatSearchResults(results)

        if (context.length < 1) {
            if (this.searchFailedPrompt?.length > 0) {
                chatHistory.push(
                    new SystemMessage(
                        this.searchFailedPrompt.replaceAll(
                            '{question}',
                            getMessageContent(message.content)
                        )
                    )
                )
            }
            return ''
        }

        if (this.contextualCompressionChain) {
            try {
                context = (
                    await callChatLunaChain(
                        this.contextualCompressionChain,
                        {
                            action: JSON.stringify(action),
                            context,
                            temperature: 0,
                            signal
                        },
                        {
                            'llm-used-token-count':
                                events['llm-used-token-count']
                        }
                    )
                )['text'] as string
            } catch (e) {
                logger?.error(`contextual compression failed: ${e}`)
            }
        }

        const prompt = await this.responsePrompt.format({
            question: getMessageContent(message.content),
            context
        })

        chatHistory.push(new SystemMessage(prompt))
        chatHistory.push(
            new AIMessage(
                "OK. I understand. I will respond to your question using the same language as your input. What's your question?"
            )
        )

        return prompt
    }

    get model() {
        return this.chain.llm
    }
}

const formatChatHistoryAsString = (history: BaseMessage[]) => {
    return history
        .map((message) => `${message.getType()}: ${message.content}`)
        .join('\n')
}

function safetyBlockMessage(content?: string) {
    return new AIMessage({
        content:
            content?.length > 0
                ? content
                : 'Request blocked by safety policy.',
        additional_kwargs: {
            chatluna_skip_history: true,
            chatluna_remove_user_history: true
        }
    })
}

interface ChatLunaToolWrapper {
    name: string
    tool: ChatLunaTool
}

interface SearchResultLike {
    title: string
    description: string
    url: string
}

interface SafetyKeywordGroup {
    name: string
    keywords: string[]
}

type SafetyPrecheck =
    | {
          safety: 'block'
          risk_level: 'high'
          categories: string[]
          matched_rule: string
          search_allowed: false
          url_allowed: false
          policy_hint: string
      }
    | {
          safety: 'recheck'
          risk_level: 'medium'
          categories: string[]
          matched_rule: string
          search_allowed: false
          url_allowed: false
          policy_hint: string
      }
    | {
          safety: 'allow'
          risk_level: 'low'
          categories: []
          search_allowed: true
          url_allowed: true
          policy_hint: string
      }

function formatSearchResults(results: SearchResultLike[]) {
    return results
        .map((result) =>
            Object.entries(result)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ')
        )
        .join('\n\n')
}

function extractQuestion(
    input: string,
    botNames: string[],
    promptAttackWarning: string
) {
    const raw = input.match(/Raw User Input:\s*([\s\S]*)$/)?.[1] ?? input
    const text = raw.trim().replace(/^@\S+\s*/, '')
    const name = botNames
        .filter((item) => item.length > 0)
        .filter((item) =>
            text.toLocaleLowerCase().startsWith(item.toLocaleLowerCase())
        )
        .sort((a, b) => b.length - a.length)[0]
    const clean =
        name == null
            ? text
            : text.slice(name.length).replace(/^\s*[:,，：]?\s*/, '').trim()

    return {
        clean,
        payload: JSON.stringify({
            security_notice: promptAttackWarning,
            user_message: clean
        })
    }
}

function fixedUrlAction(input: string): SearchAction | null {
    const urls = input
        .match(/https?:\/\/\S+/gi)
        ?.map((url) => url.replace(/[),，。；;]+$/, ''))
        .slice(0, 3)

    if (urls != null && urls.length > 0) {
        return {
            thought: 'current input contains url',
            safety: 'allow',
            action: 'url',
            content: urls
        }
    }

    return null
}

function searchTriggered(input: string, searchTriggerKeywords: string[]) {
    return searchTriggerKeywords.some((keyword) =>
        input.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
    )
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal) {
    if (signal?.aborted) {
        return Promise.reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))
    }

    return new Promise<T>((resolve, reject) => {
        const onAbort = () =>
            reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))

        signal?.addEventListener('abort', onAbort, { once: true })
        promise.then(resolve, reject).finally(() => {
            signal?.removeEventListener('abort', onAbort)
        })
    })
}
