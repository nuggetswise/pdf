/** API calls go to the local FastAPI backend; no secrets reach the browser. */
const backend = process.env.ORDER_AGENT_BACKEND_URL || "http://127.0.0.1:8000";
export default {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
