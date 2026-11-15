# Remove production tags on completion

User request: completing the production batch also removes its ShipStation tags. Preserve every unrelated tag and retain the reusable tag definition.

Use the existing authenticated completion API. Verify saved batch ownership before external writes, discover every shipment with the app-owned Current Production Batch tag before mutation, remove that tag, then complete the batch in the database. An already-clean tag set is successful. Include non-pending shipments. If discovery or deletion fails, expose a sanitized retryable error and leave the batch open. Partial deletions are safe to retry. If database completion cannot be confirmed after cleanup, explain that tags were removed and ask the operator to refresh and check completion status before retrying; a lost response may follow a committed transaction. Do not run against live orders during tests.

Approaches: database-first cleanup with warnings would require durable retry after losing active membership; cleanup-first keeps the existing completion retry path and is selected for the small change. There is no cross-service atomic transaction.

Update confirmation/working/success descriptions to mention tag removal and preserve existing error dialogs, local draft restoration, and keyboard behavior. Return cleanup counts with the completed snapshot for success feedback. No migration required.
