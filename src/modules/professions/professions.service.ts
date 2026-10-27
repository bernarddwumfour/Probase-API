import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProfessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.profession.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, iconUrl: true },
    });
    return { items: rows };
  }
}