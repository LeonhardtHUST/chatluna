# Moderation Operations

## Admin Commands

The moderation service registers admin commands:

```text
moderation.status [user]
moderation.case <eventId>
moderation.user <user> --watch --restrict --suspend --restore
moderation.score <user> <value>
moderation.policy.test <text>
moderation.retention.run
moderation.shadow on|off
moderation.override <eventId> <action>
```

Commands require admin authority. Case output hides raw evidence by default.
Manual user state changes and overrides create review or audit rows.

## Event Retention

Current retention behavior removes expired evidence fields:

- `rawText`
- `redactedText`
- `expireAt`

It intentionally keeps event rows so review and override references remain
valid. `eventRetentionDays` is reserved for future admin or ops event-row
retention. Future event deletion must protect rows referenced by
`chatluna_moderation_review`.

Run cleanup with:

```text
moderation.retention.run
```

## Raw Evidence Policy

Default:

```ts
storeRawTextForAppeal: false
```

With the default, raw user input and full model output are not persisted. The
repository enforces this even if callers pass raw text. Evidence hashes remain
available for repeat-content correlation.

Only enable raw evidence for appeal workflows that require it. If enabled,
`rawTextRetentionDays` controls expiration and retention cleanup purges expired
raw evidence.

## Appeal And Restore Workflow

Recommended workflow:

1. Use `moderation.status <user>` to inspect state and recent event ids.
2. Use `moderation.case <eventId>` to inspect event metadata.
3. Use `moderation.override <eventId> <action>` to record a manual decision.
4. Use `moderation.user <user> --restore` to restore a user to normal state.
5. Use `moderation.score <user> <value>` only when a precise score adjustment
   is needed.

Raw evidence should not be shown during ordinary case review. If raw appeal
evidence is enabled, expose it only to explicitly authorized admins.

## Recommended Rollout Path

1. Deploy with `shadowMode=true`.
2. Monitor structured audit logs for false positives.
3. Keep legacy safety settings active during migration.
4. Enable enforce mode for output first if that is the lowest-risk path.
5. Enable input and pre-search enforcement after reviewing shadow mismatches.
6. Keep `storeRawTextForAppeal=false` unless an appeal process explicitly
   requires raw text.
