import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

/** Converts Prisma Decimal (or null) to number. */
export function num(v: Prisma.Decimal | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  return typeof v === 'number' ? v : v.toNumber();
}
