import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

/** Two permission prompts, one of them cryptic.
 *
 * On iOS the app is served from `capacitor://localhost`, so WKWebView asks
 * for location on behalf of that *origin* — "localhost would like to use
 * your current location" — and iOS separately asks on behalf of the *app*,
 * using our NSLocationWhenInUseUsageDescription wording. A new user gets
 * both, and the first one names a host that means nothing to them.
 *
 * Routing location through the native plugin means the web layer never
 * calls `navigator.geolocation`, so WKWebView has no origin request to
 * prompt for and only iOS's own properly-worded prompt is shown.
 *
 * This is a no-op in the browser and the PWA, where the standard API is
 * the right one and there's only ever one prompt anyway.
 */
export function installNativeGeolocation(): void {
  if (!Capacitor.isNativePlatform()) return;
  if (typeof navigator === "undefined") return;

  let nextWatchId = 1;
  // The web API hands out numeric watch ids synchronously; the plugin
  // resolves a string id asynchronously. Bridge the two so a clearWatch()
  // that lands before the watch has even started still cancels it.
  const watches = new Map<number, Promise<string>>();

  const toPosition = (p: {
    timestamp: number;
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude?: number | null;
      altitudeAccuracy?: number | null;
      heading?: number | null;
      speed?: number | null;
    };
  }): GeolocationPosition =>
    ({
      timestamp: p.timestamp,
      coords: {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude ?? null,
        altitudeAccuracy: p.coords.altitudeAccuracy ?? null,
        heading: p.coords.heading ?? null,
        speed: p.coords.speed ?? null,
      },
    }) as GeolocationPosition;

  // MapLibre's GeolocateControl branches on code === 1 to show its
  // "permission denied" state rather than a transient error, so a denial
  // has to keep that code rather than collapsing to a generic failure.
  const toError = (e: unknown): GeolocationPositionError => {
    const message = e instanceof Error ? e.message : String(e);
    const denied = /denied|permission|authoriz/i.test(message);
    return {
      code: denied ? 1 : 2,
      message,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
  };

  const toOptions = (o?: PositionOptions) => ({
    enableHighAccuracy: o?.enableHighAccuracy ?? false,
    timeout: o?.timeout,
    maximumAge: o?.maximumAge,
  });

  const shim: Geolocation = {
    getCurrentPosition(success, error, options) {
      Geolocation.getCurrentPosition(toOptions(options))
        .then((p) => success(toPosition(p)))
        .catch((e) => error?.(toError(e)));
    },
    watchPosition(success, error, options) {
      const id = nextWatchId++;
      watches.set(
        id,
        Geolocation.watchPosition(toOptions(options), (p, err) => {
          if (err) {
            error?.(toError(err));
            return;
          }
          if (p) success(toPosition(p));
        }),
      );
      return id;
    },
    clearWatch(id) {
      const pending = watches.get(id);
      if (!pending) return;
      watches.delete(id);
      pending.then((watchId) => Geolocation.clearWatch({ id: watchId })).catch(() => {});
    },
  };

  // navigator.geolocation is a getter-only property, so plain assignment
  // silently does nothing — it has to be redefined.
  Object.defineProperty(navigator, "geolocation", { value: shim, configurable: true });
}
