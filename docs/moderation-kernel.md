# Moderation Kernel

## Overview

`packages/moderation-kernel` centralizes ChatLuna moderation decisions behind
one Koishi service:

```ts
ctx.moderation
```

The package owns the moderation ABI, local policy evaluation, privacy-first
event storage, audit logging, retention cleanup, compatibility adapters, and
admin commands. Core ChatLuna and service-search call this service at stable
boundaries instead of each package inventing its own final enforcement path.

## Why It Is Centralized

Moderation used to be split across output censoring, service-search safety
checks, router prompts, and future review plans. Centralizing it gives us:

- Code-level enforcement for `block` and `suspend`.
- One decision schema for input, pre-search, tool arguments, output, and
  appeal replay.
- One privacy model for evidence hashing and raw evidence retention.
- Compatibility shims for old config keys while new deployments migrate.
- Shadow-mode rollout before enforcement.

Prompt-only refusals are not treated as final enforcement. If a request must be
blocked, the block must pass through code that short-circuits the model, search,
or output path.

## Stages

The current stages are:

- `input`: runs before model/search/tool execution in ChatLuna core.
- `pre-search`: runs before service-search routing, web search, or URL fetch.
- `output`: runs before final response delivery and can wrap Koishi censor.
- `tool-args`: reserved for future tool argument moderation.
- `appeal-replay`: used for admin overrides and review workflows.

## Decisions

The moderation ABI uses:

```ts
type ModerationAction =
    | 'allow'
    | 'review'
    | 'rewrite'
    | 'block'
    | 'suspend'
```

`block` and `suspend` are blocking decisions. `review` is conservative and may
route to a safer path, but it is not itself a hard block unless the caller is in
enforce mode and configured to stop on review.

Each decision includes labels, reasons, confidence, severity, risk score,
optional transformed output, optional fixed reply, and optional event id.

## Service API

Primary methods:

```ts
ctx.moderation.evaluate(req)
ctx.moderation.evaluateInput(session, text, metadata)
ctx.moderation.evaluatePreSearch(session, text, history, metadata)
ctx.moderation.evaluateOutput(session, message, metadata)
ctx.moderation.getUserRiskState(sessionOrUserKey)
ctx.moderation.setUserRiskState(userKey, patch, operator)
ctx.moderation.recordOverride(eventId, action, operator, reason)
ctx.moderation.purgeExpiredEvidence(now)
```

All stage wrappers call the common `evaluate()` path. When
`enabled=false`, decisions are allowed and not recorded. When
`shadowMode=true`, blocking decisions are recorded but returned as `allow` so
existing behavior continues during rollout.

## Privacy Model

Defaults are privacy-first:

- `storeRawTextForAppeal=false`
- `rawTextRetentionDays=7`
- `eventRetentionDays=180`
- `redactBeforePersist=true`

The repository always stores an evidence hash. Raw text is stored only when
`storeRawTextForAppeal=true`. Redacted evidence does not preserve original
characters by default. Retention cleanup purges expired raw and redacted
evidence without deleting event rows, so review references remain valid.

Structured audit logs include stage, action, labels, severity, confidence, risk
score, hashed user key, event id, and shadow mode. They do not include raw user
input, full model output, raw evidence, or decision reasons.
