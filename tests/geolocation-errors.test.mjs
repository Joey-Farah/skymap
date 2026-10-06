import test from "node:test";
import assert from "node:assert/strict";

import { geolocationErrorCode } from "../src/geolocation-errors.ts";

test("a native location error keeps the web API's permission-denied code when it means 'off'", () => {
  // MapLibre's GeolocateControl branches on code 1 to show "location is
  // off" rather than a transient glitch, and the app's toast keys off it.
  assert.equal(geolocationErrorCode("Location permission request was denied."), 1);
  assert.equal(geolocationErrorCode("Application's use of location services was restricted."), 1);
  // @capacitor/geolocation 8.2.3 reports Location Services switched off
  // device-wide in its own words; 8.2.0 called it "denied".
  assert.equal(geolocationErrorCode("Location services are not enabled."), 1);
  assert.equal(geolocationErrorCode("There was an error trying to obtain the location."), 2);
  assert.equal(geolocationErrorCode("Could not obtain location in time. Try with a higher timeout."), 2);
});
