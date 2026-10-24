// craco.config.js
const path = require("path");
require("dotenv").config();

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

function makeDevServerV5Compatible(devServerConfig) {
  const {
    https,
    onAfterSetupMiddleware,
    onBeforeSetupMiddleware,
    onListening,
    setupMiddlewares,
    ...compatibleConfig
  } = devServerConfig;

  compatibleConfig.server =
    typeof https === "object"
      ? { type: "https", options: https }
      : https
        ? "https"
        : "http";
  compatibleConfig.headers = {
    ...compatibleConfig.headers,
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (onBeforeSetupMiddleware || setupMiddlewares) {
    compatibleConfig.setupMiddlewares = (middlewares, devServer) => {
      if (onBeforeSetupMiddleware) {
        onBeforeSetupMiddleware(devServer);
      }

      return setupMiddlewares
        ? setupMiddlewares(middlewares, devServer)
        : middlewares;
    };
  }

  compatibleConfig.onListening = (devServer) => {
    devServer.close ??= (callback) => devServer.stopCallback(callback);

    if (onListening) {
      onListening(devServer);
    }
    if (onAfterSetupMiddleware) {
      onAfterSetupMiddleware(devServer);
    }
  };

  return compatibleConfig;
}

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  // react-router-dom 7 package.json "main" points at a missing dist/main.js.
  // Jest (react-scripts) resolves "main", so real MemoryRouter imports fail unless mapped.
  jest: {
    configure: (jestConfig) => {
      jestConfig.moduleNameMapper = {
        ...(jestConfig.moduleNameMapper || {}),
        "^@/(.*)$": "<rootDir>/src/$1",
        "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
        "^react-router/dom$": "<rootDir>/node_modules/react-router/dist/development/dom-export.js",
        "^react-router$": "<rootDir>/node_modules/react-router/dist/development/index.js",
      };
      const polyfill = "<rootDir>/src/setupTests.js";
      const files = jestConfig.setupFiles || [];
      if (!files.includes(polyfill)) jestConfig.setupFiles = [polyfill, ...files];
      return jestConfig;
    },
  },
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {
      webpackConfig.ignoreWarnings = [...(webpackConfig.ignoreWarnings || []), /Failed to parse source map/];

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      // Hash'li statik dosyalar cache-first. index.html precache'e girmez; gezinme
      // NetworkFirst olur ki yeni deploy eski kabuğu "Arayüz eski" diye tutmasın.
      // Ağ yokken son başarılı HTML yanıtı kalır. API önbelleğe alınmaz.
      if (process.env.NODE_ENV === "production") {
        const { GenerateSW } = require("workbox-webpack-plugin");
        webpackConfig.plugins.push(new GenerateSW({
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          exclude: [/\.map$/, /browser-extension/, /\.txt$/, /index\.html$/],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) => request.mode === "navigate" && !String(url.pathname || "").startsWith("/api/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "tamkobi-html",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: /\/index\.html$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "tamkobi-html",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: ({ request }) => ["style", "script", "worker", "image", "font"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "tamkobi-static",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
              },
            },
          ],
        }));
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

const configureDevServer = webpackConfig.devServer;
webpackConfig.devServer = (devServerConfig) =>
  makeDevServerV5Compatible(configureDevServer(devServerConfig));

module.exports = webpackConfig;
