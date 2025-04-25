// === src/setup/setupCorpusType.ts ===
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Setup or update a corpus type
 */
export async function setupCorpusType(
  name: string,
  description?: string,
  defaultMetadata?: any
): Promise<void> {
  const corpusType = await prisma.corpusType.upsert({
    where: { name },
    update: {
      description: description ?? undefined,
      defaultMetadata: defaultMetadata ? JSON.stringify(defaultMetadata) : undefined
    },
    create: {
      name,
      description: description ?? null,
      defaultMetadata: defaultMetadata ? JSON.stringify(defaultMetadata) : null
    }
  });

  console.log(`Corpus type "${name}" created or updated with ID ${corpusType.id}`);
}
