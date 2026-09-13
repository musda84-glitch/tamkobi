const { createProxyMiddleware } = require("http-proxy-middleware");

/**
 * Local CRA (e.g. :3010) has no nginx — proxy /api to the FastAPI backend.
 * Production nginx already routes /api same-origin.
 */
module.exports = function setupProxy(app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: process.env.REACT_APP_PROXY_TARGET || "http://127.0.0.1:8000",
      changeOrigin: true,
      // Preserve cookies for auth session
      cookieDomainRewrite: "",
    })
  );
};
