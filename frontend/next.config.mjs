/** One Next.js app: screens, server actions and the /api/extract route. No other backend (rebuild slice 5).
 * Each action carries the whole run held in the browser tab, so the action body limit is raised from 1 MB
 * to just under Vercel's 4.5 MB request limit. The e2e build uses its own folder. */
export default {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};
