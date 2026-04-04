/**
 * USPTO Index Database — Prisma Client Singleton
 *
 * Separate PrismaClient instance for the ip_portfolio_uspto database.
 * Uses the custom output path from prisma/uspto/schema.prisma.
 */

import { PrismaClient } from '../../node_modules/.prisma/uspto-client/index.js';

let usptoClient: PrismaClient | null = null;

export function getUsptoPrisma(): PrismaClient {
  if (!usptoClient) {
    usptoClient = new PrismaClient();
  }
  return usptoClient;
}

export async function disconnectUsptoPrisma(): Promise<void> {
  if (usptoClient) {
    await usptoClient.$disconnect();
    usptoClient = null;
  }
}

export { PrismaClient as UsptoPrismaClient };
