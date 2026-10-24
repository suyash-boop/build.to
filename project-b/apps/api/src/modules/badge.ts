import { STAGE_LABEL } from "@bldt/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const STAGE_COLOR: Record<string, string> = {
  IDEA: "#6b7280",
  BUILDING: "#2f7de1",
  SHIPPED: "#1f9d55",
  MAINTAINED: "#0f8a8a",
  PAUSED: "#b7791f",
  SUNSET: "#6b7280",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Approximate text width for 11px Verdana-like badge text. Good enough for layout. */
const textWidth = (s: string) => Math.ceil(s.length * 6.5 + 10);

/** README badge: shows a public project's current stage, linking back to bld.t. */
export const badgeRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get(
    "/badge/:owner/:slug",
    { schema: { params: z.object({ owner: z.string().max(39), slug: z.string().max(80) }) } },
    async (req, reply) => {
      const slug = req.params.slug.replace(/\.svg$/, "").toLowerCase();
      const project = await db.project.findFirst({
        where: { slug, deletedAt: null, visibility: "PUBLIC", owner: { username: req.params.owner.toLowerCase() } },
        select: { stage: true },
      });
      const label = "bld.t";
      const value = project ? STAGE_LABEL[project.stage].toLowerCase() : "not found";
      const color = project ? STAGE_COLOR[project.stage]! : "#9ca3af";
      const lw = textWidth(label);
      const vw = textWidth(value);
      const w = lw + vw;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#24292f"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`;
      return reply
        .header("content-type", "image/svg+xml; charset=utf-8")
        .header("cache-control", "public, max-age=300, s-maxage=300")
        // Meant to be embedded in READMEs and sites anywhere, unlike the rest of the API.
        .header("cross-origin-resource-policy", "cross-origin")
        .send(svg);
    },
  );
};
