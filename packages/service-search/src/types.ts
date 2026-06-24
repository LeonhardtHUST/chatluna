export interface SearchResult {
    title: string
    url: string
    description: string
    image?: string
}

export enum SummaryType {
    Speed = 'speed',
    Balanced = 'balanced',
    Quality = 'quality'
}

export interface SearchAction {
    thought: string
    safety?: 'allow' | 'recheck' | 'block'
    risk_level?: 'low' | 'medium' | 'high'
    risk_categories?: string[]
    action: 'url' | 'search' | 'skip'
    content?: string[]
}
