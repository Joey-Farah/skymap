import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { geolocationErrorCode, isNativeTimeout } from "./geolocation-errors.ts";

/**
 * The position options every watch and fix request gets, whatever the
 * caller passes. MapLibre's GeolocateControl reads these too (map.ts).
 *
 * MapLibre keeps a module-level count of live watches and gives any
 * "second" watch {maximumAge: 600000, timeout: 0} with no high accuracy.
 * Its denial path never releases its count, so after a denial and a later
 * grant every restart was a second watch: 3 km accuracy and, on iOS, a
 * zero timeout that the plugin turns into an immediate, endless timeout.
 */
export const POSITION_OPTIONS = { enableHighAccuracy: true, maximumAge: 120000, timeout: 15000 } as const;

/**
 * Puts the app's own Geolocation in place of navigator.geolocation: the
 * native plugin behind it on iOS, and POSITION_OPTIONS on every request.
 *
 * Why the plugin on iOS — two permission prompts, one of them cryptic. The
 * app is served from `capacitor://localhost`, so WKWebView asks for
 * location on behalf of that *origin* — "localhost would like to use your
 * current location" — and iOS separately asks on behalf of the *app*, using
 * our NSLocationWhenInUseUsageDescription wording. Routing location through
 * the plugin means the web layer never calls the WebKit API, so only iOS's
 * own properly-worded prompt is shown. In the browser the standard API is
 * the right one, but it gets the pinned options all the same.
 */
export function installGeolocation(): void {
  if (typeof navigator === "undefined") return;
  const base = Capacitor.isNativePlatform() ? nativeGeolocationShim(Geolocation) : navigator.geolocation;
  if (!base) return;
  // navigator.geolocation is a getter-only property, so plain assignment
  // silently does nothing — it has to be redefined.
  Object.defineProperty(navigator, "geolocation", { value: withPositionOptions(base), configurable: true });
}

/** `geo`, with POSITION_OPTIONS in place of whatever each caller passes.
 *
 * A timeout is also reported as a lost fix (code 2). The same leaked
 * MapLibre state that set a second watch's options (see POSITION_OPTIONS)
 * makes it drop every code-3 error after a re-grant, so the control sat
 * "searching" and the app never heard the fix was missing. Both codes mean
 * the same thing here, and the native bridge already reports 2. */
export function withPositionOptions(geo: Geolocation): Geolocation {
  const asLostFix = (error?: PositionErrorCallback | null): PositionErrorCallback | undefined =>
    error
      ? (e) =>
          error(
            e.code === 3
              ? ({ code: 2, message: e.message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
              : e,
          )
      : undefined;
  return {
    getCurrentPosition: (success, error) => geo.getCurrentPosition(success, asLostFix(error), POSITION_OPTIONS),
    watchPosition: (success, error) => geo.watchPosition(success, asLostFix(error), POSITION_OPTIONS),
    clearWatch: (id) => geo.clearWatch(id),
  };
}

/**
 * Whether location is allowed right now, without ever prompting.
 *
 * A denial disables MapLibre's locate control for the life of the page, and
 * iOS doesn't restart an app when access is later granted in Settings — so
 * the app asks this again each time it comes back to the foreground.
 */
export async function locationPermission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const state = Capacitor.isNativePlatform()
      ? (await Geolocation.checkPermissions()).location
      : (await navigator.permissions?.query({ name: "geolocation" }))?.state;
    return state === "granted" || state === "denied" ? state : "prompt";
  } catch {
    return "prompt";
  }
}

type GeolocationPlugin = Pick<typeof Geolocation, "getCurrentPosition" | "watchPosition" | "clearWatch">;

/**
 * The web Geolocation API, served by the native plugin. Exported apart from
 * installGeolocation so it can be tested against a fake plugin.
 */
export function nativeGeolocationShim(plugin: GeolocationPlugin): Geolocation {
  let nextWatchId = 1;
  // The web API hands out numeric watch ids synchronously; the plugin
  // resolves a string id asynchronously. Bridge the two so a clearWatch()
  // that lands before the watch has even started still cancels it. The
  // value is whichever native watch currently serves that id — see below.
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

  // A denial has to keep code 1 rather than collapse to a generic
  // failure — see geolocationErrorCode.
  const toError = (e: unknown): GeolocationPositionError => {
    const message = (e as { message?: unknown } | null)?.message;
    const text = typeof message === "string" ? message : String(e);
    return {
      code: geolocationErrorCode(text),
      message: text,
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

  return {
    getCurrentPosition(success, error, options) {
      plugin
        .getCurrentPosition(toOptions(options))
        .then((p) => success(toPosition(p)))
        .catch((e) => error?.(toError(e)));
    },
    watchPosition(success, error, options) {
      const id = nextWatchId++;
      const start = (): Promise<string> => {
        const native: Promise<string> = plugin.watchPosition(toOptions(options), (p, err) => {
          if (err) {
            const e = toError(err);
            error?.(e);
            // The plugin stops a watch for good when its first fix takes
            // longer than the timeout: it stops updating and ignores any fix
            // after. Opening the app deep indoors left GPS dead until a
            // relaunch, while MapLibre — written against the web API, where
            // a watch outlives a timeout — waited for fixes that never came.
            // A fresh native watch takes over behind the same id, unless this
            // one has since been replaced or cleared.
            // Never on a zero timeout, which would only time out again at
            // once: POSITION_OPTIONS rules that out, but a loop is too
            // costly a failure to rest on one guard.
            if (isNativeTimeout(e.message) && (options?.timeout ?? 0) > 0 && watches.get(id) === native) {
              watches.set(id, start());
              native.then((old) => plugin.clearWatch({ id: old })).catch(() => {});
            }
            return;
          }
          if (p) success(toPosition(p));
        });
        return native;
      };
      watches.set(id, start());
      return id;
    },
    clearWatch(id) {
      const pending = watches.get(id);
      if (!pending) return;
      watches.delete(id);
      pending.then((watchId) => plugin.clearWatch({ id: watchId })).catch(() => {});
    },
  };
}
