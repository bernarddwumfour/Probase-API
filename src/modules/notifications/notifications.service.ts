import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListNotificationsDto } from './dto/list-notifications.dto';
import type { NotificationKindValue } from './notification-kinds';

export const toNotificationResponse = (n: Notification) => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  message: n.message,
  data: n.data,
  date: n.createdAt.toISOString(),
  read: n.readAt !== null,
  readAt: n.readAt?.toISOString() ?? null,
});

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the transaction client so the notification commits together with the change. */
  create(
    db: Prisma.TransactionClient,
    input: {
      userId: string;
      kind: NotificationKindValue;
      title: string;
      message: string;
      data?: Prisma.InputJsonValue;
    },
  ) {
    return db.notification.create({ data: input });
  }

  async list(userId: string, q: ListNotificationsDto) {
    const { page, limit } = q;
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(q.unread ? { readAt: null } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit + 1,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: rows.slice(0, limit).map(toNotificationResponse),
      page,
      limit,
      hasMore: rows.length > limit,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.getOwned(userId, id);
  }

  async markUnread(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: { not: null } },
      data: { readAt: null },
    });
    return this.getOwned(userId, id);
  }

  async readAll(userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  private async getOwned(userId: string, id: string) {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new AppException(404, ErrorCode.NOT_FOUND, 'Notification not found');
    return toNotificationResponse(row);
  }
}