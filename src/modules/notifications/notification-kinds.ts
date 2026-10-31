export const NotificationKind = {
  NEW_REQUEST: 'new_request',
  BOOKING_UPDATED: 'booking_updated',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_DECLINED: 'booking_declined',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_STARTED: 'booking_started',
  BOOKING_COMPLETED: 'booking_completed',
  RESCHEDULE_PROPOSED: 'reschedule_proposed',
  RESCHEDULE_ACCEPTED: 'reschedule_accepted',
  RESCHEDULE_DECLINED: 'reschedule_declined',
  RESCHEDULE_WITHDRAWN: 'reschedule_withdrawn',
} as const;

export type NotificationKindValue = (typeof NotificationKind)[keyof typeof NotificationKind];