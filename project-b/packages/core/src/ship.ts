import type { Db, ReleaseSource } from "@bldt/db";
import { recordActivity, type ActivityInput } from "./activity.ts";
import { notify } from "./notify.ts";

export interface ShipArgs {
  projectId: string;
  title: string;
  version?: string | null;
  notes?: string | null;
  url?: string | null;
  commitSha?: string | null;
  source: ReleaseSource;
  /** Source id for GitHub releases/deployments; generated for manual ships. */
  externalId?: string | null;
  createdById?: string | null;
  actorLogin?: string | null;
  shippedAt?: Date;
  /**
   * Manual ships always mark the project shipped. Integration releases do so only when the
   * project is still pre-launch (IDEA/BUILDING), so later releases do not rewrite history.
   */
  forceShip?: boolean;
  /** False for pre-releases: recorded as a release, never as the launch. */
  allowShip?: boolean;
}

export async function recordRelease(db: Db, a: ShipArgs) {
  const shippedAt = a.shippedAt ?? new Date();
  const externalId = a.externalId ?? `manual:${crypto.randomUUID()}`;

  const key = { projectId_source_externalId: { projectId: a.projectId, source: a.source, externalId } };
  try {
    return await ship(db, a, externalId, shippedAt);
  } catch (err) {
    // The same GitHub release delivered twice at once: the other copy won the unique index.
    if ((err as { code?: string }).code !== "P2002") throw err;
    const release = await db.release.findUnique({ where: key });
    if (!release) throw err;
    return { release, shipped: false };
  }
}

function ship(db: Db, a: ShipArgs, externalId: string, shippedAt: Date) {
  return db.$transaction(async (tx) => {
    const existing = await tx.release.findUnique({
      where: { projectId_source_externalId: { projectId: a.projectId, source: a.source, externalId } },
    });
    if (existing) return { release: existing, shipped: false };

    const project = await tx.project.findUniqueOrThrow({
      where: { id: a.projectId },
      select: { id: true, name: true, stage: true, shippedAt: true },
    });
    const preLaunch = project.stage === "IDEA" || project.stage === "BUILDING";
    const isShip = a.forceShip === true || (preLaunch && a.allowShip !== false);

    const release = await tx.release.create({
      data: {
        projectId: a.projectId,
        title: a.title,
        version: a.version ?? null,
        notes: a.notes ?? null,
        url: a.url ?? null,
        commitSha: a.commitSha ?? null,
        source: a.source,
        externalId,
        isShip,
        createdById: a.createdById ?? null,
        shippedAt,
      },
    });

    if (isShip) {
      await tx.project.update({
        where: { id: a.projectId },
        data: {
          stage: preLaunch || project.stage === "PAUSED" || project.stage === "SUNSET" ? "SHIPPED" : project.stage,
          shippedAt: project.shippedAt ?? shippedAt,
        },
      });
    }

    const trust = a.source === "MANUAL" ? "PLATFORM" : "CONNECTED";
    const event: ActivityInput = {
      projectId: a.projectId,
      type: isShip ? "project.shipped" : "release.published",
      source: a.source === "MANUAL" ? "BLDT" : "GITHUB",
      externalId: `release:${release.id}`,
      trust,
      actorId: a.createdById ?? null,
      actorLogin: a.actorLogin ?? null,
      occurredAt: shippedAt,
      payload: { releaseId: release.id, title: a.title, version: a.version ?? null, url: a.url ?? null },
    };
    await recordActivity(tx, event);

    if (isShip) {
      const members = await tx.projectMember.findMany({ where: { projectId: a.projectId }, select: { userId: true } });
      await notify(
        tx,
        members.map((m) => m.userId),
        "project.shipped",
        { projectId: a.projectId, projectName: project.name, title: a.title, version: a.version ?? null },
        { projectId: a.projectId, exclude: a.createdById ?? null },
      );
    }

    return { release, shipped: isShip };
  });
}
