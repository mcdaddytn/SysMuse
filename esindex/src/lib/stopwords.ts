// === src/lib/stopwords.ts ===
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class StopwordCache {
  /**
   * Load stopwords from the database
   * @param corpusId Optional corpus ID to filter stopwords
   * @returns Set of stopwords
   */
  public static async load(corpusId?: number): Promise<Set<string>> {
    const words = await prisma.stopword.findMany({
      where: corpusId ? { corpusId } : undefined
    });
    return new Set(words.map(w => w.term));
  }
}
