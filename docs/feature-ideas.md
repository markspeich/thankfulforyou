# Feature Ideas

Use this document to capture future ideas before they become committed requirements.

## How To Use This File

- Add new ideas here first when they are still exploratory, optional, or not yet prioritized.
- Promote only decided requirements into `docs/requirements.md`.
- Keep each idea focused on one feature or workflow improvement.
- Capture the production reason for the idea so future implementation stays grounded in the shop workflow.

## Template

```md
## Idea: <short name>

Status: idea
Why it matters: <production value or workflow pain>
Summary: <one-paragraph description>
Constraints:
- <constraint>
Open questions:
- <question>
```

## Idea: Per-Design Export Notes

Status: captured
Why it matters: lets the operator carry a LightBurn reminder with the exported design when the app does not yet support a needed shape or finishing step
Summary: add a notes field to each design. Any entered note should be exported with that design as a small Arial text annotation so the operator can see an extra manual step in LightBurn, such as adding a shape that is not available in the app.
Constraints:
- Notes belong to a single design, not the whole batch.
- The note is for operator reference and should not affect geometry analysis, connectedness checks, or cut-path generation.
- Export should render the note in a small Arial font so it is easy to distinguish from production design text.
Open questions:
- Should the note appear in both single-design export and batch export, or only when text is present in the note field?
- Where should the exported note be positioned relative to the face, backing, and color label objects?
