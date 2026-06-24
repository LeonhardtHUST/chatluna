import { Context, Service } from 'koishi'
import type { ModerationConfig } from './config'

export class ModerationService extends Service {
    static inject = ['database'] as const

    constructor(
        ctx: Context,
        public readonly config: ModerationConfig
    ) {
        super(ctx, 'moderation')
    }
}
