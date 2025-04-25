// === src/setup/setupDocumentTypes.ts ===
import { PrismaClient, DocType, DocFieldType, ESIndexType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Define a document field configuration
 */
interface FieldConfig {
  name: string;
  fieldType: string;
  esIndexType: string;
}

/**
 * Define a document type configuration
 */
interface DocumentTypeConfig {
  name: string;
  docType: string;
  isDefault?: boolean;
  fields: FieldConfig[];
}

/**
 * Setup document types for a corpus type
 */
export async function setupDocumentTypes(
  corpusTypeName: string,
  documentTypes: DocumentTypeConfig[]
): Promise<void> {
  // Find or create corpus type
  const corpusType = await prisma.corpusType.findUnique({
    where: { name: corpusTypeName }
  });

  if (!corpusType) {
    throw new Error(`Corpus type "${corpusTypeName}" not found. Create it first.`);
  }

  let defaultDocTypeId: number | null = null;

  // Process each document type
  for (const docTypeConfig of documentTypes) {
    // Create the document type
    const documentType = await prisma.corpusDocumentType.upsert({
      where: {
        name: docTypeConfig.name
      },
      update: {
        docType: docTypeConfig.docType as DocType,
        corpusTypeId: corpusType.id
      },
      create: {
        name: docTypeConfig.name,
        docType: docTypeConfig.docType as DocType,
        corpusTypeId: corpusType.id
      }
    });

    // If this is the default, store its ID
    if (docTypeConfig.isDefault) {
      defaultDocTypeId = documentType.id;
    }

    console.log(`Document type "${docTypeConfig.name}" created or updated`);

    // Process fields
    for (const fieldConfig of docTypeConfig.fields) {
      await prisma.documentTypeField.upsert({
        where: {
          documentTypeId_name: {
            documentTypeId: documentType.id,
            name: fieldConfig.name
          }
        },
        update: {
          fieldType: fieldConfig.fieldType as DocFieldType,
          esIndexType: fieldConfig.esIndexType as ESIndexType
        },
        create: {
          name: fieldConfig.name,
          fieldType: fieldConfig.fieldType as DocFieldType,
          esIndexType: fieldConfig.esIndexType as ESIndexType,
          documentTypeId: documentType.id
        }
      });
    }

    console.log(`Created/updated ${docTypeConfig.fields.length} fields for document type "${docTypeConfig.name}"`);
  }

  // Update the default document type if specified
  if (defaultDocTypeId) {
    await prisma.corpusType.update({
      where: { id: corpusType.id },
      data: {
        defaultDocTypeId
      }
    });

    console.log(`Set default document type with ID ${defaultDocTypeId} for corpus type "${corpusTypeName}"`);
  }
}
