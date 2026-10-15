/** API calls go to the local FastAPI backend; no secrets reach the browser.
 * The rewrite target is fixed at build time, so the e2e build uses its own folder. */
const backend = process.env.ORDER_AGENT_BACKEND_URL || "http://127.0.0.1:8000";
export default {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
