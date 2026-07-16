/**
 * Weather-aware framing, scoped honestly: Skymap only routes indoors, so
 * there's no outdoor path to compare against or switch to (that'd need a
 * real street/sidewalk routing engine — future scope, not faked here).
 * What's real and buildable: surface current conditions and frame the
 * indoor route's value accordingly, per the mandated spec's intent.
 */

export interface WeatherReading {
  temperatureF: number;
  weatherCode: number; // WMO code
  windKph: number;
}

export interface WeatherClassification {
  harsh: boolean;
  label: string;
}

/** WMO weather codes >= 51 are drizzle/rain/snow/thunderstorm; below that is clear/cloudy/fog. */
function isPrecipitating(code: number): boolean {
  return code >= 51;
}

export function classifyWeather(reading: WeatherReading): WeatherClassification {
  const { temperatureF, weatherCode, windKph } = reading;
  if (isPrecipitating(weatherCode)) {
    return { harsh: true, label: weatherCode >= 71 && weatherCode < 90 ? "Snowing" : "Rainy" };
  }
  if (temperatureF <= 20) return { harsh: true, label: `${Math.round(temperatureF)}°F — brutal cold` };
  if (temperatureF >= 95) return { harsh: true, label: `${Math.round(temperatureF)}°F — dangerous heat` };
  if (windKph >= 40) return { harsh: true, label: "Very windy" };
  return { harsh: false, label: `${Math.round(temperatureF)}°F and clear` };
}

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

/** Fetches current conditions from Open-Meteo (free, keyless). Returns null on any failure — never blocks the app. */
export async function fetchWeather(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<WeatherReading | null> {
  try {
    const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=kmh`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    if (!c || typeof c.temperature_2m !== "number") return null;
    return { temperatureF: c.temperature_2m, weatherCode: c.weather_code, windKph: c.wind_speed_10m };
  } catch {
    return null;
  }
}
