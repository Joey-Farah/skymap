/**
 * The web Geolocation error code for a native plugin error message.
 *
 * MapLibre's GeolocateControl branches on code 1 (PERMISSION_DENIED) to
 * show its "location is off" state rather than a transient error, and the
 * app's "Location is off" toast keys off the same code — so every way of
 * saying "you can't have location" has to land on 1. @capacitor/geolocation
 * 8.2.3 words Location Services switched off device-wide as "not enabled"
 * (8.2.0 called it "denied"), and a restriction (Screen Time) is the same
 * situation to the person holding the phone.
 */
export function geolocationErrorCode(message: string): 1 | 2 {
  return /denied|permission|authoriz|not enabled|restricted/i.test(message) ? 1 : 2;
}
