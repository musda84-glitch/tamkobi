/** Giriş: iş yeri/görev yakınında konum zorunlu. Çıkış: yalnız buton, her yerden; konum açıksa GPS eklenir. */
export function selfAttendanceGeoMode(action, opts = {}) {
  if (action === "check_in") {
    if (opts.hasTarget && opts.requireGeo !== false && opts.trackingEnabled !== false) return "required";
    return "none";
  }
  return opts.trackingEnabled ? "attach" : "none";
}
