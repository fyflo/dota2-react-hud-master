import { apiUrl } from "./api";

type DirectCameraInfo = {
  vdoUrl: string;
  view: string;
  relayRunning: boolean;
  status: string;
  success: boolean;
  enabled: boolean;
  provider: string;
};

// Camera provider that means "pure peer-to-peer vdo.ninja iframe, no local
// MediaMTX relay". In this mode there is nothing to "start", so
// the HUD must render the iframe immediately instead of waiting for the relay.
const DIRECT_VDO_PROVIDER = "vdo";

const BOOLEAN_TRUE_VALUES = ["true", "1", "yes", "on", "enabled"];
const BOOLEAN_FALSE_VALUES = ["false", "0", "no", "off", "disabled", ""];
const DIRECT_CAMERA_FLAGS = ["cleanoutput", "transparent", "noaudio", "autoplay", "muted", "obsfix"];
const VDO_NINJA_ALPHA_URL = "https://vdo.ninja/alpha/";
const DIRECT_CAMERA_SCALE = "100";
const DIRECT_CAMERA_CODEC = "h264";
// Camera API endpoint override via URL query: ?cameraApi=http://localhost:3005 (or ?bindApi=...).
// CRA (react-scripts) has no import.meta.env, so we resolve the relay endpoint from the
// query string and fall back to the HUD API when not provided.
const _cameraQuery = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const _cameraOverride = String(_cameraQuery.get("cameraApi") || _cameraQuery.get("bindApi") || "").trim();
const directCameraApiUrl = (_cameraOverride || apiUrl).replace(/\/$/, "") + "/";

function parseBooleanish(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
    if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
  }
  return fallback;
}

function buildViewUrl(view: string): string {
  const normalized = String(view || "").trim();
  if (!normalized) return "";
  const params = new URLSearchParams({
    view: normalized,
    cleanoutput: "",
    transparent: "",
    noaudio: "",
    autoplay: "",
    muted: "",
    scale: DIRECT_CAMERA_SCALE,
    obsfix: "",
    codec: DIRECT_CAMERA_CODEC,
  });
  return `${VDO_NINJA_ALPHA_URL}?${params.toString()}`;
}

function normalizeDirectCameraUrl(url: string, view: string): string {
  const fallbackUrl = buildViewUrl(view);
  const normalizedUrl = String(url || "").trim() || fallbackUrl;
  if (!normalizedUrl) return "";

  try {
    const parsed = new URL(normalizedUrl);

    if (/^(?:.+\.)?vdo\.ninja$/i.test(parsed.hostname) && (!parsed.pathname || parsed.pathname === "/")) {
      parsed.pathname = "/alpha/";
    }

    if (view && !parsed.searchParams.get("view")) parsed.searchParams.set("view", view);
    if (!parsed.searchParams.has("scale")) parsed.searchParams.set("scale", DIRECT_CAMERA_SCALE);
    if (!parsed.searchParams.has("codec")) parsed.searchParams.set("codec", DIRECT_CAMERA_CODEC);

    for (const flag of DIRECT_CAMERA_FLAGS) {
      if (!parsed.searchParams.has(flag)) parsed.searchParams.set(flag, "");
    }

    return parsed.toString();
  } catch {
    return fallbackUrl;
  }
}

function hasConfiguredCameraSource(vdoUrl: string, view: string): boolean {
  return Boolean(String(vdoUrl || "").trim() || String(view || "").trim());
}

export function resolveDirectCameraUrl(steamid: string): Promise<DirectCameraInfo> {
  const key = String(steamid || "").trim();
  if (!key) return Promise.resolve({ vdoUrl: "", view: "", relayRunning: false, status: "", success: false, enabled: false, provider: "" });

  return fetch(`${directCameraApiUrl}api/steamid/${encodeURIComponent(key)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      const relayRunning = parseBooleanish(json?.relayRunning, false);
      const success = parseBooleanish(json?.success, false);
      const status = String(json?.status || "").trim().toLowerCase();
      const view = String(json?.view || "").trim();
      const rawVdoUrl = String(json?.vdoUrl || "").trim();
      const provider = String(json?.provider || "").trim().toLowerCase();
      const configuredDirectSource = hasConfiguredCameraSource(rawVdoUrl, view);
      const enabled = parseBooleanish(json?.enabled, configuredDirectSource);
      // Provider "vdo" (direct iframe): no local MediaMTX relay to
      // start, so the iframe mounts immediately and is NOT gated on relayRunning.
      const isDirectVdoProvider = provider === DIRECT_VDO_PROVIDER;
      // Stop relay = master kill switch: hide the camera when the relay is off,
      // EXCEPT in pure "vdo" mode where there is no relay at all.
      const relayGateOpen = isDirectVdoProvider || relayRunning;
      const shouldUseCamera = success && relayGateOpen && enabled && configuredDirectSource;

      return {
        vdoUrl: shouldUseCamera ? normalizeDirectCameraUrl(rawVdoUrl, view) : "",
        view,
        relayRunning,
        status,
        success,
        enabled: shouldUseCamera,
        provider,
      };
    })
    .catch(() => ({ vdoUrl: "", view: "", relayRunning: false, status: "", success: false, enabled: false, provider: "" }));
}
