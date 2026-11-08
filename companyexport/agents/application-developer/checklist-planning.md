# Planning checklist — Application Developer

Complete **[Base — planning](../../../docs/process/sme-planning-and-review-checklists.md)** in the shared SME doc first.

Keep bullets **short and reusable**. If a planning topic needs a long playbook, **link** to `docs/` instead of pasting here.

## Role-specific

- [ ] **App-layer** scope and **contracts** with adjacent layers (API, UI, DB boundaries) are explicit.
- [ ] **Ownership** stays clear: no **DDL/schema** work in this lane—route to Database Engineer via Lead Developer when needed.
- [ ] Deliverables are **sized** for review: split when a single PR would mix unrelated behavior or hide risk.

## Defense in depth (audience · absence · lifecycle)

- [ ] **Audience matrix** — UI and API behavior for guest/read-only vs privileged sessions matches PRD rows.
- [ ] **Absence checks** — read-only surfaces omit activation affordances (links, routes, submit) rather than only hiding labels.
- [ ] **Import/sync unfinished default** — create/import/sync paths set **draft** or **unpublished** until promote is in scope and tested.
