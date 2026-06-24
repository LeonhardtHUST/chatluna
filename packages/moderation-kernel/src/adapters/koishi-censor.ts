import type { Context } from 'koishi'
import type { ModerationDecision, ModerationRequest } from '../types'
import { normalizeDecision } from '../types'

interface CensorContext extends Context {
    censor?: {
        transform(text: string, session?: unknown): Promise<string> | string
    }
}

interface TextElement {
    type: string
    text?: string
}

export async function transformWithKoishiCensor(
    ctx: Context,
    req: ModerationRequest,
    decision: ModerationDecision
): Promise<ModerationDecision> {
    const censor = (ctx as CensorContext).censor

    if (!censor) {
        return decision
    }

    const text = decision.transformedText ?? req.contentText

    if (text != null) {
        const transformedText = await censor.transform(text, req.session)

        return normalizeDecision({
            ...decision,
            action: decision.action === 'allow' ? 'rewrite' : decision.action,
            transformedText
        })
    }

    const elements = decision.transformedElements ?? req.contentElements

    if (elements == null) {
        return decision
    }

    return normalizeDecision({
        ...decision,
        action: decision.action === 'allow' ? 'rewrite' : decision.action,
        transformedElements: await Promise.all(
            elements.map(async (el) => {
                const item = el as TextElement

                if (item.type !== 'text' || item.text == null) {
                    return el
                }

                return {
                    ...item,
                    text: await censor.transform(item.text, req.session)
                }
            })
        )
    })
}
