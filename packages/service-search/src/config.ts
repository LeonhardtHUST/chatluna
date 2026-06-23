/* eslint-disable max-len */
import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { SummaryType } from './types'

export async function apply(ctx: Context, _config: Config) {
    modelSchema(ctx)
}

export const DEFAULT_SAFETY_BLOCK_KEYWORD_GROUPS = [
    {
        name: 'L0 Adult sexual content',
        keywords: [
            '色情',
            '黄色内容',
            '黄文',
            '肉文',
            '车文',
            '开车',
            '成人内容',
            '成人视频',
            '成人网站',
            '黄网站',
            'R18',
            'NSFW',
            '露骨描写',
            '性描写',
            '性器官描写',
            '性行为描写',
            '性幻想',
            '约炮',
            '一夜情资源',
            '性交易',
            '卖淫',
            '嫖娼',
            '色情服务',
            '偷拍',
            '私密影像',
            '迷奸',
            '强奸',
            '性暴力',
            '性剥削',
            '未成年性',
            '未成年裸',
            '未成年黄',
            '未成年约',
            '未成年调教',
            '萝莉性',
            '萝莉裸',
            '萝莉黄',
            '儿童性',
            '儿童裸',
            '儿童黄'
        ].join(',')
    },
    {
        name: 'L0 Regulated dangerous goods',
        keywords: [
            '毒品',
            '制毒',
            '吸毒',
            '贩毒',
            '冰毒',
            '海洛因',
            '大麻',
            '摇头丸',
            'K粉',
            '氯胺酮',
            '芬太尼',
            '易制毒',
            '前体',
            '受管制化学品',
            '受控药物',
            '受管制药物',
            '合成毒品',
            '合成违禁药',
            '合成爆炸物',
            '提纯毒品',
            '提纯违禁药',
            '萃取毒品',
            '萃取违禁药',
            '爆炸物',
            '炸药',
            '雷管',
            '燃烧瓶',
            '土炸弹',
            '化学武器',
            '生物武器',
            '病原体扩增',
            '培养病毒',
            '绕过检测',
            '绕过监管',
            '绕过尿检',
            '绕过毒检',
            '替代前体',
            '替代管制物',
            '替代违禁药'
        ].join(',')
    },
    {
        name: 'L0 China political high risk',
        keywords: [
            '敏感政治',
            '敏感历史',
            '政治风波',
            '政治运动',
            '群体性事件',
            '群体事件',
            '反党',
            '反政府',
            '颠覆国家政权',
            '推翻政府',
            '煽动颠覆',
            '政治行动',
            '分裂国家',
            '民族分裂',
            '台独',
            '港独',
            '疆独',
            '藏独',
            '绕过政治审查',
            '绕过内容审查',
            '绕过敏感词审查',
            '规避政治审查',
            '规避内容审查',
            '规避敏感词审查',
            '敏感政治资料',
            '敏感政治事件',
            '政治敏感时间线'
        ].join(',')
    },
    {
        name: 'L0 Terrorism and violence',
        keywords: [
            '恐怖主义',
            '极端组织',
            '圣战',
            '自杀式袭击',
            '炸学校',
            '炸地铁',
            '大规模杀伤',
            '教我杀人',
            '教我放火',
            '教我爆破',
            '教我投毒',
            '怎么杀人',
            '怎么投毒',
            '怎么爆破'
        ].join(',')
    }
]

export const DEFAULT_SAFETY_BLOCK_KEYWORDS =
    DEFAULT_SAFETY_BLOCK_KEYWORD_GROUPS.flatMap((group) =>
        group.keywords.split(',')
    )

export interface SafetyBlockKeywordGroup {
    name: string
    keywords: string
}

export interface Config extends ChatLunaPlugin.Config {
    searchEngine: string[]
    topK: number
    summaryType: SummaryType
    summaryModel: string
    multiSourceMode: 'average' | 'total'
    searchFailedPrompt: string
    replySafetyCheckFails?: string
    safetyBlockKeywordGroups: SafetyBlockKeywordGroup[]
    safetyBlockKeywords?: string | string[]

    serperApiKey: string
    serperCountry: string
    serperLocation: string
    serperSearchResults: number

    bingSearchApiKey: string
    bingSearchLocation: string
    azureLocation: string

    wikipediaBaseURL: string[]
    maxWikipediaDocContentLength: number

    tavilyApiKey: string

    searxngBaseURL: string

    enableBrowser: boolean
    browserTimeout: number
    browserIdleTimeout: number
    browserMaxPages: number
    browserOutputLimit: number

    searchPrompt: string
    newQuestionPrompt: string
    searchThreshold: number
    contextualCompression: boolean
    contextualCompressionPrompt: string
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        searchEngine: Schema.array(
            Schema.union([
                Schema.const('bing-web').description('Bing (Web)'),
                Schema.const('bing-api').description('Bing (API)'),
                Schema.const('duckduckgo-lite').description(
                    'DuckDuckGo (Lite)'
                ),
                Schema.const('serper').description('Serper (Google)'),
                Schema.const('tavily').description('Tavily (API)'),
                Schema.const('google-web').description('Google (Web)'),
                Schema.const('wikipedia').description('Wikipedia'),
                Schema.const('searxng').description('SearxNG')
            ])
        )
            .default(['bing-web'])
            .role('select'),
        topK: Schema.number().min(2).max(50).step(1).default(5),
        summaryType: Schema.union([
            Schema.const('speed'),
            Schema.const('balanced'),
            Schema.const('quality')
        ]).default('speed') as Schema<Config['summaryType']>,
        multiSourceMode: Schema.union([
            Schema.const('average'),
            Schema.const('total')
        ]).default('average') as Schema<Config['multiSourceMode']>,
        summaryModel: Schema.dynamic('model').default('empty'),

        searchThreshold: Schema.percent().step(0.01).default(0.25),
        contextualCompression: Schema.boolean().default(false),
        replySafetyCheckFails: Schema.string()
            .role('textarea')
            .default('')
            .description('Fixed reply when safety blocking is triggered.'),
        safetyBlockKeywordGroups: Schema.array(
            Schema.object({
                name: Schema.string().default(''),
                keywords: Schema.string()
                    .role('textarea', { rows: [3, 8] })
                    .default('')
            })
        )
            .role('table')
            .default(DEFAULT_SAFETY_BLOCK_KEYWORD_GROUPS)
            .description(
                'Hard-block keyword groups that block browsing/search before query generation. Separate keywords with half-width commas in each group.'
            )
    }),

    Schema.object({
        enableBrowser: Schema.boolean().default(true),
        browserTimeout: Schema.number().default(60000),
        browserIdleTimeout: Schema.number().default(300000),
        browserMaxPages: Schema.number().min(1).max(20).default(6),
        browserOutputLimit: Schema.number().min(1000).default(12000)
    }),

    Schema.object({
        serperApiKey: Schema.string().role('secret'),
        serperCountry: Schema.string().default('cn'),
        serperLocation: Schema.string().default('zh-cn'),
        serperSearchResults: Schema.number().min(2).max(20).default(10)
    }),

    Schema.object({
        bingSearchApiKey: Schema.string().role('secret'),
        bingSearchLocation: Schema.string().default('zh-CN'),
        azureLocation: Schema.string().default('global')
    }),

    Schema.object({
        tavilyApiKey: Schema.string().role('secret')
    }),

    Schema.object({
        wikipediaBaseURL: Schema.array(Schema.string()).default([
            'https://en.wikipedia.org/w/api.php'
        ]),
        maxWikipediaDocContentLength: Schema.number().default(5000)
    }),

    Schema.object({
        searxngBaseURL: Schema.string().default('https://paulgo.io')
    }),

    Schema.object({
        searchPrompt: Schema.string()
            .role('textarea')
            .default(
                `Based on the search results, generate a detailed response with proper citations:

1. Main Content:
   - Present information in well-organized sections
   - Include specific details, data, and technical terms
   - Keep original language and terminology
   - Mark each key fact with a citation [^1]
   - For multiple sources, use sequential citations [^1][^2]

2. Media Content:
   - Include images when available: ![description](image_url)[^3]
   - Format tables and structured data properly

3. Organization:
   - Use clear section headings
   - Present information in logical order
   - Include bullet points for clarity
   - Highlight important quotes with proper attribution

Context:
<context>
    {context}
</context>

Output with citation References:
[^1]: [title](url)
[^2]: [title](url)
...

Output Language need same as user input language.`
            ),
        newQuestionPrompt: Schema.string()
            .role('textarea')
            .default(
                `Analyze the follow-up question and return a JSON response based on the given conversation context.

Rules:
- CRITICAL: Use the exact same language as the input. Do not translate or change the language under any circumstances.
- Make the question self-contained and clear
- Optimize for search engine queries with time-sensitivity in mind
- Consider the current time: {time} when need formulating search queries
- Before deciding the action, block requests that clearly match the configured hard-block keywords: {safetyBlockKeywords}
- ALWAYS generate 2-3 different search keywords/phrases for multi-source verification
- Do not add any explanations or additional content
- Base your response on a comprehensive analysis of the chat history
- Return your response in the following JSON format ONLY:
  {{
    "thought": "your reasoning about what to do with user input. Use the text language as the input",
    "safety": "allow" | "block",
    "action": "skip" | "search" | "url",
    "content": ["string1", "string2", ...] (optional array of strings)
  }}

Action types explanation:
1. "skip" - Use when the question doesn't require an internet search (e.g., personal opinions, simple calculations, or information already provided in the chat history)
   Example: {{ "thought": "This is asking for a personal opinion which doesn't require search", "safety": "allow", "action": "skip", "content": [] }}

2. "search" - Use when you need to generate search-engine-friendly questions
   Example: For "What's the weather like in Tokyo and New York?"
   {{ "thought": "This requires checking current weather in two different cities as of {time}", "safety": "allow", "action": "search", "content": ["Current latest weather in Tokyo {time}", "Current latest weather in New York {time}", "Tokyo weather forecast today", "New York weather forecast today"] }}

3. "url" - Use when the message contains one or more URLs that should be browsed
   Example: For "Can you summarize the information from https://example.com/article and https://example.org/data?"
   {{ "thought": "This requires browsing two specific URLs to gather information", "safety": "allow", "action": "url", "content": ["https://example.com/article", "https://example.org/data"] }}

IMPORTANT:
- Your JSON response MUST be in the same language as the follow up input. This is crucial for maintaining context and accuracy.
- If safety is "block", action MUST be "skip" and content MUST be [].
- For time-sensitive queries (news, weather, events, etc.), ALWAYS include the current time {time} in your search queries.
- ALWAYS generate multiple (2-3) search queries for better coverage and verification from different sources.

Chat History:
{chat_history}
Current Time: {time}
Hard Block Keywords:
{safetyBlockKeywords}
Follow-up Input: {question}
JSON Response:`
            ),
        searchFailedPrompt: Schema.string()
            .role('textarea')
            .default(
                `For query "{question}" with no search results:

1. Inform user about no results found
2. Offer base knowledge assistance with clear limitations:
   - Based on training data, not current info
   - May be outdated for time-sensitive topics
   - No recent developments included

Use same language as query. Suggest alternative search terms if possible.`
            ),
        contextualCompressionPrompt: Schema.string().role('textarea')
            .default(`Summarize the context based on the search action. Format in Markdown with citations. Return 'empty' if nothing relevant found.

Context:
<context>
    {context}
</context>

Action:
{action}

Output:
---
{{First paragraph as overview with citations[^1]}}

{{2-5 detail paragraphs with supporting information and citations[^2][^3]}}

## References
[^1]: [title1](url1)
[^2]: [title2](url2)
[^3]: [title3](url3)
---`)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
})
