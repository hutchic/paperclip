import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";

function readSnapshotIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object" || Array.isArray(contextSnapshot)) {
    return null;
  }
  const context = contextSnapshot as Record<string, unknown>;
  for (const candidate of [context.issueId, context.taskId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export type BindHeartbeatRunOnCheckoutInput = {
  companyId: string;
  agentId: string;
  runId: string;
  issueId: string;
};

export type BindHeartbeatRunOnCheckoutResult =
  | { bound: true; reason: "unscoped" | "same_issue_fill" }
  | { bound: false; reason: "run_missing" | "different_issue" };

/**
 * After an agent checks out an issue mid-run (e.g. deferred_wake_probe_nudge /
 * unassigned scratch → POST /checkout), stamp the heartbeat run so write
 * attribution (`cross_issue_influence`, GET /heartbeat-runs/:id) sees the
 * checked-out issue as the run's source issue.
 *
 * Only binds unscoped runs, or fills missing columns/snapshot when the run is
 * already attributed to the same issue. Never steals a binding from a different
 * issue — that would weaken the cross-issue influence cap.
 */
export async function bindHeartbeatRunOnCheckout(
  db: Db,
  input: BindHeartbeatRunOnCheckoutInput,
): Promise<BindHeartbeatRunOnCheckoutResult> {
  return db.transaction(async (tx) => {
    const run = await tx
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        scopeKind: heartbeatRuns.scopeKind,
        issueId: heartbeatRuns.issueId,
        nativeIssueId: heartbeatRuns.nativeIssueId,
        runtimeMode: heartbeatRuns.runtimeMode,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.id, input.runId),
          eq(heartbeatRuns.companyId, input.companyId),
          eq(heartbeatRuns.agentId, input.agentId),
        ),
      )
      .for("update")
      .then((rows) => rows[0] ?? null);

    if (!run) return { bound: false, reason: "run_missing" };

    const snapshotIssueId = readSnapshotIssueId(run.contextSnapshot);
    const existingSource =
      snapshotIssueId ?? run.issueId ?? run.nativeIssueId ?? null;

    if (existingSource && existingSource !== input.issueId) {
      return { bound: false, reason: "different_issue" };
    }

    const reason: "unscoped" | "same_issue_fill" = existingSource
      ? "same_issue_fill"
      : "unscoped";

    const priorSnapshot =
      run.contextSnapshot &&
      typeof run.contextSnapshot === "object" &&
      !Array.isArray(run.contextSnapshot)
        ? { ...(run.contextSnapshot as Record<string, unknown>) }
        : {};

    const nextSnapshot: Record<string, unknown> = {
      ...priorSnapshot,
      issueId: input.issueId,
      taskId:
        typeof priorSnapshot.taskId === "string" && priorSnapshot.taskId.trim()
          ? priorSnapshot.taskId
          : input.issueId,
      checkoutBoundIssueId: input.issueId,
      checkoutBoundAt: new Date().toISOString(),
    };

    const patch: {
      scopeKind: "issue";
      issueId: string;
      contextSnapshot: Record<string, unknown>;
      updatedAt: Date;
      nativeIssueId?: string;
    } = {
      scopeKind: "issue",
      issueId: input.issueId,
      contextSnapshot: nextSnapshot,
      updatedAt: new Date(),
    };

    // Native runs also expose nativeIssueId on GET /heartbeat-runs/:id; fill it
    // only when still null so we do not overwrite an established native binding.
    if (run.runtimeMode === "native" && !run.nativeIssueId) {
      patch.nativeIssueId = input.issueId;
    }

    await tx
      .update(heartbeatRuns)
      .set(patch)
      .where(eq(heartbeatRuns.id, input.runId));

    return { bound: true, reason };
  });
}
