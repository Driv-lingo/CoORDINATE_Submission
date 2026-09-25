import { config } from "@/config";
import { recordFailure, recordSuccess } from "@/providers/serviceHealth";
import type { GeoPoint } from "@/domain/types";
import { DEFAULT_CENTER, lookupPlace, nearestLocality } from "./gazetteer";

export interface GeocodeResult {
  point: GeoPoint;
  locality: string;
  label: string;
  provider: "azure-maps" | "gazetteer" | "device";
}

/** Virginia bounding box (lon/lat) used to bias Azure Maps results. */
const VA_BBOX = "-83.68,36.54,-75.24,39.47";

/**
 * Resolve an approximate location. Order:
 *  1. device coordinates (resident tapped "use my location")
 *  2. offline gazetteer hit for known neighborhoods (fast, deterministic)
 *  3. Azure Maps Geocoding API (when configured)
 *  4. operation default centre
 */
export async function geocode(text: string, device?: GeoPoint, opts: { preferService?: boolean } = {}): Promise<GeocodeResult> {
  if (device) {
    const near = nearestLocality(device);
    return { point: device, locality: near.locality, label: `Near ${near.name}`, provider: "device" };
  }
  // Live operation: real addresses go to Azure Maps first; the local gazetteer is the fallback.
  const place = lookupPlace(text);
  if (place && !(opts.preferService && config().maps && !isPlaceNameOnly(text, place.name))) {
    return { point: place.point, locality: place.locality, label: place.name, provider: "gazetteer" };
  }

  const maps = config().maps;
  if (maps) {
    try {
      const q = /\b(?:va|virginia)\b/i.test(text) ? text : `${text}, Virginia`;
      const url = `https://atlas.microsoft.com/geocode?api-version=2025-01-01&top=1&bbox=${VA_BBOX}&query=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { "subscription-key": maps.key }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!res.ok) recordFailure("azure-maps", new Error(`Geocoding HTTP ${res.status}`));
      if (res.ok) {
        recordSuccess("azure-maps");
        const data = (await res.json()) as {
          features?: { geometry?: { coordinates?: [number, number] }; properties?: { address?: { formattedAddress?: string; locality?: string } } }[];
        };
        const f = data.features?.[0];
        const coords = f?.geometry?.coordinates;
        if (coords) {
          const point = { lat: coords[1], lng: coords[0] };
          const near = nearestLocality(point);
          return {
            point,
            locality: f?.properties?.address?.locality ?? near.locality,
            label: f?.properties?.address?.formattedAddress ?? text,
            provider: "azure-maps",
          };
        }
      }
    } catch (err) {
      recordFailure("azure-maps", err);
      // fall through to default
    }
  }
  if (place) return { point: place.point, locality: place.locality, label: place.name, provider: "gazetteer" };
  return { point: DEFAULT_CENTER, locality: "Roanoke", label: `${text} (approximate — Roanoke)`, provider: "gazetteer" };
}

/** The text is just the place name (e.g. "Blacksburg"), not a street address containing it. */
function isPlaceNameOnly(text: string, name: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(va|virginia)\b/g, "").trim();
  return norm(text) === norm(name);
}
