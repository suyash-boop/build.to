import { LINGUIST_TO_SLUG } from "@bldt/db";
import type { DetectedTech } from "@bldt/github";
import type { WorkerDeps } from "../context.ts";

/** Languages below this share of the codebase are noise (a stray shell script, a Makefile). */
const MIN_LANGUAGE_SHARE = 0.02;

/**
 * Rebuild derived project data from its repositories:
 * - detected technologies (languages by byte share + manifest-detected frameworks)
 * - contribution rows linked to bld.t accounts
 */
export async function recomputeProject(deps: WorkerDeps, projectId: string) {
  const { db } = deps;
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, deletedAt: true } });
  if (!project || project.deletedAt) return;

  const repos = await db.repository.findMany({
    where: { projects: { some: { projectId } } },
    select: { languages: true, detectedStack: true },
  });

  // Languages: sum bytes across repositories.
  const bytes = new Map<string, number>();
  for (const r of repos) {
    for (const [lang, n] of Object.entries((r.languages ?? {}) as Record<string, number>)) {
      bytes.set(lang, (bytes.get(lang) ?? 0) + n);
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  const detected = new Map<string, { share: number; evidence: string | null }>();
  for (const [lang, n] of bytes) {
    const slug = LINGUIST_TO_SLUG.get(lang);
    const share = total ? n / total : 0;
    if (slug && share >= MIN_LANGUAGE_SHARE) detected.set(slug, { share, evidence: "GitHub language stats" });
  }
  for (const r of repos) {
    for (const t of (r.detectedStack ?? []) as unknown as DetectedTech[]) {
      if (!detected.has(t.slug)) detected.set(t.slug, { share: 0, evidence: t.evidence });
    }
  }

  const techs = await db.technology.findMany({ where: { slug: { in: [...detected.keys()] } }, select: { id: true, slug: true } });
  const idBySlug = new Map(techs.map((t) => [t.slug, t.id]));

  await db.$transaction(async (tx) => {
    const existing = await tx.projectTechnology.findMany({ where: { projectId } });
    const keepIds = new Set<string>();
    for (const [slug, d] of detected) {
      const technologyId = idBySlug.get(slug);
      if (!technologyId) continue;
      keepIds.add(technologyId);
      const prev = existing.find((e) => e.technologyId === technologyId);
      if (prev?.source === "MANUAL") {
        // Detection confirms a manual entry: record evidence, keep the user's choice.
        await tx.projectTechnology.update({
          where: { projectId_technologyId: { projectId, technologyId } },
          data: { share: d.share, evidence: d.evidence },
        });
        continue;
      }
      await tx.projectTechnology.upsert({
        where: { projectId_technologyId: { projectId, technologyId } },
        create: { projectId, technologyId, source: "DETECTED", share: d.share, evidence: d.evidence },
        update: { share: d.share, evidence: d.evidence },
      });
    }
    // Drop detections that no longer hold; manual entries are never removed automatically.
    const stale = existing.filter((e) => e.source === "DETECTED" && !keepIds.has(e.technologyId)).map((e) => e.technologyId);
    if (stale.length) await tx.projectTechnology.deleteMany({ where: { projectId, technologyId: { in: stale } } });
  });

  await linkContributionsToUsers(deps, { projectId });
}

/** Attach contribution rows to bld.t users by their GitHub account id. */
export async function linkContributionsToUsers(deps: WorkerDeps, scope: { projectId?: string; githubUserId?: bigint }) {
  const { db } = deps;
  const rows = await db.contribution.findMany({
    where: {
      userId: null,
      githubUserId: scope.githubUserId ?? { not: null },
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
    },
    select: { id: true, githubUserId: true },
  });
  if (rows.length === 0) return;
  const accounts = await db.githubAccount.findMany({
    where: { githubUserId: { in: [...new Set(rows.map((r) => r.githubUserId!))] } },
    select: { githubUserId: true, userId: true },
  });
  const byGh = new Map(accounts.map((a) => [a.githubUserId.toString(), a.userId]));
  for (const r of rows) {
    const userId = byGh.get(r.githubUserId!.toString());
    if (userId) await db.contribution.update({ where: { id: r.id }, data: { userId } });
  }
}

export async function claimForUser(deps: WorkerDeps, userId: string, githubUserId: string) {
  const gh = BigInt(githubUserId);
  await linkContributionsToUsers(deps, { githubUserId: gh });
  const account = await deps.db.githubAccount.findUnique({ where: { userId }, select: { login: true } });
  if (account) {
    // Feed events that came from GitHub before this person joined now point at their profile.
    await deps.db.activityEvent.updateMany({
      where: { actorId: null, actorLogin: account.login, source: "GITHUB" },
      data: { actorId: userId },
    });
  }
}
