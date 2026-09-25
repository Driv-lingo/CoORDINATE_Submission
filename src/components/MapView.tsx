"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Geometry, Position } from "@/domain/ops";
import type { GeoPoint } from "@/domain/types";

export interface MapMarker {
  id: string;
  position: GeoPoint;
  kind: "incident" | "person" | "org" | "target" | "camera";
  color: string;
  label: string;
  glyph?: string;
  selected?: boolean;
  dim?: boolean;
  pulse?: boolean;
  /** Hollow marker (e.g. rejected candidate). */
  hollow?: boolean;
}

export interface MapLine {
  id: string;
  from: GeoPoint;
  to: GeoPoint;
  color: string;
  dashed?: boolean;
}

/** GeoJSON-shaped overlay: hazard areas, road conditions, planned routes. */
export interface MapShape {
  id: string;
  geometry: Geometry;
  color: string;
  label: string;
  dashed?: boolean;
  weight?: number;
  fillOpacity?: number;
  /** Draw a point as a circle of this radius (metres). */
  radiusM?: number;
  onClick?: () => void;
}

export interface MapViewProps {
  markers: MapMarker[];
  lines?: MapLine[];
  shapes?: MapShape[];
  provider: "azure-maps" | "openstreetmap";
  center?: GeoPoint;
  zoom?: number;
  fit?: boolean;
  fitKey?: string;
  onSelect?: (id: string) => void;
  className?: string;
  ariaLabel: string;
}

const ll = (p: Position): [number, number] => [p[1], p[0]];

function ShapeLayer({ s }: { s: MapShape }) {
  const style = { color: s.color, weight: s.weight ?? 2, opacity: 0.9, fillColor: s.color, fillOpacity: s.fillOpacity ?? 0.15, dashArray: s.dashed ? "6 6" : undefined };
  const events = s.onClick ? { click: s.onClick } : undefined;
  const tip = (
    <Tooltip className="coord-tip" sticky>
      {s.label}
    </Tooltip>
  );
  const g = s.geometry;
  if (g.type === "Polygon")
    return (
      <Polygon positions={g.coordinates.map((ring) => ring.map(ll))} pathOptions={style} eventHandlers={events}>
        {tip}
      </Polygon>
    );
  if (g.type === "MultiPolygon")
    return (
      <Polygon positions={g.coordinates.map((poly) => poly.map((ring) => ring.map(ll)))} pathOptions={style} eventHandlers={events}>
        {tip}
      </Polygon>
    );
  if (g.type === "LineString")
    return (
      <Polyline positions={g.coordinates.map(ll)} pathOptions={{ ...style, fill: false, weight: s.weight ?? 4 }} eventHandlers={events}>
        {tip}
      </Polyline>
    );
  return (
    <Circle center={ll(g.coordinates)} radius={s.radiusM ?? 80} pathOptions={style} eventHandlers={events}>
      {tip}
    </Circle>
  );
}

function iconFor(m: MapMarker): L.DivIcon {
  const opacity = m.dim ? 0.35 : 1;
  if (m.kind === "camera") {
    const html = `<svg width="22" height="22" viewBox="0 0 24 24" style="opacity:${opacity};filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="${m.color}" stroke="#fff" stroke-width="2"/>
      <path d="M6 9h8v7H6z M14 11l4-2v7l-4-2z" fill="#fff"/>
      ${m.selected ? '<rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="none" stroke="#f5b400" stroke-width="2"/>' : ""}
    </svg>`;
    return L.divIcon({ html, className: "coord-marker", iconSize: [22, 22], iconAnchor: [11, 11], tooltipAnchor: [0, -11] });
  }
  if (m.kind === "incident" || m.kind === "target") {
    const size = m.kind === "target" ? 38 : m.selected ? 34 : 28;
    const ring = m.selected || m.kind === "target" ? `<circle cx="16" cy="15" r="14" fill="none" stroke="#f5b400" stroke-width="3"/>` : "";
    const pulse = m.pulse ? `<circle class="pulse-ring" cx="16" cy="15" r="12" fill="none" stroke="${m.color}" stroke-width="3"/>` : "";
    const html = `<svg width="${size}" height="${size + 8}" viewBox="0 0 32 40" style="opacity:${opacity};filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))" aria-hidden="true">
      ${pulse}
      <path d="M16 39 C16 39 4 25 4 15 A12 12 0 1 1 28 15 C28 25 16 39 16 39Z" fill="${m.color}" stroke="#fff" stroke-width="2"/>
      ${ring}
      <text x="16" y="19" text-anchor="middle" font-size="${(m.glyph?.length ?? 1) > 2 ? 8 : 10}" font-weight="700" fill="#fff" font-family="Segoe UI,system-ui,sans-serif">${m.glyph ?? ""}</text>
    </svg>`;
    return L.divIcon({ html, className: "coord-marker", iconSize: [size, size + 8], iconAnchor: [size / 2, size + 6], tooltipAnchor: [0, -size] });
  }
  const size = m.selected ? 22 : 16;
  const shape =
    m.kind === "org"
      ? `<rect x="2" y="2" width="16" height="16" rx="4" fill="${m.hollow ? "#fff" : m.color}" stroke="${m.hollow ? m.color : "#fff"}" stroke-width="${m.hollow ? 3 : 2}"/>`
      : `<circle cx="10" cy="10" r="8" fill="${m.hollow ? "#fff" : m.color}" stroke="${m.hollow ? m.color : "#fff"}" stroke-width="${m.hollow ? 3 : 2}"/>`;
  const ring = m.selected ? `<circle cx="10" cy="10" r="9.5" fill="none" stroke="#f5b400" stroke-width="2.5"/>` : "";
  const html = `<svg width="${size}" height="${size}" viewBox="0 0 20 20" style="opacity:${opacity};filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))" aria-hidden="true">${shape}${ring}</svg>`;
  return L.divIcon({ html, className: "coord-marker", iconSize: [size, size], iconAnchor: [size / 2, size / 2], tooltipAnchor: [0, -size / 2] });
}

function FitBounds({ markers, fitKey }: { markers: MapMarker[]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    const incidents = markers.filter((m) => m.kind === "incident");
    const target = markers.find((m) => m.kind === "target");
    let pts = markers;
    if (incidents.length > 1) {
      // Dashboard: frame incidents only.
      pts = incidents;
    } else if (target) {
      // Workbench: frame the target, the assigned team, and candidates within ~25 km.
      const t = L.latLng(target.position.lat, target.position.lng);
      const near = markers.filter((m) => m === target || m.selected || t.distanceTo(L.latLng(m.position.lat, m.position.lng)) <= 25_000);
      const team = markers.filter((m) => m === target || m.selected);
      pts = team.length > 1 ? team : near;
    }
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((m) => [m.position.lat, m.position.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 13, animate: false });
    // Only refit when the caller's key changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function Recenter({ center, zoom }: { center?: GeoPoint; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], zoom ?? map.getZoom(), { animate: true });
  }, [map, center?.lat, center?.lng, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function MapView({ markers, lines = [], shapes = [], provider, center, zoom = 11, fit, fitKey, onSelect, className, ariaLabel }: MapViewProps) {
  const tiles = useMemo(
    () =>
      provider === "azure-maps"
        ? {
            url: "/api/maps/tiles/{z}/{x}/{y}",
            attribution: '© <a href="https://azure.microsoft.com/products/azure-maps">Microsoft Azure Maps</a>, © TomTom',
          }
        : {
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
    [provider],
  );
  const start = center ?? markers[0]?.position ?? { lat: 37.271, lng: -79.9414 };

  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <MapContainer center={[start.lat, start.lng]} zoom={zoom} scrollWheelZoom className="map-muted h-full w-full" attributionControl>
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={18} />
        {shapes.map((s) => (
          <ShapeLayer key={s.id} s={s} />
        ))}
        {lines.map((l) => (
          <Polyline
            key={l.id}
            positions={[
              [l.from.lat, l.from.lng],
              [l.to.lat, l.to.lng],
            ]}
            pathOptions={{ color: l.color, weight: 3, opacity: 0.85, dashArray: l.dashed ? "6 6" : undefined }}
          />
        ))}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.position.lat, m.position.lng]}
            icon={iconFor(m)}
            zIndexOffset={m.selected || m.kind === "target" ? 1000 : m.kind === "incident" ? 100 : 0}
            eventHandlers={onSelect ? { click: () => onSelect(m.id) } : undefined}
            keyboard
            title={m.label}
            alt={m.label}
          >
            <Tooltip className="coord-tip" direction="top">
              {m.label}
            </Tooltip>
          </Marker>
        ))}
        {fit ? <FitBounds markers={markers} fitKey={fitKey} /> : <Recenter center={center} zoom={zoom} />}
      </MapContainer>
    </div>
  );
}
