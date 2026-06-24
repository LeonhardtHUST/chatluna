import { assert } from 'chai'
import { cfg, createService } from './service.spec'
import { formatEventCase, recordUserStateOverride, userPatch } from '../src'
import { decision } from './storage.spec'
import type { Context } from 'koishi'

interface CommandLike {
    config: {
        authority?: number
    }
    _options: Record<string, unknown>
}

function command(app: Context, name: string) {
    return (
        app as unknown as {
            $commander: {
                get(name: string): CommandLike | undefined
            }
        }
    ).$commander.get(name)
}

function i18n(app: Context, path: string) {
    return (
        app as unknown as {
            i18n: {
                _data: Record<string, Record<string, string>>
            }
        }
    ).i18n._data[''][path]
}

describe('moderation admin commands', () => {
    it('registers moderation commands under chatluna and top-level namespaces', async () => {
        const { app } = await createService()
        const names = [
            'moderation',
            'moderation.status',
            'moderation.case',
            'moderation.user',
            'moderation.score',
            'moderation.policy',
            'moderation.policy.test',
            'moderation.retention',
            'moderation.retention.run',
            'moderation.shadow',
            'moderation.override',
            'chatluna.moderation',
            'chatluna.moderation.status',
            'chatluna.moderation.case',
            'chatluna.moderation.user',
            'chatluna.moderation.score',
            'chatluna.moderation.policy',
            'chatluna.moderation.policy.test',
            'chatluna.moderation.retention',
            'chatluna.moderation.retention.run',
            'chatluna.moderation.shadow',
            'chatluna.moderation.override'
        ]

        for (const name of names) {
            assert.exists(command(app, name), name)
            assert.equal(command(app, name)?.config.authority, 3, name)
            assert.isNotEmpty(i18n(app, `commands.${name}.description`), name)
        }

        await app.stop()
    })

    it('documents moderation command options safely', async () => {
        const { app } = await createService()
        const caseCommand = command(app, 'chatluna.moderation.case')!
        const userCommand = command(app, 'chatluna.moderation.user')!
        const helpText = JSON.stringify(
            (app as unknown as {
                i18n: {
                    _data: Record<string, Record<string, string>>
                }
            }).i18n._data['']
        )

        assert.hasAllKeys(caseCommand._options, ['raw'])
        assert.hasAllKeys(userCommand._options, [
            'watch',
            'restrict',
            'suspend',
            'restore'
        ])
        assert.include(
            i18n(app, 'commands.chatluna.moderation.case.options.raw'),
            'raw evidence storage is enabled'
        )
        assert.include(
            i18n(app, 'commands.chatluna.moderation.user.options.watch'),
            'watch'
        )
        assert.include(
            i18n(app, 'commands.chatluna.moderation.user.options.restrict'),
            'restricted'
        )
        assert.include(
            i18n(app, 'commands.chatluna.moderation.user.options.suspend'),
            'suspended'
        )
        assert.include(
            i18n(app, 'commands.chatluna.moderation.user.options.restore'),
            'normal state'
        )
        assert.notInclude(helpText, 'private raw evidence')

        await app.stop()
    })

    it('formats cases without raw evidence by default', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 7
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.notInclude(formatEventCase(event), 'private raw evidence')
        await app.stop()
    })

    it('formats raw evidence only with explicit raw option', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 7
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.include(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: true,
                now
            }),
            'private raw evidence'
        )
        await app.stop()
    })

    it('hides raw evidence when raw option is unavailable or expired', async () => {
        const now = new Date('2026-06-24T00:00:00.000Z')
        const { app, service } = await createService(
            cfg({
                storage: {
                    storeRawTextForAppeal: true,
                    rawTextRetentionDays: 1
                }
            })
        )
        const event = await service.repository.recordEvent(
            {
                stage: 'input',
                userKey: 'user-1',
                contentText: 'private raw evidence'
            },
            decision,
            { now }
        )

        assert.notInclude(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: false,
                now
            }),
            'private raw evidence'
        )
        assert.notInclude(
            formatEventCase(event, {
                raw: true,
                storeRawTextForAppeal: true,
                now: new Date('2026-06-25T00:00:00.000Z')
            }),
            'private raw evidence'
        )
        await app.stop()
    })

    it('changes user state and creates review audit rows', async () => {
        const { app, service } = await createService()

        await recordUserStateOverride(
            service,
            'user-1',
            userPatch({
                suspend: true
            }),
            'admin',
            'manual suspend'
        )

        const state = await service.getUserRiskState('user-1')
        const reviews = await app.database.get('chatluna_moderation_review', {})

        assert.equal(state.state, 'suspended')
        assert.equal(state.reviewLevel, 3)
        assert.lengthOf(reviews, 1)
        assert.equal(reviews[0].status, 'open')
        await app.stop()
    })

    it('restores users to normal state', () => {
        assert.deepEqual(
            userPatch({
                restore: true
            }),
            {
                state: 'normal',
                reviewLevel: 0,
                strikeCount: 0,
                trustScore: 0
            }
        )
    })
})
