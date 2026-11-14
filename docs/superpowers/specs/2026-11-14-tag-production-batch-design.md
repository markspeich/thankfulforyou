# Tag production batch in ShipStation

User selected a manual Tag Batch in ShipStation action and approved whole-order packing slips. Place it in the production batch ellipsis menu under Batch Output. Reconcile the app-owned `Current Production Batch` tag with the saved current batch, deduplicating orders and preserving unrelated tags. Match imported ShipStation shipment IDs where available and exact marketplace order numbers otherwise; ambiguous or missing matches must be reported, never guessed. Include all current items regardless of selection or design readiness.

Alternatives considered: automatic tag synchronization (more lifecycle coupling), copyable order list (manual work), and the selected manual sync button (explicit and convenient for printing).

Use authenticated server-side saved membership, existing ShipStation V2 credentials and client, and existing operation dialogs. Show working state immediately, prevent duplicate submission, preserve unsaved edits, report partial failures and unmatched order numbers, restore menu focus, and tell the operator to filter the tag and print packing slips. Do not create labels or mark orders shipped. No database migration required.
