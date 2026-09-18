const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const https = require("https");
const { URL } = require("url");

/**
 * Tarayıcı önizlemesi (localhost / exp.direct tüneli) ile API farklı origin'de kalıyor ve
 * sunucu bu origin'i CORS'ta kabul etmediği için giriş "Failed to fetch" ile düşüyor.
 * Dev sunucusu /api isteklerini aynı origin üzerinden ERP'ye taşır; üretim derlemesini etkilemez.
 */
const DEFAULT_UPSTREAM = (process.env.EXPO_PUBLIC_API_URL || "https://tamkobi.com").replace(/\/+$/, "");
const BASE_HEADER = "x-tamkobi-api-base";

function upstreamFor(req) {
  const asked = req.headers[BASE_HEADER];
  if (typeof asked !== "string" || !/^https?:\/\//i.test(asked)) return DEFAULT_UPSTREAM;
  return asked.replace(/\/+$/, "");
}

function proxyApi(req, res) {
  const target = new URL(req.url, upstreamFor(req));
  const client = target.protocol === "http:" ? http : https;
  const headers = { ...req.headers, host: target.host };
  delete headers.origin;
  delete headers.referer;
  delete headers["accept-encoding"];
  delete headers[BASE_HEADER];
  const upstream = client.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ detail: `API proxy hatası: ${err.message}` }));
  });
  req.pipe(upstream);
}

const config = getDefaultConfig(__dirname);
const previous = config.server && config.server.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => {
      if (req.url && req.url.startsWith("/api/")) return proxyApi(req, res);
      return base(req, res, next);
    };
  },
};

module.exports = config;
