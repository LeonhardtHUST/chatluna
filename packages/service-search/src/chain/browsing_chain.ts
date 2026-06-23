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
    safetyBlockKeywords: string[]
    variableService: ChatLunaPromptRenderService
    browserManager?: BrowserManager
}

export class ChatLunaBrowsingChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaBrowsingChainInput
{
    botName: string

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

    safetyBlockKeywords: string[]

    private _toolMask?: ToolMask

    constructor({
        botName,
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
        safetyBlockKeywords
    }: ChatLunaBrowsingChainInput & {
        chain: ChatLunaLLMChain
        formatQuestionChain: ChatLunaLLMChain
        tools: ComputedRef<ChatLunaToolWrapper[]>
        searchPrompt: string
        contextualCompressionChain?: ChatLunaLLMChain
    }) {
        super()
        this.botName = botName
        this.preset = preset

        this.embeddings = embeddings
        this.summaryType = summaryType

        this.formatQuestionChain = formatQuestionChain

        this.historyMemory = historyMemory
        this.thoughtMessage = thoughtMessage
        this.searchFailedPrompt = searchFailedPrompt
        this.newQuestionPrompt = newQuestionPrompt
        this.replySafetyCheckFails = replySafetyCheckFails
        this.safetyBlockKeywords = safetyBlockKeywords
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
            safetyBlockKeywords,
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
            formatQuestionChain,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            searchFailedPrompt,
            replySafetyCheckFails,
            safetyBlockKeywords,
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

    private _findBlockHit(input: string) {
        return this.safetyBlockKeywords.find((keyword) => {
            const word = keyword.trim()
            return (
                word.length > 0 &&
                input.toLocaleLowerCase().includes(word.toLocaleLowerCase())
            )
        })
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
        const clean = extractQuestion(input, this.botName)
        const date = new Date().toISOString().slice(0, 10)

        logger?.debug(`[search-service] raw question: ${input}`)
        logger?.debug(`[search-service] clean question: ${clean}`)

        const hit = this._findBlockHit(clean)

        if (hit) {
            logger?.debug(`blocked response: keyword ${hit}`)
            return {
                message: new AIMessage(
                    this.replySafetyCheckFails?.length > 0
                        ? this.replySafetyCheckFails
                        : 'Request blocked by safety policy.'
                )
            }
        }

        const fixedAction = fixedSearchAction(clean, date)

        if (fixedAction != null) {
            logger?.debug(`action: ${JSON.stringify(fixedAction)}`)
            await this._search(
                fixedAction,
                message,
                chatHistory,
                session,
                events,
                conversationId,
                signal
            )

            return await this._answer(
                requests,
                stream,
                signal,
                session,
                maxToken,
                events
            )
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
                    question: JSON.stringify(clean),
                    safetyBlockKeywords: this.safetyBlockKeywords.join('\n'),
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

        if (searchAction.safety === 'block') {
            logger?.debug('blocked response: router safety block')
            return {
                message: new AIMessage(
                    this.replySafetyCheckFails?.length > 0
                        ? this.replySafetyCheckFails
                        : 'Request blocked by safety policy.'
                )
            }
        }

        if (Array.isArray(searchAction?.content)) {
            const queryHit = searchAction.content
                .map((item) => this._findBlockHit(item))
                .find((keyword) => keyword != null)

            if (queryHit) {
                logger?.debug(`blocked response: search keyword ${queryHit}`)
                return {
                    message: new AIMessage(
                        this.replySafetyCheckFails?.length > 0
                            ? this.replySafetyCheckFails
                            : 'Request blocked by safety policy.'
                    )
                }
            }
        }

        // search questions

        if (searchAction != null && searchAction.action !== 'skip') {
            await this._search(
                searchAction,
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

interface ChatLunaToolWrapper {
    name: string
    tool: ChatLunaTool
}

interface SearchResultLike {
    title: string
    description: string
    url: string
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

function extractQuestion(input: string, botName: string) {
    const raw = input.match(/Raw User Input:\s*([\s\S]*)$/)?.[1] ?? input
    const text = raw.trim().replace(/^@\S+\s*/, '')
    const name = [botName, 'Leo', 'Leonbot'].find(
        (item) =>
            item.length > 0 &&
            text.toLocaleLowerCase().startsWith(item.toLocaleLowerCase())
    )

    if (name == null) return text

    return text.slice(name.length).replace(/^\s*[:,，：]?\s*/, '').trim()
}

function fixedSearchAction(input: string, date: string): SearchAction | null {
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

    if (
        /搜索|查询|查找|查一下|上网|联网|浏览|看一下|帮我看|帮我找|找资料|核实|验证|是否属实|是真的吗|来源|出处|原文|官网|公告|通知|新闻|动态|进展|近况|最新|最近|当前|现在|今天|本周|本月|今年|刚发布|刚更新/.test(
            input
        )
    ) {
        return {
            thought: 'current input matches search trigger',
            safety: 'allow',
            action: 'search',
            content: [
                `${input} ${date}`,
                `${input} 官网 公告 新闻 ${date}`,
                `${input} 来源 原文 ${date}`
            ]
        }
    }

    return null
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
