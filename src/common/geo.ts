const EARTH_RADIUS_KM = 6371;
const PADDING_DEG = 1e-6;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance. The SQL in the search query uses the same formula. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng?: number; 
  maxLng?: number;
}

/** A box that contains every point within radiusKm of the centre. */
export function boundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const d = radiusKm / EARTH_RADIUS_KM; // angular radius
  const dLat = toDeg(d);
  const box: BoundingBox = {
    minLat: lat - dLat - PADDING_DEG,
    maxLat: lat + dLat + PADDING_DEG,
  };

  const ratio = Math.sin(d) / Math.cos(toRad(lat));
  if (!(ratio < 1)) return box; // the circle reaches a pole

  const dLng = toDeg(Math.asin(ratio));
  const minLng = lng - dLng - PADDING_DEG;
  const maxLng = lng + dLng + PADDING_DEG;
  if (minLng < -180 || maxLng > 180) return box; // crosses the antimeridian
  return { ...box, minLng, maxLng };
}