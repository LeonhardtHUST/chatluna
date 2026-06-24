import type { Context, Session } from 'koishi'
import type { ModerationService } from '../service'
import type { UserRiskState } from '../types'
import { evaluateLocalRules } from '../policy/engine'
import { normalizeDecision } from '../types'
import { formatEventCase } from '../review/appeal'
import {
    recordManualOverride,
    recordUserStateOverride
} from '../review/override'

interface UserOptions {
    watch?: boolean
    restrict?: boolean
    suspend?: boolean
    restore?: boolean
}

interface CaseOptions {
    raw?: boolean
}

function operator(session?: Session) {
    return session?.userId ?? 'admin'
}

function formatState(state: UserRiskState, eventIds: string[] = []) {
    return [
        `userKey: ${state.userKey}`,
        `state: ${state.state}`,
        `trustScore: ${state.trustScore}`,
        `reviewLevel: ${state.reviewLevel}`,
        `strikeCount: ${state.strikeCount}`,
        `lastEventAt: ${state.lastEventAt ?? '[none]'}`,
        `recentEvents: ${eventIds.length > 0 ? eventIds.join(', ') : '[none]'}`
    ].join('\n')
}

function userPatch(opts: UserOptions, score?: number): Partial<UserRiskState> {
    if (opts.restore) {
        return {
            state: 'normal',
            reviewLevel: 0,
            strikeCount: 0,
            trustScore: score ?? 0
        }
    }

    if (opts.suspend) {
        return {
            state: 'suspended',
            reviewLevel: 3,
            trustScore: score ?? 85
        }
    }

    if (opts.restrict) {
        return {
            state: 'restricted',
            reviewLevel: 2,
            trustScore: score ?? 55
        }
    }

    if (opts.watch) {
        return {
            state: 'watch',
            reviewLevel: 1,
            trustScore: score ?? 25
        }
    }

    return {
        trustScore: score ?? 0
    }
}

export function registerModerationCommands(
    ctx: Context,
    service: ModerationService,
    prefix: string
) {
    ctx.command(prefix, 'Moderation admin commands', { authority: 3 })

    ctx.command(`${prefix}.status [user:string]`, 'Show moderation status', {
        authority: 3
    }).action(async ({ session }, user) => {
        const key = user ?? `${session.platform}:${session.userId}`
        const state = await service.getUserRiskState(key)
        const events = await service.repository.listUserEvents(key, 5)

        return formatState(
            state,
            events.map((event) => event.id)
        )
    })

    ctx.command(`${prefix}.case <eventId:string>`, 'Show moderation case', {
        authority: 3
    })
        .option(
            'raw',
            '--raw Show raw evidence only when raw evidence storage is enabled and evidence has not expired.'
        )
        .action(async ({ options }, eventId) => {
            const event = await service.repository.getEvent(eventId)
            return formatEventCase(event, {
                raw: (options as CaseOptions).raw === true,
                storeRawTextForAppeal:
                    service.config.storage.storeRawTextForAppeal
            })
        })

    ctx.command(
        `${prefix}.user <user:string>`,
        'Change moderation user state',
        {
            authority: 3
        }
    )
        .option('watch', '--watch Set user state to watch.')
        .option('restrict', '--restrict Set user state to restricted.')
        .option('suspend', '--suspend Set user state to suspended.')
        .option('restore', '--restore Restore user to normal state.')
        .action(async ({ session, options }, user) => {
            const patch = userPatch(options as UserOptions)
            await recordUserStateOverride(
                service,
                user,
                patch,
                operator(session),
                `manual user state update: ${JSON.stringify(patch)}`
            )

            return formatState(await service.getUserRiskState(user))
        })

    ctx.command(
        `${prefix}.score <user:string> <value:number>`,
        'Set moderation user score',
        {
            authority: 3
        }
    ).action(async ({ session }, user, value) => {
        await recordUserStateOverride(
            service,
            user,
            userPatch({}, Number(value)),
            operator(session),
            `manual score update: ${value}`
        )

        return formatState(await service.getUserRiskState(user))
    })

    ctx.command(`${prefix}.policy`, 'Moderation policy commands', {
        authority: 3
    })

    ctx.command(
        `${prefix}.policy.test <text:text>`,
        'Evaluate local moderation policy without persistence',
        {
            authority: 3
        }
    ).action(async (_argv, text) => {
        const decision = normalizeDecision(
            evaluateLocalRules(
                {
                    stage: 'input',
                    userKey: 'policy-test',
                    contentText: text
                },
                {
                    userKey: 'policy-test',
                    trustScore: 0,
                    reviewLevel: 0,
                    state: 'normal',
                    strikeCount: 0
                }
            )
        )

        return JSON.stringify(decision)
    })

    ctx.command(`${prefix}.retention`, 'Moderation retention commands', {
        authority: 3
    })

    ctx.command(
        `${prefix}.retention.run`,
        'Purge expired moderation evidence',
        {
            authority: 3
        }
    ).action(async () => {
        return `purged: ${await service.purgeExpiredEvidence()}`
    })

    ctx.command(
        `${prefix}.shadow <state:string>`,
        'Set moderation shadow mode',
        {
            authority: 3
        }
    ).action((_argv, state) => {
        service.config.shadowMode = state !== 'off'
        return `shadowMode: ${service.config.shadowMode}`
    })

    ctx.command(
        `${prefix}.override <eventId:string> <action:string>`,
        'Record moderation override',
        {
            authority: 3
        }
    ).action(async ({ session }, eventId, action) => {
        const review = await recordManualOverride(
            service,
            eventId,
            action as never,
            operator(session),
            'manual override'
        )

        return `override: ${review.id}`
    })
}

export function applyAdminCommands(ctx: Context, service: ModerationService) {
    registerModerationCommands(ctx, service, 'moderation')
    registerModerationCommands(ctx, service, 'chatluna.moderation')
}

export { formatState, userPatch }
