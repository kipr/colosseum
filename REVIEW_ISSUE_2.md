# Queue repair race follow-up

Priority: P2

Source: `src/server/services/queueSync.ts:150-152`

## Do not clear dirty writes that race with repair

If a source mutation occurs after its queue type has already been synchronized
but before the final state read, `synced.version` includes the mutation's new
version and `clearQueueDirty` immediately clears that mutation's dirty flag.
For example, adding a team after the seeding pass leaves its queue rows absent
while the flag is cleared, so ordinary polling remains stale until the
minute-level safety repair.

Associate the compare-and-clear operation with the repair generation rather
than a version reread that may include concurrent writes.
