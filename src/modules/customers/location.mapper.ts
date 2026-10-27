import type { SavedLocation } from '@prisma/client';

export const toLocationResponse = (l: SavedLocation) => ({
  id: l.id,
  name: l.name,
  latitude: l.latitude,
  longitude: l.longitude,
  address: l.address,
  searchRadiusKm: l.searchRadiusKm,
  isDefault: l.isDefault,
});