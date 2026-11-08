# Planning checklist — QA Validator

Complete **[Base — planning](../../../docs/process/sme-planning-and-review-checklists.md)** in the shared SME doc first.

Add **stable verification principles** only. If the matrix for a suite grows huge, **split** by feature area or move detailed matrices to `docs/` / test plans.

## Role-specific

- [ ] **Acceptance criteria** are traceable to a **verification approach** (automated, manual, or both)—not vague intent.
- [ ] **Depth** matches [process-gates](../../../docs/process/process-gates.md) signals when design/IA is in scope (labels, plan sections, linked design work).
- [ ] **IMPL** that adds or changes **edit UI** names how **save / cancel / dismiss** should behave (or points to IA/process-gates); QA maps those to **tests or manual steps**—not API-only checks alone.
- [ ] When **design/IA** is in scope, QA artifacts (plan + run notes) link the relevant **design system** docs: start from [`docs/DESIGN.md`](../../../docs/DESIGN.md) + [`docs/IA.md`](../../../docs/IA.md), then cite any needed `docs/design-system/*` pages and (when applicable) the checklist at [`docs/design-system/templates/review-checklist.md`](../../../docs/design-system/templates/review-checklist.md).

## Defense in depth (audience · absence · lifecycle)

- [ ] **Audience matrix** — guest/read-only vs privileged expectations are explicit; validation is planned **per audience**, not inferred from signed-in green alone.
- [ ] **Absence checks** — read-only bars include steps or automated checks that privileged activation affordances are **absent** (not only hidden text).
- [ ] **Import/sync unfinished default** — import/sync/create AC pins **draft** or **unpublished** for new rows unless promote is in the same slice.
