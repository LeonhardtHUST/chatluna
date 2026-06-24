import { SearchAction } from '../types'

type RouterResult = SearchAction & {
    risk_event?: {
        category?: string
        severity?: number
        confidence?: number
        redline?: boolean
    }
}

/**
 * 预处理内容，移除可能的 markdown 代码块标记
 */
export function preprocessContent(content: string): string {
    // 移除 markdown 代码块标记 (```json 和 ```)
    content = content.replace(
        /```(?:json|javascript|js)?\s*([\s\S]*?)```/g,
        '$1'
    )

    // 移除前后可能的空白字符
    content = content.trim()

    return content
}

/**
 * 尝试解析 JSON，失败时返回 null
 */
export function tryParseJSON<T>(content: string): T | null {
    try {
        return JSON.parse(content) as T
    } catch (e) {
        return null
    }
}

/**
 * 尝试修复常见的 JSON 格式错误
 */
export function attemptToFixJSON(content: string): string {
    let fixedContent = content

    // 修复缺少引号的键名
    fixedContent = fixedContent.replace(
        /(\{|\,)\s*([a-zA-Z0-9_]+)\s*\:/g,
        '$1"$2":'
    )

    // 修复使用单引号而非双引号的情况
    fixedContent = fixedContent.replace(/(\{|\,)\s*'([^']+)'\s*\:/g, '$1"$2":')
    fixedContent = fixedContent.replace(/\:\s*'([^']+)'/g, ':"$1"')

    // 修复缺少逗号的情况
    fixedContent = fixedContent.replace(/"\s*\}\s*"/g, '","')
    fixedContent = fixedContent.replace(/"\s*\{\s*"/g, '",{"')

    // 修复多余的逗号
    fixedContent = fixedContent.replace(/,\s*\}/g, '}')
    fixedContent = fixedContent.replace(/,\s*\]/g, ']')

    // 修复不完整的数组
    if (fixedContent.includes('[') && !fixedContent.includes(']')) {
        fixedContent += ']'
    }

    // 修复不完整的对象
    if (fixedContent.includes('{') && !fixedContent.includes('}')) {
        fixedContent += '}'
    }

    // 如果内容不是以 [ 开头但包含 [ 字符，尝试提取数组部分
    if (!fixedContent.trim().startsWith('[') && fixedContent.includes('[')) {
        const arrayMatch = fixedContent.match(/\[([\s\S]*)\]/)
        if (arrayMatch && arrayMatch[0]) {
            fixedContent = arrayMatch[0]
        }
    }

    return fixedContent
}

export function removeProperty<T extends object, K extends keyof T>(
    value: T,
    properties: K[]
): Omit<T, K> {
    const propertySet = new Set(properties)
    const result = {}

    for (const [key, val] of Object.entries(value)) {
        if (!propertySet.has(key as K)) {
            result[key] = val
        }
    }

    return result as Omit<T, K>
}

export function parseSearchAction(content: string): SearchAction {
    const action = preprocessContent(content)
    const parsed = tryParseJSON<RouterResult>(action)
    const result =
        parsed ?? tryParseJSON<RouterResult>(attemptToFixJSON(action))

    if (action.includes('[skip]')) {
        return {
            action: 'skip',
            safety: 'allow',
            thought: 'skip the search',
            content: []
        }
    }

    if (result == null) {
        return {
            action: 'skip',
            safety: 'recheck',
            thought: 'invalid router json',
            content: []
        }
    }

    const categories = Array.isArray(result.risk_categories)
        ? result.risk_categories
        : result.risk_event?.category != null &&
            result.risk_event.category !== 'none'
          ? [result.risk_event.category]
          : []
    const riskLevel =
        result.risk_level ??
        (result.risk_event?.redline || (result.risk_event?.severity ?? 0) >= 4
            ? 'high'
            : (result.risk_event?.severity ?? 0) >= 2
              ? 'medium'
              : 'low')

    if (result.safety == null) {
        return {
            action: 'skip',
            safety: 'recheck',
            thought: 'missing router safety',
            content: [],
            risk_level: riskLevel,
            risk_categories: categories
        }
    }

    if (result.safety === 'block' || result.safety === 'recheck') {
        return {
            action: 'skip',
            safety: result.safety,
            thought: result.thought ?? 'blocked by safety policy',
            content: [],
            risk_level: riskLevel,
            risk_categories: categories
        }
    }

    if (
        result.safety != null &&
        result.safety !== 'allow' &&
        result.safety !== 'recheck' &&
        result.safety !== 'block'
    ) {
        return {
            action: 'skip',
            safety: 'recheck',
            thought: 'invalid router safety',
            content: [],
            risk_level: riskLevel,
            risk_categories: categories
        }
    }

    if (
        result.action !== 'skip' &&
        result.action !== 'search' &&
        result.action !== 'url'
    ) {
        return {
            action: 'skip',
            safety: 'allow',
            thought: 'invalid router action',
            content: []
        }
    }

    if (result.action === 'skip') {
        return {
            action: 'skip',
            safety: 'allow',
            thought: result.thought ?? 'skip the search',
            content: [],
            risk_level: riskLevel,
            risk_categories: categories
        }
    }

    if (!Array.isArray(result.content)) {
        return {
            action: 'skip',
            safety: 'allow',
            thought: 'invalid router content',
            content: []
        }
    }

    const items = result.content
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 3)

    if (result.action === 'url') {
        const urls = items.filter((item) => /^https?:\/\//i.test(item))

        return urls.length > 0
            ? {
                  action: 'url',
                  safety: 'allow',
                  thought: result.thought ?? 'browse url',
                  content: urls,
                  risk_level: riskLevel,
                  risk_categories: categories
              }
            : {
                  action: 'skip',
                  safety: 'allow',
                  thought: 'invalid router url content',
                  content: []
              }
    }

    if (items.length > 0) {
        return {
            action: 'search',
            safety: 'allow',
            thought: result.thought ?? 'search the web',
            content: items,
            risk_level: riskLevel,
            risk_categories: categories
        }
    }

    return {
        action: 'skip',
        safety: 'allow',
        thought: 'invalid router search content',
        content: []
    }
}
