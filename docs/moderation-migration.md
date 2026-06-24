# Moderation Migration

## Old To New Config Mapping

Existing config keys remain accepted. Compatibility adapters map old behavior
into moderation-kernel when the corresponding compatibility flag is enabled.

Core:

| Old key | Moderation mapping |
| --- | --- |
| `censor` | Controls whether core output moderation is used when `mapCoreCensor=true`. |
| `rawOnCensor` | Passed as compatibility metadata to output evaluation. |

Service-search:

| Old key | Moderation mapping |
| --- | --- |
| `replySafetyCheckFails` | `moderation.enforcement.fixedBlockReply` when the new value is still default. |
| `safetyBlockKeywordGroups` | `moderation.rules.blockKeywordGroups` when no explicit new groups exist. |
| `safetyRecheckKeywordGroups` | `moderation.rules.reviewKeywordGroups` when no explicit new groups exist. |
| `promptAttackWarning` | `moderation.rules.promptAttackWarning` when no explicit new value exists. |

Explicit moderation config wins over legacy mapping. Deprecated legacy keys log
a warning once per process instead of once per message.

## Shadow Mode Rollout

Default moderation config starts with:

```ts
enabled: true
shadowMode: true
```

In shadow mode, the service records decisions and emits audit logs, but blocking
decisions are returned as `allow`. This is the recommended first deployment
state.

Recommended rollout:

1. Enable moderation-kernel with default shadow mode.
2. Keep legacy `censor` and service-search safety settings unchanged.
3. Review `moderation.decision`, `moderation.block`,
   `moderation.review`, and `moderation.shadow_mismatch` logs.
4. Tune keyword groups and fixed replies.
5. Switch one low-risk environment or group to enforce mode.

## Enforce Mode Rollout

Set:

```ts
shadowMode: false
```

In enforce mode:

- Input `block` and `suspend` stop the core chat chain before model/search/tool
  execution.
- Pre-search `block` stops service-search before search or URL browsing.
- Output `block` replaces the response with the configured fixed reply.

Do not remove legacy safety settings during the initial enforce rollout. They
remain useful as compatibility fallback if moderation is disabled or missing.

## Rollback Procedure

Fast rollback options:

1. Set `moderation.enabled=false`.
2. Set `moderation.shadowMode=true`.
3. Disable only one stage with `inputEnabled`, `preSearchEnabled`, or
   `outputEnabled`.
4. For core output behavior, keep `mapCoreCensor=true` and rely on existing
   `censor`.
5. For service-search, keep existing keyword groups and fixed block reply.

No database deletion is required for rollback. Stored event rows are audit
metadata and raw evidence is disabled by default.
