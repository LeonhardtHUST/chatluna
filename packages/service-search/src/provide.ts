import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SearchResult } from './types'
import type { Config } from './config'
import { Document } from '@langchain/core/documents'
import { MemoryVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaBaseEmbeddings } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { EmptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'

export abstract class SearchProvider {
    constructor(
        protected ctx: Context,
        protected config: Config,
        protected _plugin: ChatLunaPlugin
    ) {}

    abstract search(query: string, limit: number): Promise<SearchResult[]>

    abstract name: string
}

export class SearchManager {
    private providers: Map<string, SearchProvider> = new Map()
    private schemas: Schema[] = []
    private _embeddings: ComputedRef<ChatLunaBaseEmbeddings>
    private logger: Logger

    constructor(
        private ctx: Context,
        public config: Config
    ) {
        this.logger = ctx.logger('chatluna-search-service')
    }

    addProvider(provider: SearchProvider) {
        this.providers.set(provider.name, provider)

        return () => this._deleteProvider(provider.name)
    }

    getProvider(name: string): SearchProvider | undefined {
        return this.providers.get(name)
    }

    private _deleteProvider(name: string) {
        this.providers.delete(name)
    }

    updateSchema(schema: Schema) {
        this.schemas.push(schema)

        this.ctx.schema.set(
            'search-engine',
            Schema.array(Schema.union(this.schemas))
        )
    }

    async search(
        query: string,
        limit: number = this.config.topK,
        providerNames: string[] = this.config.searchEngine
    ): Promise<SearchResult[]> {
        const providers = providerNames
            ? Array.from(this.providers.values()).filter((p) =>
                  providerNames.includes(p.name)
              )
            : Array.from(this.providers.values())

        if (providers.length < 1) return []

        if (providers.length === 1) {
            // 一个源就不用分了，直接返回
            try {
                return await searchWithTimeout(
                    providers[0].search(query, limit),
                    this.config.providerTimeoutMs
                )
            } catch (error) {
                this.logger.error(
                    `Error searching with provider ${providers[0].name}:`,
                    error
                )
                return []
            }
        }

        const searchResults: SearchResult[] = []
        const results = await new Promise<SearchResult[]>((resolve) => {
            let done = 0
            let resolved = false

            const signalLimit =
                this.config.multiSourceMode === 'average'
                    ? Math.max(1, Math.round(limit / providers.length))
                    : limit

            const finish = () => {
                done += 1
                if (
                    !resolved &&
                    (done >= providers.length ||
                        searchResults.length >=
                            this.config.searchEarlyReturnResults)
                ) {
                    resolved = true
                    resolve([...searchResults])
                }
            }

            providers.forEach((provider) => {
                searchWithTimeout(
                    provider.search(query, signalLimit),
                    this.config.providerTimeoutMs
                )
                    .then((results) => {
                        searchResults.push(...results)
                    })
                    .catch((error) => {
                        this.logger.error(
                            `Error searching with provider ${provider.name}:`,
                            error
                        )
                    })
                    .finally(finish)
            })
        })

        if (results.length > limit) {
            return this._reRankResults(query, results, limit)
        }

        return results
    }

    private async _getEmbeddings() {
        if (this._embeddings) return this._embeddings

        try {
            const [platform, model] = parseRawModelName(
                this.ctx.chatluna.config.defaultEmbeddings
            )
            this._embeddings = await this.ctx.chatluna.createEmbeddings(
                platform,
                model
            )
        } catch (e) {
            this.logger.warn(
                `Get embeddings failed: ${e}. Try check your defaultEmbeddings`
            )
            return null
        }

        return this._embeddings
    }

    private async _reRankResults(
        query: string,
        results: SearchResult[],
        limit: number
    ) {
        // 1. 构建临时的向量数据库

        const embeddings = await this._getEmbeddings()

        if (!embeddings || embeddings.value instanceof EmptyEmbeddings) {
            this.logger.warn('Embeddings is null. Return original results.')
            return results
        }

        const vectorStore = new MemoryVectorStore(embeddings.value)

        // 2. 存储搜索标题进去

        const docs = results.map(
            (r) =>
                ({
                    pageContent: r.title,
                    metadata: r
                }) satisfies Document
        )

        await vectorStore.addDocuments(docs)

        // 3. 搜索

        const searchResults = await vectorStore.similaritySearch(query, limit)

        // 4. 重映射

        return searchResults.map((r) => r.metadata) as SearchResult[]
    }
}

function searchWithTimeout(
    promise: Promise<SearchResult[]>,
    timeoutMs: number
) {
    if (timeoutMs < 1) return promise

    return new Promise<SearchResult[]>((resolve, reject) => {
        const timer = setTimeout(
            () =>
                reject(
                    new Error(`Search provider timed out after ${timeoutMs}ms`)
                ),
            timeoutMs
        )

        promise
            .then((results) => {
                clearTimeout(timer)
                resolve(results)
            })
            .catch((error) => {
                clearTimeout(timer)
                reject(error)
            })
    })
}
