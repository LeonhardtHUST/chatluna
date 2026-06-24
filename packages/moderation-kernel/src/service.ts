import { Context, Service } from 'koishi'
import type { ModerationConfig } from './config'
import { defineModerationModels } from './storage/model'
import { ModerationRepository } from './storage/repository'

export class ModerationService extends Service {
    static inject = ['database'] as const

    public readonly repository: ModerationRepository

    constructor(
        ctx: Context,
        public readonly config: ModerationConfig
    ) {
        super(ctx, 'moderation')
        defineModerationModels(ctx)
        this.repository = new ModerationRepository(ctx, config)
    }
}
