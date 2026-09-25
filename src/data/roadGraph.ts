/**
 * Simplified Roanoke Valley road network for the SCENARIO routing provider.
 *
 * FICTIONAL SCENARIO DATA: nodes are approximate intersections and edges are
 * straight-line abstractions of real corridors (Rte 419, US 221, Colonial Ave…).
 * It exists so the demo's reroute is computed by the same routing and
 * hazard-intersection code a live deployment uses with Azure Maps — not
 * hard-coded. Travel times are indicative only.
 */

export interface RoadNode {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface RoadEdge {
  a: string;
  b: string;
  road: string;
  /** Typical speed in km/h (includes signals). */
  speedKmh: number;
}

export const ROAD_NODES: RoadNode[] = [
  { id: "SD", label: "Salem — downtown", lat: 37.293, lng: -80.054 },
  { id: "SW", label: "Salem — West Main St", lat: 37.287, lng: -80.045 },
  { id: "AP", label: "Rte 419 @ Apperson Dr", lat: 37.279, lng: -80.033 },
  { id: "KG", label: "Rte 419 @ Keagy Rd", lat: 37.262, lng: -80.023 },
  { id: "BR", label: "Rte 419 @ Brambleton Ave", lat: 37.247, lng: -80.012 },
  { id: "CS", label: "Rte 419 @ Chaparral Dr", lat: 37.236, lng: -80.007 },
  { id: "CV", label: "Cave Spring", lat: 37.2275, lng: -80.001 },
  { id: "TW", label: "Tanglewood (Rte 419 @ US 220)", lat: 37.239, lng: -79.988 },
  { id: "CO", label: "Colonial Ave @ Cave Spring Ln", lat: 37.232, lng: -79.992 },
  { id: "BC", label: "Brambleton Ave @ Colonial Ave", lat: 37.253, lng: -79.988 },
  { id: "GB", label: "Grandin Rd @ Brandon Ave", lat: 37.261, lng: -79.983 },
  { id: "WW", label: "Roanoke Blvd @ Wildwood Rd", lat: 37.288, lng: -80.028 },
  { id: "MK", label: "Melrose Ave @ Peters Creek Rd", lat: 37.289, lng: -79.992 },
  { id: "GV", label: "Grandin Village", lat: 37.27, lng: -79.975 },
  { id: "WS", label: "Wasena — Main St", lat: 37.26, lng: -79.953 },
  { id: "DT", label: "Downtown Roanoke", lat: 37.271, lng: -79.9414 },
  { id: "FR", label: "Franklin Rd @ Wonju St", lat: 37.248, lng: -79.957 },
  { id: "SE", label: "Southeast — Jamison Ave", lat: 37.2575, lng: -79.927 },
  { id: "GC", label: "Garden City Blvd", lat: 37.236, lng: -79.924 },
  { id: "RD", label: "Riverland Rd", lat: 37.252, lng: -79.9075 },
  { id: "VN", label: "Vinton — Washington Ave", lat: 37.281, lng: -79.897 },
  { id: "WR", label: "Williamson Rd @ Orange Ave", lat: 37.29, lng: -79.942 },
  { id: "HL", label: "Hollins — Williamson Rd", lat: 37.338, lng: -79.945 },
  { id: "BK", label: "US 221 — Back Creek", lat: 37.2, lng: -80.07 },
  { id: "BM", label: "Bent Mountain", lat: 37.156, lng: -80.121 },
];

export const ROAD_EDGES: RoadEdge[] = [
  { a: "SD", b: "SW", road: "W Main St", speedKmh: 40 },
  { a: "SW", b: "AP", road: "Rte 419 (Electric Rd)", speedKmh: 56 },
  { a: "AP", b: "KG", road: "Rte 419 (Electric Rd)", speedKmh: 56 },
  { a: "KG", b: "BR", road: "Rte 419 (Electric Rd)", speedKmh: 56 },
  { a: "BR", b: "CS", road: "Rte 419 (Electric Rd)", speedKmh: 56 },
  { a: "CS", b: "CV", road: "Chaparral Dr", speedKmh: 38 },
  { a: "CS", b: "TW", road: "Rte 419 (Electric Rd)", speedKmh: 45 },
  { a: "TW", b: "CO", road: "Colonial Ave", speedKmh: 35 },
  { a: "CO", b: "CV", road: "Cave Spring Ln", speedKmh: 35 },
  { a: "BR", b: "BC", road: "Brambleton Ave (US 221)", speedKmh: 42 },
  { a: "BC", b: "GB", road: "Brandon Ave", speedKmh: 38 },
  { a: "BC", b: "CO", road: "Colonial Ave", speedKmh: 40 },
  { a: "KG", b: "GB", road: "Keagy Rd / Brandon Ave", speedKmh: 42 },
  { a: "GB", b: "GV", road: "Grandin Rd", speedKmh: 35 },
  { a: "SW", b: "WW", road: "Roanoke Blvd", speedKmh: 45 },
  { a: "SD", b: "WW", road: "Roanoke Blvd", speedKmh: 45 },
  { a: "WW", b: "MK", road: "Melrose Ave", speedKmh: 45 },
  { a: "MK", b: "WR", road: "Orange Ave", speedKmh: 48 },
  { a: "MK", b: "GB", road: "Peters Creek Rd", speedKmh: 45 },
  { a: "GV", b: "WS", road: "Main St", speedKmh: 35 },
  { a: "WS", b: "DT", road: "Jefferson St", speedKmh: 35 },
  { a: "WS", b: "FR", road: "Wonju St", speedKmh: 35 },
  { a: "DT", b: "WR", road: "Williamson Rd", speedKmh: 40 },
  { a: "DT", b: "SE", road: "Jamison Ave", speedKmh: 38 },
  { a: "SE", b: "RD", road: "Riverland Rd", speedKmh: 38 },
  { a: "FR", b: "GC", road: "Garden City Blvd", speedKmh: 38 },
  { a: "SE", b: "GC", road: "13th St / Garden City Blvd", speedKmh: 38 },
  { a: "RD", b: "GC", road: "Riverland Rd", speedKmh: 35 },
  { a: "DT", b: "VN", road: "Elm Ave / Bus. 24", speedKmh: 45 },
  { a: "VN", b: "RD", road: "Mountain View Rd", speedKmh: 38 },
  { a: "WR", b: "HL", road: "Williamson Rd (US 11)", speedKmh: 52 },
  { a: "TW", b: "FR", road: "Franklin Rd (US 220)", speedKmh: 52 },
  { a: "BR", b: "BK", road: "US 221 (Bent Mountain Rd)", speedKmh: 55 },
  { a: "BK", b: "BM", road: "US 221 (Bent Mountain Rd)", speedKmh: 50 },
];

/** Straight-line segments understate road length; applied to every edge. */
export const WINDING_FACTOR = 1.1;
/** Per-intersection delay in minutes (signals, turns). */
export const NODE_DELAY_MIN = 0.3;
/** Speed for the first/last connector from an address to the nearest network node. */
export const CONNECTOR_SPEED_KMH = 28;
