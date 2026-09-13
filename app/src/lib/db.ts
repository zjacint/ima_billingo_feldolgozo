import { PrismaClient } from "@prisma/client";

// Szabványos Next.js/Prisma singleton minta — dev módban a hot-reload ne
// nyisson minden mentésnél új kapcsolatot.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
