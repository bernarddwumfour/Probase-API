import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { GeoQueryDto } from './dto/geo-query.dto';

/** Returns the point, null when neither value was sent, and throws when only one was. */
export function geoPoint(dto: GeoQueryDto): { lat: number; lng: number } | null {
  if (dto.lat === undefined && dto.lng === undefined) return null;
  if (dto.lat === undefined || dto.lng === undefined) {
    throw new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', {
      [dto.lat === undefined ? 'lat' : 'lng']: ['lat and lng must be sent together'],
    });
  }
  return { lat: dto.lat, lng: dto.lng };
}