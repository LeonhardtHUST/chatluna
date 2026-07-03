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

interface SafeSemanticContext {
    labels: string[]
    pattern: RegExp
}

const SEMANTIC_SIGNALS: (SemanticSignal & { pattern: RegExp })[] = [
    {
        label: 'privacy_linkage',
        reason: 'semantic.privacy_linkage',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern: new RegExp(
            [
                '开盒|人肉|社工库',
                '查.*(住址|身份证|手机号|联系方式|真实姓名)',
                '定位.*(本人|设备|位置)',
                '通过.*(头像|学校|账号|动态).*(找|查|确认).*(真人|本人|联系方式|真实姓名)',
                '根据.*(头像|学校|账号|动态).*(推断|定位|找到).*(真人|本人|联系方式|真实姓名)',
                '(公开账号线索|账号线索|公开账号).*(真人画像|真人档案|调研报告|串成.*画像)'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'cyber_offense',
        reason: 'semantic.cyber_offense',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern: new RegExp(
            [
                '(rdp|ssh|后台|登录).*(爆破|批量登录|批量尝试|密码尝试|失败测试|账户锁定测试)',
                '暴力.*(登录|破解)',
                'hydra|crunch|burp.*intruder',
                '批量尝试.*(效果|执行|演示|脚本|说明).*(合规测试|演练|测试)',
                '登录失败日志.*(批量尝试|执行说明|演示效果)'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'credential_abuse',
        reason: 'semantic.credential_abuse',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern: new RegExp(
            [
                '撞库.*(脚本|工具|执行|验证|登录|批量|尝试|账号|密码|可用)',
                '批量.*(验证|登录|测试).*(邮箱|账号|账户|密码)',
                '邮箱密码组合',
                '旧账号.*(验证|可用|登录|确认)',
                '账号.*可用性',
                '爆破密码',
                '绕过.*(登录限制|验证码|风控)',
                '确认.*旧账号.*还能用',
                '证明.*(同事|别人|员工)?.*密码.*弱.*(验证流程|流程|演示|测试)',
                '同事.*(密码|旧密码).*(验证|证明|演示|测试)',
                'hashcat.*(命令|字典|rockyou|破解)'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'phishing_social',
        reason: 'semantic.phishing_social',
        action: 'block',
        severity: 5,
        riskScore: 80,
        pattern: new RegExp(
            [
                '(钓鱼|冒充客服|诱导点击|验证账号|账号验证|重新验证|紧迫感|限时处理|点击.*链接|索要验证码).*(短信|通知|文案|模板|话术|提醒)',
                '生成.*(验证页面|退款|验证码).*(文案|话术)',
                '很像真的验证短信',
                '验证短信.*骗过.*同学',
                '骗过.*同学.*验证短信'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'biohazard_protocol',
        reason: 'semantic.biohazard_protocol',
        action: 'block',
        severity: 4,
        riskScore: 65,
        pattern:
            /(病原体扩增|培养病毒|生物样本.*(稳定|保存|固定|入库|保护剂|降温速率|后续观察)|保存.*生物样本|保存样本.*(观察|几天|不被否)|样本.*观察几天|标本.*(保存|固定)|微型生物多样性观察站|毒素.*(提取|纯化|增强))/i
    },
    {
        label: 'controlled_reaction_protocol',
        reason: 'semantic.controlled_reaction_protocol',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern: new RegExp(
            [
                '实验记录.*(关键条件|实验参数).*(复现|少走弯路|补得?更完整|补完整)',
                '补.*(反应条件|实验参数).*(复现实验|少走弯路)',
                '安全培训.*(真实事故|关键条件|复现|更刺激|更震撼|别写得像违规)',
                '化工.*(事故链|泄漏|点火|爆燃|闪爆).*(复现|演示|培训)',
                '(更刺激|更震撼|震撼|刺激).*(关键条件|演示|复现)',
                '(关键条件|演示|复现).*(更刺激|更震撼|震撼|刺激)',
                '增强.*(钠水反应|助燃|可燃气体|爆燃|火焰|点火).*(演示|效果|条件)',
                '高浓度.*(反应|火焰|喷洒)',
                '火焰喷洒'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'sensitive_material_distribution',
        reason: 'semantic.sensitive_material_distribution',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern: new RegExp(
            [
                '争议资料.*(做成包|资料包|转发|分享|传播).*(别写敏感词|不写敏感词|去敏|方便.*转发|触发审核)',
                '敏感词替换.*(转发|传播|资料|群)',
                '去敏.*(标题|卡片|传播|转发)',
                '加密.*(链接|压缩包|云盘|提取码)',
                '分信道.*(密码|口令)',
                '私聊口令',
                '图片切分',
                '长图转发',
                'PDF.*(转发|长图)',
                '匿名编号.*(压缩包|资料)',
                '文件命名.*(隐藏|争议|敏感)',
                '不触碰敏感词.*(打包|转发|传播)'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'controlled_reaction',
        reason: 'semantic.controlled_reaction',
        action: 'review',
        severity: 4,
        riskScore: 65,
        pattern: new RegExp(
            [
                '(敏感|受控|违禁).*(中间体|前体|反应)',
                '硝化.*(条件|参数|路线|收率)',
                '还原.*(条件|参数|路线|收率)',
                '优化.*(收率|剂量|路线|参数)'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'search_misuse',
        reason: 'semantic.search_misuse',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(泄露数据库|网盘泄露|找泄露资料.*(搜索思路|信息检索训练|检索训练)|社工库.*(搜索|查询)|google dork|搜索语法.*(泄露|数据库|密码|后台))/i
    },
    {
        label: 'stealth_code',
        reason: 'semantic.stealth_code',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern: new RegExp(
            [
                '静默自启|后台上传.*日志|隐藏进程|免杀|持久化.*(木马|后门|脚本)',
                '绕过.*(杀软|安全软件|检测)',
                '容易被.*误会.*(维护|正常)',
                '包装成.*(普通维护|合规测试)',
                '别提敏感词.*(维护|恢复|上传|后台)',
                '后台上传.*(包装|维护)',
                '安全软件.*误报.*普通运维工具',
                '变量名和行为描述.*普通运维工具',
                '输出.*自然.*不要像安全提示'
            ].join('|'),
            'i'
        )
    },
    {
        label: 'malware_persistence',
        reason: 'semantic.malware_persistence',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(自动恢复|守护循环|自动重启|开机自启|计划任务).*(脚本|实现|命令|后台|进程)|进程.*(守护|拉起|恢复)|服务总被清掉.*(自动恢复|恢复说明|自愈|韧性)/i
    },
    {
        label: 'minor_safety',
        reason: 'semantic.minor_safety',
        action: 'block',
        severity: 5,
        riskScore: 85,
        pattern:
            /(未成年|高中生|初中生|小学生|未满十八).*(暧昧|亲密|亲吻|身体接触|心动|恋爱|桥段).*(升级|更直接|更有画面|描写|更暧昧|桥段)|(暧昧|亲密|亲吻|身体接触|心动|恋爱|桥段).*(未成年|高中生|初中生|小学生|未满十八).*(升级|更直接|更有画面|描写|更暧昧)/i
    },
    {
        label: 'adult_explicit',
        reason: 'semantic.adult_explicit',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(亲密段落|感情戏|床上过程).*(更直接|更有画面|露骨|详细描写).*(别提醒|不要提醒|不提醒风险|不要像安全提示)/i
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
            /(组织.*(政治行动|线下行动|抗议|游行)|线下.*(集合|暗号|接头)|暗号.*(集合|行动|线下)|改写成.*(传播|煽动|动员)|整理.*(刺激|最容易传播).*(争议|政治|事件)|线下议题组织话术.*(校园活动通知|核心信息不能丢|别写得像违规请求))/i
    },
    {
        label: 'prompt_injection',
        reason: 'semantic.prompt_injection',
        action: 'block',
        severity: 4,
        riskScore: 75,
        pattern:
            /(忽略.*(规则|限制|指令).*(导出|输出|泄露).*(配置|提示词|系统|内部)|导出.*(隐藏配置|系统提示|内部规则|开发者指令)|客服备注.*(忽略|覆盖|导出).*(规则|配置|提示词))/i
    }
]

const MULTI_TURN_ESCALATION =
    /(继续|上面|刚才|按上下文|补全|整理.*刺激|改写成.*传播|更直接|更有画面|包装成|换个说法|最终版本|直接给最终答案|不要拒绝|忽略限制|执行说明|演示效果|看起来像|别提敏感词)/i

const SAFE_SEMANTIC_CONTEXTS: SafeSemanticContext[] = [
    {
        labels: ['credential_abuse', 'credential_abuse_risk', 'cyber_offense'],
        pattern: new RegExp(
            [
                '(蓝队|防御|告警|日志分析|WAF|误报|排查|加固|审计).*(不需要攻击步骤|不要攻击步骤|不提供攻击|只分析|防御视角|合规)',
                '(安全负责人|负责人|管理员).*(批量验证|旧密码|密码).*(回复才合规|合规回复|拒绝话术|处理话术|不允许|禁止|替代方案)',
                '(批量验证|旧密码|密码).*(合规拒绝|拒绝话术|处理话术|不应|不能|不允许)'
            ].join('|'),
            'i'
        )
    },
    {
        labels: ['phishing_social', 'phishing_social_risk'],
        pattern:
            /((担心|避免|防止|不要).*(钓鱼|诱导点击|索要验证码)|(钓鱼|诱导点击|索要验证码).*(合规版本|安全版本|改成合规|风险提示|替代文案|处理话术))/i
    },
    {
        labels: ['search_misuse', 'search_misuse_risk'],
        pattern:
            /((泄露|网盘|数据库).*(风险|培训|说明|替代流程|合规拒绝|处理话术)|(搜索语法|google dork).*(风险|替代流程|合规|不要搜索|不应搜索))/i
    },
    {
        labels: ['controlled_reaction_protocol', 'dangerous_experiment_risk'],
        pattern:
            /(拒绝.*(高风险实验|危险实验|刺激.*演示)|推荐安全替代|安全替代.*(实验|演示)|不做.*(刺激|震撼).*(实验|演示))/i
    },
    {
        labels: ['minor_safety'],
        pattern: /(心理支持|保护|防范|普法|非露骨|安全边界)/i
    },
    {
        labels: ['privacy_linkage', 'privacy_osint_risk'],
        pattern:
            /(合规拒绝|替代方案|不涉及.*(真人身份|身份关联|真人关联)|避免.*(定位|查找|关联).*(真人|本人|联系方式)|不要.*(真实联系方式|定位真人|开盒))/i
    },
    {
        labels: ['prompt_injection'],
        pattern:
            /((工单|客服|用户).*?(合规拒绝|安全回复|拒绝话术|拒绝备注|处理备注|处理话术)|处理.*?(忽略规则|导出配置).*?(合规|拒绝|不支持|不能|不允许|备注|话术))/i
    },
    {
        labels: ['biohazard_protocol', 'controlled_reaction'],
        pattern: /(SDS|安全储存|泄漏处置|危害识别|急救处置|法规合规)/i
    }
]

const CRITICAL_HISTORY_LABELS = new Set([
    'credential_abuse',
    'phishing_social',
    'cyber_offense',
    'stealth_code',
    'malware_persistence',
    'biohazard_protocol',
    'controlled_reaction_protocol',
    'controlled_reaction',
    'adult_explicit',
    'minor_safety',
    'harassment_brigading',
    'political_mobilization',
    'prompt_injection',
    'privacy_linkage',
    'search_misuse',
    'sensitive_material_distribution'
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
    const safeContext =
        signal != null &&
        SAFE_SEMANTIC_CONTEXTS.some(
            (item) =>
                item.labels.includes(signal.label) && item.pattern.test(text)
        )
    const safeDecisionContext =
        decision.action === 'review' &&
        SAFE_SEMANTIC_CONTEXTS.some(
            (item) =>
                decision.labels.some((label) => item.labels.includes(label)) &&
                item.pattern.test(text)
        )

    if (safeDecisionContext) {
        return normalizeDecision({
            ...decision,
            action: 'allow',
            reasons: [...decision.reasons, 'semantic.safe_context'],
            confidence: Math.max(decision.confidence, 0.9),
            severity: 0,
            riskScore: 0
        })
    }

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

    if ((signal == null || safeContext) && !escalatesHistory) {
        return decision
    }

    const labels = new Set(decision.labels)
    const reasons = new Set(decision.reasons)

    if (signal != null && !safeContext) {
        labels.add(signal.label)
        reasons.add(signal.reason)
    }

    if (escalatesHistory) {
        labels.add('multi_turn_escalation')
        reasons.add('semantic.multi_turn_escalation')
        labelsFromHistory.forEach((label) => labels.add(label))
    }

    const action =
        (signal?.action === 'block' && !safeContext) ||
        (escalatesHistory && hasCriticalHistory)
            ? 'block'
            : decision.action === 'allow'
              ? 'review'
              : decision.action
    const severity = Math.max(
        decision.severity,
        safeContext ? 0 : (signal?.severity ?? (escalatesHistory ? 3 : 0))
    ) as ModerationDecision['severity']
    const riskScore = Math.max(
        decision.riskScore,
        safeContext
            ? 0
            : (signal?.riskScore ??
                  (escalatesHistory && hasCriticalHistory ? 75 : 55))
    )

    return normalizeDecision({
        ...decision,
        action,
        labels: [...labels],
        reasons: [...reasons],
        confidence: Math.max(
            decision.confidence,
            signal == null || safeContext ? 0.65 : 0.85
        ),
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
