/// <reference types="mocha" />

import { assert } from 'chai'
import { Config } from '../src/config'
import { SearchManager, SearchProvider } from '../src/provide'

const ctx = {
    logger: () => ({
        error() {},
        warn() {}
    })
} as never

describe('service-search search manager latency controls', () => {
    it('returns early after enough provider results are available', async () => {
        const manager = new SearchManager(ctx, {
            topK: 5,
            searchEngine: ['fast', 'slow'],
            multiSourceMode: 'total',
            providerTimeoutMs: 500,
            searchEarlyReturnResults: 1
        } as Config)
        manager.addProvider({
            name: 'fast',
            search: async () => [
                {
                    title: 'fast',
                    url: 'https://example.com/fast',
                    description: 'fast result'
                }
            ]
        } as SearchProvider)
        manager.addProvider({
            name: 'slow',
            search: async () =>
                new Promise((resolve) =>
                    setTimeout(
                        () =>
                            resolve([
                                {
                                    title: 'slow',
                                    url: 'https://example.com/slow',
                                    description: 'slow result'
                                }
                            ]),
                        500
                    )
                )
        } as SearchProvider)

        const started = Date.now()
        const results = await manager.search('query', 5)

        assert.isBelow(Date.now() - started, 400)
        assert.lengthOf(results, 1)
        assert.equal(results[0].title, 'fast')
    })

    it('returns empty results when a single provider times out', async () => {
        const manager = new SearchManager(ctx, {
            topK: 5,
            searchEngine: ['slow'],
            multiSourceMode: 'total',
            providerTimeoutMs: 50,
            searchEarlyReturnResults: 1
        } as Config)
        manager.addProvider({
            name: 'slow',
            search: async () =>
                new Promise((resolve) =>
                    setTimeout(
                        () =>
                            resolve([
                                {
                                    title: 'slow',
                                    url: 'https://example.com/slow',
                                    description: 'slow result'
                                }
                            ]),
                        500
                    )
                )
        } as SearchProvider)

        const results = await manager.search('query', 5)

        assert.deepEqual(results, [])
    })
})
