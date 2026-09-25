import type { GeoPoint } from "@/domain/types";

/**
 * Offline gazetteer for the Roanoke / New River Valley demo area. Used when
 * Azure Maps is not configured, and as a fast path for known place names.
 * Coordinates are neighborhood centroids — CoORDINATE stores approximate
 * locations only.
 */
export interface Place {
  name: string;
  locality: string;
  point: GeoPoint;
  aliases: string[];
}

export const PLACES: Place[] = [
  { name: "Downtown Roanoke", locality: "Roanoke", point: { lat: 37.2710, lng: -79.9414 }, aliases: ["roanoke", "downtown", "24011", "24016", "star city"] },
  { name: "Wasena, Roanoke", locality: "Roanoke", point: { lat: 37.2600, lng: -79.9530 }, aliases: ["wasena"] },
  { name: "Grandin Village, Roanoke", locality: "Roanoke", point: { lat: 37.2702, lng: -79.9745 }, aliases: ["grandin", "24015"] },
  { name: "Raleigh Court, Roanoke", locality: "Roanoke", point: { lat: 37.2640, lng: -79.9760 }, aliases: ["raleigh court"] },
  { name: "Garden City, Roanoke", locality: "Roanoke", point: { lat: 37.2360, lng: -79.9240 }, aliases: ["garden city", "24014"] },
  { name: "Riverdale, Roanoke", locality: "Roanoke", point: { lat: 37.2520, lng: -79.9075 }, aliases: ["riverdale", "riverland"] },
  { name: "Southeast Roanoke", locality: "Roanoke", point: { lat: 37.2575, lng: -79.9270 }, aliases: ["southeast", "se roanoke"] },
  { name: "Williamson Road, Roanoke", locality: "Roanoke", point: { lat: 37.3000, lng: -79.9460 }, aliases: ["williamson", "24012"] },
  { name: "Hollins, Roanoke County", locality: "Roanoke County", point: { lat: 37.3410, lng: -79.9431 }, aliases: ["hollins", "24019"] },
  { name: "Cave Spring, Roanoke County", locality: "Roanoke County", point: { lat: 37.2275, lng: -80.0010 }, aliases: ["cave spring", "24018", "tanglewood"] },
  { name: "Bent Mountain, Roanoke County", locality: "Roanoke County", point: { lat: 37.1560, lng: -80.1210 }, aliases: ["bent mountain", "24059"] },
  { name: "Vinton", locality: "Vinton", point: { lat: 37.2810, lng: -79.8970 }, aliases: ["vinton", "24179"] },
  { name: "Salem", locality: "Salem", point: { lat: 37.2935, lng: -80.0548 }, aliases: ["salem", "24153"] },
  { name: "Tinker Creek, Roanoke", locality: "Roanoke", point: { lat: 37.2905, lng: -79.9250 }, aliases: ["tinker creek", "tinker"] },
  { name: "Daleville, Botetourt County", locality: "Botetourt County", point: { lat: 37.4110, lng: -79.9120 }, aliases: ["daleville", "botetourt", "24083"] },
  { name: "Blacksburg", locality: "Blacksburg", point: { lat: 37.2296, lng: -80.4139 }, aliases: ["blacksburg", "virginia tech", "24060"] },
  { name: "Christiansburg", locality: "Christiansburg", point: { lat: 37.1299, lng: -80.4089 }, aliases: ["christiansburg", "24073"] },
  { name: "Radford", locality: "Radford", point: { lat: 37.1318, lng: -80.5764 }, aliases: ["radford", "24141"] },
  { name: "Bedford", locality: "Bedford", point: { lat: 37.3343, lng: -79.5231 }, aliases: ["bedford", "24523"] },
];

export const DEFAULT_CENTER: GeoPoint = { lat: 37.2710, lng: -79.9414 };

export function lookupPlace(text: string): Place | undefined {
  const q = text.toLowerCase();
  let best: { place: Place; len: number } | undefined;
  for (const place of PLACES) {
    for (const alias of [place.name.toLowerCase(), ...place.aliases]) {
      if (q.includes(alias) && (!best || alias.length > best.len)) best = { place, len: alias.length };
    }
  }
  return best?.place;
}

/** Nearest known locality name for a coordinate (used to label geocoded or GPS points). */
export function nearestLocality(p: GeoPoint): Place {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const place of PLACES) {
    const d = (place.point.lat - p.lat) ** 2 + ((place.point.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = place;
    }
  }
  return best;
}
