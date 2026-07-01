import { Context, Service } from 'koishi'
import type { ModerationConfig } from './config'
import { DEFAULT_ALLOW_DECISION } from './constants'
import { logModerationEvent } from './audit/logger'
import { evaluateLocalRules } from './policy/engine'
import { DEFAULT_KEYWORD_RULES, keywordGroupRules } from './policy/rules'
import { applyAdminCommands } from './admin/commands'
import { defineModerationModels } from './storage/model'
import { ModerationRepository } from './storage/repository'
import type { ModerationEventRow } from './storage/model'
import type {
    ModerationAction,
    ModerationDecision,
    ModerationLlmRecheckBackend,
    ModerationRequest,
    UserRiskState
} from './types'
import { isBlockingDecision, normalizeDecision } from './types'

interface ModerationSession {
    platform?: string
    userId?: string
    channelId?: string
    guildId?: string
}

interface OutputMessage {
    content?: string | unknown[]
}

interface SemanticSignal {
    label: string
    reason: string
    action: 'review' | 'block'
    severity: ModerationDecision['severity']
    riskScore: number
}

const SEMANTIC_SIGNALS: (SemanticSignal & { pattern: RegExp })[] = [
    {
        label: 'privacy_linkage',
        reason: 'semantic.privacy_linkage',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern:
            /(开盒|人肉|社工库|查.*(住址|身份证|手机号|联系方式|真实姓名)|定位.*(本人|设备|位置)|通过.*(头像|学校|账号|动态).*(找|查|确认).*(真人|本人|联系方式|真实姓名))/i
    },
    {
        label: 'cyber_offense',
        reason: 'semantic.cyber_offense',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern:
            /(rdp|ssh|后台|登录).*(爆破|批量登录|批量尝试|密码尝试|失败测试|账户锁定测试)|暴力.*(登录|破解)|hydra|crunch|burp.*intruder/i
    },
    {
        label: 'credential_abuse',
        reason: 'semantic.credential_abuse',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern:
            /(撞库|批量.*(验证|登录|测试).*(邮箱|账号|账户|密码)|邮箱密码组合|旧账号.*(验证|可用|登录)|账号.*可用性|爆破密码|绕过.*(登录限制|验证码|风控))/i
    },
    {
        label: 'phishing_social',
        reason: 'semantic.phishing_social',
        action: 'block',
        severity: 5,
        riskScore: 80,
        pattern:
            /((钓鱼|冒充客服|诱导点击|验证账号|账号验证|重新验证|紧迫感|限时处理|点击.*链接|索要验证码).*(短信|通知|文案|模板|话术|提醒)|生成.*(验证页面|退款|验证码).*(文案|话术))/i
    },
    {
        label: 'biohazard_protocol',
        reason: 'semantic.biohazard_protocol',
        action: 'block',
        severity: 4,
        riskScore: 65,
        pattern:
            /(病原体扩增|培养病毒|生物样本.*(稳定|保存|固定|入库|保护剂|降温速率)|标本.*(保存|固定)|毒素.*(提取|纯化|增强))/i
    },
    {
        label: 'controlled_reaction',
        reason: 'semantic.controlled_reaction',
        action: 'review',
        severity: 4,
        riskScore: 65,
        pattern:
            /((敏感|受控|违禁).*(中间体|前体|反应)|硝化.*(条件|参数|路线|收率)|还原.*(条件|参数|路线|收率)|优化.*(收率|剂量|路线|参数))/i
    },
    {
        label: 'search_misuse',
        reason: 'semantic.search_misuse',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(泄露数据库|网盘泄露|社工库.*(搜索|查询)|google dork|搜索语法.*(泄露|数据库|密码|后台))/i
    },
    {
        label: 'stealth_code',
        reason: 'semantic.stealth_code',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(静默自启|后台上传.*日志|隐藏进程|免杀|持久化.*(木马|后门|脚本)|绕过.*(杀软|安全软件|检测)|容易被.*误会.*(维护|正常)|包装成.*(普通维护|合规测试))/i
    },
    {
        label: 'malware_persistence',
        reason: 'semantic.malware_persistence',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(自动恢复|守护循环|自动重启|开机自启|计划任务).*(脚本|实现|命令|后台|进程)|进程.*(守护|拉起|恢复)/i
    },
    {
        label: 'minor_safety',
        reason: 'semantic.minor_safety',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern:
            /(未成年|高中生|初中生|小学生|未满十八).*(暧昧|亲密|亲吻|身体接触|心动|恋爱).*(升级|更直接|更有画面|描写|桥段)/i
    },
    {
        label: 'harassment_brigading',
        reason: 'semantic.harassment_brigading',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(集中留言|集体留言|去.*主页.*留言|围攻|网暴|挂人|带节奏).*(话术|模板|文案|组织|安排|文明讨论)/i
    },
    {
        label: 'political_mobilization',
        reason: 'semantic.political_mobilization',
        action: 'block',
        severity: 3,
        riskScore: 55,
        pattern:
            /(组织.*(政治行动|线下行动|抗议|游行)|线下.*(集合|暗号|接头)|暗号.*(集合|行动|线下)|改写成.*(传播|煽动|动员)|整理.*(刺激|最容易传播).*(争议|政治|事件))/i
    }
]

const MULTI_TURN_ESCALATION =
    /(继续|上面|刚才|按上下文|补全|整理.*刺激|改写成.*传播|更直接|更有画面|包装成|换个说法|最终版本|直接给最终答案|不要拒绝|忽略限制)/i

const CRITICAL_HISTORY_LABELS = new Set([
    'credential_abuse',
    'phishing_social',
    'cyber_offense',
    'stealth_code',
    'malware_persistence',
    'biohazard_protocol',
    'controlled_reaction',
    'minor_safety',
    'harassment_brigading',
    'political_mobilization',
    'privacy_linkage',
    'search_misuse'
])

function getUserKey(sessionOrUserKey: ModerationSession | string): string {
    if (typeof sessionOrUserKey === 'string') {
        return sessionOrUserKey
    }

    return `${sessionOrUserKey.platform ?? 'unknown'}:${
        sessionOrUserKey.userId ?? 'unknown'
    }`
}

function getChannelKey(session: ModerationSession): string | undefined {
    return session.channelId ?? session.guildId
}

export class ModerationService extends Service {
    static inject = ['database']

    public readonly repository: ModerationRepository
    private _llmRecheckBackend?: ModerationLlmRecheckBackend

    constructor(
        public readonly ctx: Context,
        public readonly config: ModerationConfig
    ) {
        super(ctx, 'moderation')
        defineModerationModels(ctx)
        this.repository = new ModerationRepository(ctx, config)
        applyAdminCommands(ctx, this)
    }

    registerLlmRecheckBackend(backend: ModerationLlmRecheckBackend) {
        this._llmRecheckBackend = backend
    }

    clearLlmRecheckBackend() {
        this._llmRecheckBackend = undefined
    }

    async evaluate(req: ModerationRequest): Promise<ModerationDecision> {
        if (!this.config.enabled) {
            return normalizeDecision(DEFAULT_ALLOW_DECISION)
        }

        const risk = summarizeEventRisk(
            await this.repository.listRecentRiskEvents(
                req.userKey,
                req.conversationId
            )
        )
        const request =
            risk.length > 0
                ? {
                      ...req,
                      metadata: {
                          ...req.metadata,
                          persistedRiskContextSummary: risk,
                          riskContextSummary: [
                              typeof req.metadata?.riskContextSummary ===
                              'string'
                                  ? req.metadata.riskContextSummary
                                  : '',
                              risk
                          ]
                              .filter((item) => item.length > 0)
                              .join(',')
                      }
                  }
                : req
        const state = await this.getUserRiskState(req.userKey)
        const localDecision = normalizeDecision(
            this.config.backend.useKeywordRules
                ? evaluateLocalRules(request, state, [
                      ...DEFAULT_KEYWORD_RULES,
                      ...keywordGroupRules(
                          this.config.rules.blockKeywordGroups,
                          'block',
                          this.config.rules.shortKeywordContextRules
                      ),
                      ...keywordGroupRules(
                          this.config.rules.reviewKeywordGroups,
                          'review',
                          this.config.rules.shortKeywordContextRules
                      )
                  ])
                : DEFAULT_ALLOW_DECISION
        )
        const decision = normalizeDecision(
            this.config.backend.useKeywordRules
                ? applySemanticSignals(request, localDecision)
                : localDecision
        )
        logModerationEvent(this.ctx, 'moderation.decision', request, decision, {
            shadowMode: this.config.shadowMode
        })

        const checked = await this._recheck(request, decision)
        const event = await this.recordEvent(request, checked)
        const result = normalizeDecision({
            ...checked,
            eventId: event.id
        })

        if (result.action === 'review') {
            logModerationEvent(this.ctx, 'moderation.review', request, result, {
                eventId: event.id,
                shadowMode: this.config.shadowMode
            })
        }

        if (isBlockingDecision(result)) {
            logModerationEvent(this.ctx, 'moderation.block', request, result, {
                eventId: event.id,
                shadowMode: this.config.shadowMode
            })
        }

        if (this.config.shadowMode && isBlockingDecision(result)) {
            logModerationEvent(
                this.ctx,
                'moderation.shadow_mismatch',
                request,
                result,
                {
                    eventId: event.id,
                    shadowMode: this.config.shadowMode
                }
            )

            return normalizeDecision({
                ...result,
                action: 'allow'
            })
        }

        return result
    }

    private async _recheck(
        req: ModerationRequest,
        decision: ModerationDecision
    ) {
        if (
            decision.action !== 'review' ||
            !this.config.backend.useLlmRecheck ||
            this.config.enforcement.maxRechecksPerRequest < 1 ||
            this._llmRecheckBackend == null
        ) {
            return decision
        }

        try {
            const raw = await this._llmRecheckBackend({
                request: req,
                decision
            })

            if (
                raw == null ||
                raw.action == null ||
                (raw.action !== 'allow' &&
                    raw.action !== 'review' &&
                    raw.action !== 'block')
            ) {
                return normalizeDecision({
                    ...decision,
                    reasons: [...decision.reasons, 'llm_recheck_failed']
                })
            }

            const checked = normalizeDecision(raw)

            const result = normalizeDecision({
                ...decision,
                ...checked,
                labels:
                    checked.labels.length > 0
                        ? checked.labels
                        : decision.labels,
                reasons: [
                    ...decision.reasons,
                    ...checked.reasons,
                    `llm_recheck.${checked.action}`
                ],
                riskScore: Math.max(decision.riskScore, checked.riskScore),
                severity: Math.min(
                    5,
                    Math.max(decision.severity, checked.severity)
                ) as ModerationDecision['severity']
            })

            logModerationEvent(this.ctx, 'moderation.recheck', req, result, {
                shadowMode: this.config.shadowMode
            })

            return result
        } catch {
            const result = normalizeDecision({
                ...decision,
                reasons: [...decision.reasons, 'llm_recheck_failed']
            })

            logModerationEvent(
                this.ctx,
                'moderation.recheck_failed',
                req,
                result,
                {
                    shadowMode: this.config.shadowMode
                }
            )

            return result
        }
    }

    evaluateInput(
        session: ModerationSession,
        text: string,
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        return this.evaluate({
            stage: 'input',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            conversationId:
                typeof metadata.conversationId === 'string'
                    ? metadata.conversationId
                    : undefined,
            contentText: text,
            metadata: {
                ...metadata,
                platform: session.platform
            }
        })
    }

    evaluatePreSearch(
        session: ModerationSession,
        text: string,
        history: unknown[] = [],
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        return this.evaluate({
            stage: 'pre-search',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            conversationId:
                typeof metadata.conversationId === 'string'
                    ? metadata.conversationId
                    : undefined,
            contentText: text,
            metadata: {
                ...metadata,
                platform: session.platform,
                historyLength: history.length,
                riskContextSummary: summarizeHistoryRisk(history)
            }
        })
    }

    evaluateOutput(
        session: ModerationSession,
        message: string | unknown[] | OutputMessage,
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        const content =
            typeof message === 'object' &&
            !Array.isArray(message) &&
            message != null
                ? message.content
                : message

        return this.evaluate({
            stage: 'output',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            conversationId:
                typeof metadata.conversationId === 'string'
                    ? metadata.conversationId
                    : undefined,
            contentText: typeof content === 'string' ? content : undefined,
            contentElements: Array.isArray(content) ? content : undefined,
            metadata: {
                ...metadata,
                platform: session.platform
            }
        })
    }

    async recordRemoteApiBlock(
        session: ModerationSession,
        text: string,
        metadata: Record<string, unknown> = {}
    ): Promise<ModerationDecision> {
        const req: ModerationRequest = {
            stage: 'remote-api',
            session,
            userKey: getUserKey(session),
            channelKey: getChannelKey(session),
            conversationId:
                typeof metadata.conversationId === 'string'
                    ? metadata.conversationId
                    : undefined,
            contentText: text,
            metadata: {
                ...metadata,
                platform: session.platform
            }
        }
        const decision = normalizeDecision({
            action: 'block',
            labels: ['remote_api_content_risk'],
            reasons: ['deepseek_content_exists_risk'],
            confidence: 1,
            severity: 5,
            riskScore: 90,
            fixedReply: this.config.enforcement.remoteApiBlockReply
        })

        logModerationEvent(this.ctx, 'moderation.decision', req, decision, {
            shadowMode: this.config.shadowMode
        })

        const event = await this.recordEvent(req, decision)
        const result = normalizeDecision({
            ...decision,
            eventId: event.id
        })

        logModerationEvent(this.ctx, 'moderation.block', req, result, {
            eventId: event.id,
            shadowMode: this.config.shadowMode
        })

        return result
    }

    getUserRiskState(
        sessionOrUserKey: ModerationSession | string
    ): Promise<UserRiskState> {
        if (typeof sessionOrUserKey === 'string') {
            return this.repository.getOrCreateUserState(sessionOrUserKey)
        }

        return this.repository.getOrCreateUserState(
            getUserKey(sessionOrUserKey),
            sessionOrUserKey.platform,
            getChannelKey(sessionOrUserKey)
        )
    }

    async setUserRiskState(
        userKey: string,
        patch: Partial<UserRiskState>,
        operator: string
    ): Promise<void> {
        await this.repository.updateUserState(userKey, patch)
        logModerationEvent(
            this.ctx,
            'moderation.override',
            {
                stage: 'appeal-replay',
                userKey
            },
            {
                action: 'review',
                labels: ['admin_override'],
                confidence: 1,
                severity: 0,
                riskScore: patch.trustScore ?? 0
            },
            {
                shadowMode: this.config.shadowMode
            }
        )
    }

    async recordOverride(
        eventId: string,
        action: ModerationAction,
        operator: string,
        reason?: string
    ) {
        const review = await this.repository.recordOverride(
            eventId,
            action,
            operator,
            reason
        )
        logModerationEvent(
            this.ctx,
            'moderation.override',
            {
                stage: 'appeal-replay',
                userKey: review.userId
            },
            {
                action,
                labels: ['manual_override'],
                confidence: 1,
                severity: 0,
                riskScore: 0
            },
            {
                eventId,
                shadowMode: this.config.shadowMode
            }
        )

        return review
    }

    async purgeExpiredEvidence(now: Date = new Date()): Promise<number> {
        const count = await this.repository.purgeExpiredEvidence(now)
        logModerationEvent(
            this.ctx,
            'moderation.retention_purge',
            {
                stage: 'appeal-replay',
                userKey: 'system'
            },
            {
                action: 'allow',
                labels: [],
                confidence: 1,
                severity: 0,
                riskScore: 0
            },
            {
                count,
                shadowMode: this.config.shadowMode
            }
        )

        return count
    }

    private async recordEvent(
        req: ModerationRequest,
        decision: ModerationDecision
    ) {
        try {
            const event = await this.repository.recordEvent(req, decision)
            logModerationEvent(
                this.ctx,
                'moderation.event_recorded',
                req,
                decision,
                {
                    eventId: event.id,
                    shadowMode: this.config.shadowMode
                }
            )

            return event
        } catch (error) {
            logModerationEvent(
                this.ctx,
                'moderation.storage_failure',
                req,
                decision,
                {
                    shadowMode: this.config.shadowMode
                }
            )
            throw error
        }
    }
}

function applySemanticSignals(
    req: ModerationRequest,
    decision: ModerationDecision
): ModerationDecision {
    if (decision.action === 'block' || decision.action === 'suspend') {
        return decision
    }

    const text = req.contentText ?? ''
    const signal = SEMANTIC_SIGNALS.find((item) => item.pattern.test(text))
    const historySummary =
        typeof req.metadata?.riskContextSummary === 'string'
            ? req.metadata.riskContextSummary
            : ''
    const labelsFromHistory = historySummary
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    const hasRiskyHistory = labelsFromHistory.length > 0
    const hasCriticalHistory = labelsFromHistory.some((item) =>
        CRITICAL_HISTORY_LABELS.has(item)
    )
    const escalatesHistory = hasRiskyHistory && MULTI_TURN_ESCALATION.test(text)

    if (signal == null && !escalatesHistory) {
        return decision
    }

    const labels = new Set(decision.labels)
    const reasons = new Set(decision.reasons)

    if (signal != null) {
        labels.add(signal.label)
        reasons.add(signal.reason)
    }

    if (escalatesHistory) {
        labels.add('multi_turn_escalation')
        reasons.add('semantic.multi_turn_escalation')
        labelsFromHistory.forEach((label) => labels.add(label))
    }

    const action =
        signal?.action === 'block' || (escalatesHistory && hasCriticalHistory)
            ? 'block'
            : decision.action === 'allow'
              ? 'review'
              : decision.action
    const severity = Math.max(
        decision.severity,
        signal?.severity ?? (escalatesHistory ? 3 : 0)
    ) as ModerationDecision['severity']
    const riskScore = Math.max(
        decision.riskScore,
        signal?.riskScore ?? (escalatesHistory && hasCriticalHistory ? 75 : 55)
    )

    return normalizeDecision({
        ...decision,
        action,
        labels: [...labels],
        reasons: [...reasons],
        confidence: Math.max(decision.confidence, signal == null ? 0.65 : 0.85),
        severity,
        riskScore
    })
}

function summarizeEventRisk(rows: ModerationEventRow[]) {
    return [
        ...new Set(
            rows
                .flatMap((row) => row.labels)
                .filter((label) => CRITICAL_HISTORY_LABELS.has(label))
        )
    ].join(',')
}

function summarizeHistoryRisk(history: unknown[]) {
    const text = history
        .slice(-6)
        .map((item) =>
            typeof item === 'string'
                ? item
                : typeof (item as { content?: unknown })?.content === 'string'
                  ? (item as { content: string }).content
                  : ''
        )
        .join('\n')

    const labels = SEMANTIC_SIGNALS.filter((item) =>
        item.pattern.test(text)
    ).map((item) => item.label)

    return [...new Set(labels)].join(',')
}

declare module 'koishi' {
    interface Context {
        moderation: ModerationService
    }
}
