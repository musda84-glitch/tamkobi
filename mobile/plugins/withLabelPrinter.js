/** Expo config plugin: yerel ağ etiket yazıcısı (ham TCP). EAS preview derlemesine girer. */
const { withInfoPlist, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const LOCAL_NETWORK =
  "Etiket yazıcısına (Xprinter vb.) yerel ağ üzerinden bağlanmak için yerel ağ erişimi gerekir.";

function withLabelPrinter(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSLocalNetworkUsageDescription =
      cfg.modResults.NSLocalNetworkUsageDescription || LOCAL_NETWORK;
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
    ]);
    return cfg;
  });
  return config;
}

module.exports = withLabelPrinter;
