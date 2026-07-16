/**
 * Normalizes a device-orientation reading into a 0-360 compass heading
 * (degrees clockwise from north), the only part of "rotate the map to
 * match the phone's heading" that's pure logic worth unit-testing — the
 * event wiring itself needs a real device.
 *
 * iOS Safari exposes `webkitCompassHeading` directly (already north-
 * relative). Everything else exposes `alpha` from a 'deviceorientationabsolute'
 * event, which increases counter-clockwise from the device's initial
 * orientation — flipping it approximates compass heading.
 */
export function headingFromOrientation(event: {
  webkitCompassHeading?: number;
  alpha?: number | null;
}): number | null {
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  if (typeof event.alpha === "number" && !Number.isNaN(event.alpha)) {
    return (360 - event.alpha) % 360;
  }
  return null;
}
