import { describe, expect, it } from 'vitest';
import { boundingBox, haversineKm } from './geo';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point km away from the centre on a given bearing. */
function destination(lat: number, lng: number, km: number, bearing: number) {
  const d = km / 6371;
  const b = rad(bearing);
  const p1 = rad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    rad(lng) +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lng: deg(l2) };
}

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(5.6037, -0.187, 5.6037, -0.187)).toBe(0);
  });

  it('gives a realistic distance between Accra and Kumasi', () => {
    const km = haversineKm(5.6037, -0.187, 6.6885, -1.6244);
    expect(km).toBeGreaterThan(195);
    expect(km).toBeLessThan(205);
  });

  it('is symmetric', () => {
    const a = haversineKm(5.6, -0.19, 6.0, -0.5);
    const b = haversineKm(6.0, -0.5, 5.6, -0.19);
    expect(a).toBeCloseTo(b, 9);
  });

  it('treats one degree of latitude as about 111 km', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });
});

describe('boundingBox', () => {
  it('contains every point at the radius, in every direction', () => {
    for (const lat of [5.6, 60, 80]) {
      const box = boundingBox(lat, 10, 10);
      for (let bearing = 0; bearing < 360; bearing += 5) {
        const p = destination(lat, 10, 10, bearing);
        expect(haversineKm(lat, 10, p.lat, p.lng)).toBeCloseTo(10, 3);
        expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
        expect(p.lat).toBeLessThanOrEqual(box.maxLat);
        expect(box.minLng).toBeDefined();
        expect(p.lng).toBeGreaterThanOrEqual(box.minLng!);
        expect(p.lng).toBeLessThanOrEqual(box.maxLng!);
      }
    }
  });

  it('leaves out the longitude range when it would cross the antimeridian', () => {
    const box = boundingBox(0, 179.99, 10);
    expect(box.minLng).toBeUndefined();
    expect(box.maxLng).toBeUndefined();
    expect(box.minLat).toBeLessThan(0);
  });

  it('leaves out the longitude range near a pole', () => {
    const box = boundingBox(89.99, 0, 10);
    expect(box.minLng).toBeUndefined();
    expect(box.maxLng).toBeUndefined();
  });
});