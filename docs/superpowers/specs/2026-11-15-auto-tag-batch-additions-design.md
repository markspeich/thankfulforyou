# Automatically tag production batch additions

User approved automatic ShipStation tagging when adding orders to production. Apply it after saved membership changes from single-item addition, whole-order/bulk addition, and clipboard import targeting productionBatch. Imports targeting Orders do not tag. Locally created manual artwork without shipping identity is outside this membership API change.

Reuse authenticated server-side saved batch loading and existing full-batch tag reconciliation. Never trust browser-supplied snapshot membership for tagging. Preserve completed additions if external tagging fails and return a structured warning, not a failed-add response that encourages duplicate additions. Manual Tag Batch in ShipStation remains recovery. Completing the batch retains its existing tag cleanup behavior.

Response extension shipStationTagging has status success or warning, tagName, taggedOrders, removedTags, unmatchedOrders, failures and optional sanitized message. Success requires no unmatched/failure details. Unexpected configuration/discovery errors return warning with a fixed safe message and empty counts/details; never expose upstream content. Trigger only when the batch membership action succeeds and includes additions; duplicate/no-op additions may skip reconciliation.

Show progress mentioning ShipStation for affected add/paste operations. Include tag result/counts in completion, and clearly distinguish additions saved but tags incomplete using existing red error state and order identifiers. Keep selection/drafts and normal refresh after successful additions regardless of tagging result. Mention manual retry action and full browser refresh if a newly created tag is not visible. No migrations or live tests.

Approaches: frontend follow-up requests are simpler but can be skipped by page navigation; server-side post-add reconciliation is selected for consistent coverage. Transactionally coupling external tagging to additions would lose the honest partial-success outcome and is rejected.
