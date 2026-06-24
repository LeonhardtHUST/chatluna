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

export function applyAdminCommands(ctx: Context, service: ModerationService) {
    ctx.command('moderation', 'Moderation admin commands', { authority: 3 })

    ctx.command('moderation.status [user:string]', 'Show moderation status', {
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

    ctx.command('moderation.case <eventId:string>', 'Show moderation case', {
        authority: 3
    })
        .option('raw', '--raw')
        .action(async ({ options }, eventId) => {
            const event = await service.repository.getEvent(eventId)
            return formatEventCase(event, {
                raw: (options as CaseOptions).raw === true,
                storeRawTextForAppeal:
                    service.config.storage.storeRawTextForAppeal
            })
        })

    ctx.command(
        'moderation.user <user:string>',
        'Change moderation user state',
        {
            authority: 3
        }
    )
        .option('watch', '--watch')
        .option('restrict', '--restrict')
        .option('suspend', '--suspend')
        .option('restore', '--restore')
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
        'moderation.score <user:string> <value:number>',
        'Set moderation user score',
        { authority: 3 }
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

    ctx.command(
        'moderation.policy.test <text:text>',
        'Evaluate local moderation policy without persistence',
        { authority: 3 }
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

    ctx.command(
        'moderation.retention.run',
        'Purge expired moderation evidence',
        {
            authority: 3
        }
    ).action(async () => {
        return `purged: ${await service.purgeExpiredEvidence()}`
    })

    ctx.command(
        'moderation.shadow <state:string>',
        'Set moderation shadow mode',
        {
            authority: 3
        }
    ).action((_argv, state) => {
        service.config.shadowMode = state !== 'off'
        return `shadowMode: ${service.config.shadowMode}`
    })

    ctx.command(
        'moderation.override <eventId:string> <action:string>',
        'Record moderation override',
        { authority: 3 }
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

export { formatState, userPatch }
