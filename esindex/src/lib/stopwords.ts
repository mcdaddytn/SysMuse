// === src/lib/stopwords.ts ===
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class StopwordCache {
  private static cache: Set<string> | null = null;

  static async load(): Promise<Set<string>> {
    if (this.cache) return this.cache;

    const stopwords = await prisma.stopword.findMany();
    this.cache = new Set(stopwords.map(w => w.term.toLowerCase()));
    return this.cache;
  }

  static reset() {
    this.cache = null;
  }
}
