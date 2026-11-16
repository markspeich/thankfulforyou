# Synchronize ShipStation tags after batch removal

User requested removing corresponding ShipStation tags when items are removed from production, explicitly including the trash-can action. Retain Current Production Batch when any other item from that whole order remains. Preserve unrelated tags and the reusable tag definition.

Reconcile the saved authenticated batch after successful membership removal, covering remove-item (trash), selected remove/skip/complete, and Orders skip paths that remove active membership. Reuse existing reconciliation so remaining orders retain their tags. An empty saved batch clears the app-owned tag from all shipments carrying it. Discovery completes before writes.

Membership removal remains committed if tag synchronization fails. Return shipStationTagging with success/warning counts and sanitized details, display red partial-success feedback, and preserve remaining drafts/selection. Do not return a failed-removal error after a successful DB mutation. Failed database mutations must not call ShipStation.

Keep the manual Tag Batch in ShipStation action as recovery even for an empty authenticated batch; empty retries clear stale app-owned tags and never create labels. Clearly describe empty results and no packing slips. Missing/invalid batch snapshots are errors, not permission to clear tags. Existing whole-batch completion cleanup behavior remains unchanged.

Use the established progress/result/error dialogs for trash and selected removals, mention tag updates, prevent duplicate submissions, and restore useful focus. Orders skip feedback must also show synchronization results.

Approaches: cleanup before mutation risks removing tags for orders still in the batch if DB mutation fails; saved-state reconciliation after mutation is selected, matching automatic additions. No migration/outbox or live test mutation is needed.
