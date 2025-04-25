// === src/operations/executeCorpusOperation.ts ===
import { PrismaClient, CorpusOperationType } from '@prisma/client';
import { esClient } from '../lib/es';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

/**
 * Execute a corpus operation based on the specified parameters
 */
export async function executeCorpusOperation(
  corpusName: string,
  operationType: string, 
  operationName?: string, 
  operationText?: string, 
  delimiter?: string,
  batchSize: number = 100
): Promise<void> {
  // Find the corpus
  const corpus = await prisma.corpus.findUnique({
    where: { name: corpusName }
  });

  if (!corpus) {
    throw new Error(`Corpus not found: ${corpusName}`);
  }

  // Parse operation type
  const searchType = operationType.toUpperCase() as CorpusOperationType;
  
  // Use default name if not provided
  const name = operationName || `${searchType}_${Date.now()}`;

  // Create the operation record
  const operation = await prisma.corpusSetOperation.create({
    data: {
      name,
      searchType,
      operationText: operationText || null,
      operationDelimiter: delimiter || null,
      corpus: { connect: { id: corpus.id } }
    }
  });

  console.log(`Created corpus operation: ${operation.name} (${operation.searchType})`);

  // Execute the operation based on the type
  switch (searchType) {
    case 'CORPUSSNAPSHOT':
      await createCorpusSnapshot(corpus.id, operation.id);
      break;
    case 'SETUNION':
      await executeSetUnion(corpus.id, operation.id, operationText, delimiter);
      break;
    case 'SETINTERSECTION':
      await executeSetIntersection(corpus.id, operation.id, operationText, delimiter);
      break;
    case 'ESKEYWORDSEARCH':
      await executeKeywordSearch(corpus.id, operation.id, operationText);
      break;
    case 'ESJSONSEARCH':
      await executeJsonSearch(corpus.id, operation.id, operationText);
      break;
    case 'ESJSONFILESEARCH':
      await executeJsonFileSearch(corpus.id, operation.id, operationText);
      break;
    case 'ESSEARCHTERMTEST':
      await executeSearchTermTest(corpus.id, operation.id, batchSize);
      break;
    default:
      throw new Error(`Unknown operation type: ${searchType}`);
  }

  console.log(`Completed corpus operation: ${operation.name}`);
}

/**
 * Create a snapshot of all documents in the corpus
 */
async function createCorpusSnapshot(corpusId: number, operationId: number): Promise<void> {
  const documentSet = await prisma.corpusDocumentSet.create({
    data: {
      name: `Snapshot_${Date.now()}`,
      corpus: { connect: { id: corpusId } },
      operation: { connect: { id: operationId } }
    }
  });

  // Get all documents for this corpus
  const documents = await prisma.document.findMany({
    where: { corpusId },
    select: { id: true, wordCount: true, docLength: true, distinctWordCount: true, avgWordLength: true }
  });

  console.log(`Found ${documents.length} documents for corpus snapshot`);

  // Create set documents in batches
  let totalWordCount = 0;
  let totalDocLength = 0;
  let totalDistinctWords = 0; // This is approximate as it's summed across documents
  let documentCount = 0;

  for (let i = 0; i < documents.length; i += 100) {
    const batch = documents.slice(i, i + 100);
    
    await prisma.$transaction(
      batch.map(doc => {
        totalWordCount += doc.wordCount;
        totalDocLength += doc.docLength;
        totalDistinctWords += doc.distinctWordCount;
        documentCount++;
        
        return prisma.setDocument.create({
          data: {
            documentSet: { connect: { id: documentSet.id } },
            document: { connect: { id: doc.id } }
          }
        });
      })
    );
  }

  // Calculate aggregated metrics
  const avgWordCount = documentCount > 0 ? totalWordCount / documentCount : 0;
  const avgDocLength = documentCount > 0 ? totalDocLength / documentCount : 0;
  const avgWordLength = totalWordCount > 0 ? totalDocLength / totalWordCount : 0;

  // Create metrics record
  await prisma.setMetrics.create({
    data: {
      wordCount: totalWordCount,
      documentCount,
      avgWordCount,
      avgDocLength,
      distinctWordCount: totalDistinctWords, // Approximate
      avgWordLength,
      documentSet: { connect: { id: documentSet.id } }
    }
  });

  console.log(`Created snapshot with ${documentCount} documents`);
}

/**
 * Execute a set union operation on existing document sets
 */
async function executeSetUnion(
  corpusId: number, 
  operationId: number, 
  operationText?: string,
  delimiter?: string
): Promise<void> {
  if (!operationText) {
    throw new Error('No input sets specified for set union operation');
  }

  const setNames = operationText.split(delimiter || ',').map(name => name.trim());
  
  // Get the input sets
  const inputSets = await prisma.corpusDocumentSet.findMany({
    where: {
      corpusId,
      name: { in: setNames }
    },
    include: {
      documents: {
        select: {
          documentId: true
        }
      }
    }
  });

  if (inputSets.length !== setNames.length) {
    const foundNames = inputSets.map(set => set.name);
    const missingNames = setNames.filter(name => !foundNames.includes(name));
    throw new Error(`Some input sets not found: ${missingNames.join(', ')}`);
  }

  // Create a new set for the union result
  const unionSet = await prisma.corpusDocumentSet.create({
    data: {
      name: `Union_${Date.now()}`,
      corpus: { connect: { id: corpusId } },
      operation: { connect: { id: operationId } }
    }
  });

  // Collect unique document IDs across all input sets
  const uniqueDocIds = new Set<number>();
  for (const set of inputSets) {
    for (const doc of set.documents) {
      uniqueDocIds.add(doc.documentId);
    }
  }

  // Create set documents for the union
  const docIds = Array.from(uniqueDocIds);
  console.log(`Creating union set with ${docIds.length} unique documents`);

  // Insert in batches
  for (let i = 0; i < docIds.length; i += 100) {
    const batch = docIds.slice(i, i + 100);
    
    await prisma.$transaction(
      batch.map(docId => {
        return prisma.setDocument.create({
          data: {
            documentSet: { connect: { id: unionSet.id } },
            document: { connect: { id: docId } }
          }
        });
      })
    );
  }

  // Create metrics for the union set (similar to snapshot)
  await calculateSetMetrics(unionSet.id);
  
  console.log(`Completed set union operation with ${docIds.length} documents`);
}

/**
 * Execute a set intersection operation on existing document sets
 */
async function executeSetIntersection(
  corpusId: number, 
  operationId: number, 
  operationText?: string,
  delimiter?: string
): Promise<void> {
  if (!operationText) {
    throw new Error('No input sets specified for set intersection operation');
  }

  const setNames = operationText.split(delimiter || ',').map(name => name.trim());
  
  // Get the input sets
  const inputSets = await prisma.corpusDocumentSet.findMany({
    where: {
      corpusId,
      name: { in: setNames }
    },
    include: {
      documents: {
        select: {
          documentId: true
        }
      }
    }
  });

  if (inputSets.length !== setNames.length) {
    const foundNames = inputSets.map(set => set.name);
    const missingNames = setNames.filter(name => !foundNames.includes(name));
    throw new Error(`Some input sets not found: ${missingNames.join(', ')}`);
  }

  // Create a new set for the intersection result
  const intersectionSet = await prisma.corpusDocumentSet.create({
    data: {
      name: `Intersection_${Date.now()}`,
      corpus: { connect: { id: corpusId } },
      operation: { connect: { id: operationId } }
    }
  });

  // Count occurrences of each document ID
  const docIdCounts = new Map<number, number>();
  for (const set of inputSets) {
    for (const doc of set.documents) {
      const count = docIdCounts.get(doc.documentId) || 0;
      docIdCounts.set(doc.documentId, count + 1);
    }
  }

  // Find document IDs that appear in all input sets
  const intersectionDocIds: number[] = [];
  docIdCounts.forEach((count, docId) => {
    if (count === inputSets.length) {
      intersectionDocIds.push(docId);
    }
  });

  console.log(`Creating intersection set with ${intersectionDocIds.length} documents`);

  // Insert in batches
  for (let i = 0; i < intersectionDocIds.length; i += 100) {
    const batch = intersectionDocIds.slice(i, i + 100);
    
    await prisma.$transaction(
      batch.map(docId => {
        return prisma.setDocument.create({
          data: {
            documentSet: { connect: { id: intersectionSet.id } },
            document: { connect: { id: docId } }
          }
        });
      })
    );
  }

  // Create metrics for the intersection set
  await calculateSetMetrics(intersectionSet.id);
  
  console.log(`Completed set intersection operation with ${intersectionDocIds.length} documents`);
}

/**
 * Execute a keyword search using Elasticsearch
 */
async function executeKeywordSearch(
  corpusId: number, 
  operationId: number, 
  searchQuery?: string
): Promise<void> {
  if (!searchQuery) {
    throw new Error('No search query provided for keyword search operation');
  }

  // First, get the corpus and index information
  const corpus = await prisma.corpus.findUnique({
    where: { id: corpusId },
    include: {
      corpusType: {
        include: {
          documentTypes: {
            include: {
              fields: true
            }
          }
        }
      }
    }
  });

  if (!corpus) {
    throw new Error(`Corpus with ID ${corpusId} not found`);
  }

  // Determine which fields to search
  // Use all TEXT/LONGTEXT fields if available, or search _all
  const searchFields: string[] = [];
  
  if (corpus.corpusType?.documentTypes) {
    for (const docType of corpus.corpusType.documentTypes) {
      for (const field of docType.fields) {
        if (field.fieldType === 'STRING' || field.fieldType === 'LONGTEXT') {
          if (field.esIndexType === 'TOKEN' || field.esIndexType === 'KEYWORD') {
            searchFields.push(field.name);
          }
        }
      }
    }
  }

  // Create the Elasticsearch query
  const esIndex = corpus.name; // Assuming corpus name matches index name
  
  // Execute the search with the query directly in the params (no body)
  const searchResult = await esClient.search({
    index: esIndex,
    size: 1000, // Consider pagination for large result sets
    query: {
      multi_match: {
        query: searchQuery,
        fields: searchFields.length > 0 ? searchFields : "_all",
        type: "best_fields",
        operator: "and" as const
      }
    }
  });

  const hits = searchResult.hits.hits;
  console.log(`Found ${hits.length} documents matching keyword search`);

  // Create a document set for the results
  const resultSet = await prisma.corpusDocumentSet.create({
    data: {
      name: `KeywordSearch_${Date.now()}`,
      corpus: { connect: { id: corpusId } },
      operation: { connect: { id: operationId } }
    }
  });

  // Map ES results to database documents
  const esIdsToFind = hits.map(hit => hit._id);
  
  const dbDocuments = await prisma.document.findMany({
    where: {
      corpusId,
      esId: { in: esIdsToFind }
    }
  });

  // Create a map for fast lookups
  const esIdToDbDoc = new Map<string, number>();
  const esIdToScore = new Map<string, number>();
  
  dbDocuments.forEach(doc => {
    esIdToDbDoc.set(doc.esId, doc.id);
  });
  
  hits.forEach((hit, index) => {
    esIdToScore.set(hit._id, hit._score || 0);
  });

  // Create SetDocument entries with relevance metrics
  const batch = [];
  for (const doc of dbDocuments) {
    const setDoc = await prisma.setDocument.create({
      data: {
        documentSet: { connect: { id: resultSet.id } },
        document: { connect: { id: doc.id } }
      }
    });
    
    // Create metrics with relevance score
    batch.push(
      prisma.documentMetrics.create({
        data: {
          relevanceScore: esIdToScore.get(doc.esId) || 0,
          rank: Array.from(esIdToScore.keys()).indexOf(doc.esId) + 1,
          setDocument: { connect: { id: setDoc.id } }
        }
      })
    );
  }
  
  await prisma.$transaction(batch);

  // Calculate overall set metrics
  await calculateSetMetrics(resultSet.id);
  
  console.log(`Completed keyword search operation with ${dbDocuments.length} results`);
}

/**
 * Execute a search using a JSON query
 */
async function executeJsonSearch(
  corpusId: number, 
  operationId: number, 
  jsonQuery?: string
): Promise<void> {
  if (!jsonQuery) {
    throw new Error('No JSON query provided for JSON search operation');
  }

  // Parse the JSON query
  let esQuery;
  try {
    esQuery = JSON.parse(jsonQuery);
  } catch (err) {
    throw new Error(`Invalid JSON query: ${err.message}`);
  }

  // Get the corpus for index name
  const corpus = await prisma.corpus.findUnique({
    where: { id: corpusId }
  });

  if (!corpus) {
    throw new Error(`Corpus with ID ${corpusId} not found`);
  }

  // Execute the search
  const esIndex = corpus.name; // Assuming corpus name matches index name
  
  // Use the spread operator to include all properties at the top level
  const searchResult = await esClient.search({
    index: esIndex,
    ...esQuery // Spread the parsed query object directly
  });

  const hits = searchResult.hits.hits;
  console.log(`Found ${hits.length} documents matching JSON query`);

  // Create a document set for the results
  const resultSet = await prisma.corpusDocumentSet.create({
    data: {
      name: `JsonSearch_${Date.now()}`,
      corpus: { connect: { id: corpusId } },
      operation: { connect: { id: operationId } }
    }
  });

  // Map ES results to database documents
  const esIdsToFind = hits.map(hit => hit._id);
  
  const dbDocuments = await prisma.document.findMany({
    where: {
      corpusId,
      esId: { in: esIdsToFind }
    }
  });

  // Create a map for fast lookups
  const esIdToDbDoc = new Map<string, number>();
  const esIdToScore = new Map<string, number>();
  
  dbDocuments.forEach(doc => {
    esIdToDbDoc.set(doc.esId, doc.id);
  });
  
  hits.forEach((hit, index) => {
    esIdToScore.set(hit._id, hit._score || 0);
  });

  // Create SetDocument entries with relevance metrics
  const batch = [];
  for (const doc of dbDocuments) {
    const setDoc = await prisma.setDocument.create({
      data: {
        documentSet: { connect: { id: resultSet.id } },
        document: { connect: { id: doc.id } }
      }
    });
    
    // Create metrics with relevance score
    batch.push(
      prisma.documentMetrics.create({
        data: {
          relevanceScore: esIdToScore.get(doc.esId) || 0,
          rank: Array.from(esIdToScore.keys()).indexOf(doc.esId) + 1,
          setDocument: { connect: { id: setDoc.id } }
        }
      })
    );
  }
  
  await prisma.$transaction(batch);

  // Calculate overall set metrics
  await calculateSetMetrics(resultSet.id);
  
  console.log(`Completed JSON search operation with ${dbDocuments.length} results`);
}

/**
 * Execute a search using a JSON query from a file
 */
async function executeJsonFileSearch(
  corpusId: number, 
  operationId: number, 
  filename?: string
): Promise<void> {
  if (!filename) {
    throw new Error('No filename provided for JSON file search operation');
  }

  // Read the JSON file
  const jsonPath = path.join(process.env.ESJSON_SEARCH_PATH || './queries', filename);
  let jsonQuery;
  
  try {
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    jsonQuery = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(`Error reading JSON file: ${err.message}`);
  }

  // Delegate to the JSON search function
  await executeJsonSearch(corpusId, operationId, JSON.stringify(jsonQuery));
}

/**
 * Execute a test search for each search term
 */
async function executeSearchTermTest(
  corpusId: number, 
  operationId: number,
  batchSize: number = 100
): Promise<void> {
  // Get all search terms for this corpus
  const searchTerms = await prisma.searchTerm.findMany({
    where: {
      document: {
        corpusId
      }
    },
    distinct: ['term'],
    orderBy: {
      adjbm25: 'desc'
    }
  });

  console.log(`Found ${searchTerms.length} unique search terms to test`);

  // Get corpus information
  const corpus = await prisma.corpus.findUnique({
    where: { id: corpusId }
  });

  if (!corpus) {
    throw new Error(`Corpus with ID ${corpusId} not found`);
  }

  const esIndex = corpus.name; // Assuming corpus name matches index name
  
  // Process in batches
  let processed = 0;
  for (let i = 0; i < searchTerms.length; i += batchSize) {
    const batch = searchTerms.slice(i, i + batchSize);
    console.log(`Processing batch ${i/batchSize + 1} of ${Math.ceil(searchTerms.length/batchSize)}`);
    
    // Process each term in parallel
    await Promise.all(batch.map(async (term) => {
      try {
        // Create a document set for this term
        const termSet = await prisma.corpusDocumentSet.create({
          data: {
            name: `Term_${term.term.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
            corpus: { connect: { id: corpusId } },
            operation: { connect: { id: operationId } }
          }
        });
        
        // Execute simple match query for this term - updated ES client call
        const searchResult = await esClient.search({
          index: esIndex,
          size: 50, // Limit results
          query: {
            match: {
              _all: term.term
            }
          }
        });
        
        const hits = searchResult.hits.hits;
        
        // Map ES results to database documents
        const esIdsToFind = hits.map(hit => hit._id);
        
        const dbDocuments = await prisma.document.findMany({
          where: {
            corpusId,
            esId: { in: esIdsToFind }
          }
        });
        
        // Create results with metrics
        for (let j = 0; j < dbDocuments.length; j++) {
          const doc = dbDocuments[j];
          const hit = hits.find(h => h._id === doc.esId);
          
          if (hit) {
            const setDoc = await prisma.setDocument.create({
              data: {
                documentSet: { connect: { id: termSet.id } },
                document: { connect: { id: doc.id } }
              }
            });
            
            await prisma.documentMetrics.create({
              data: {
                relevanceScore: hit._score || 0,
                rank: j + 1,
                setDocument: { connect: { id: setDoc.id } }
              }
            });
          }
        }
        
        // Calculate set metrics
        await calculateSetMetrics(termSet.id);
        
        processed++;
        if (processed % 10 === 0) {
          console.log(`Processed ${processed} search terms`);
        }
      } catch (err) {
        console.error(`Error processing term "${term.term}": ${err.message}`);
      }
    }));
  }
  
  console.log(`Completed search term test operation for ${processed} terms`);
}

/**
 * Calculate and store metrics for a document set
 */
async function calculateSetMetrics(setId: number): Promise<void> {
  // Get all documents in the set with their metrics
  const setDocuments = await prisma.setDocument.findMany({
    where: { setId },
    include: {
      document: true
    }
  });
  
  if (setDocuments.length === 0) {
    console.log(`No documents found in set ${setId} for metrics calculation`);
    return;
  }
  
  // Calculate aggregate metrics
  let totalWordCount = 0;
  let totalDocLength = 0;
  let totalDistinctWords = 0;
  let documentCount = setDocuments.length;
  
  for (const setDoc of setDocuments) {
    totalWordCount += setDoc.document.wordCount;
    totalDocLength += setDoc.document.docLength;
    totalDistinctWords += setDoc.document.distinctWordCount;
  }
  
  const avgWordCount = documentCount > 0 ? totalWordCount / documentCount : 0;
  const avgDocLength = documentCount > 0 ? totalDocLength / documentCount : 0;
  const avgWordLength = totalWordCount > 0 ? totalDocLength / totalWordCount : 0;
  
  // Create or update metrics
  await prisma.setMetrics.upsert({
    where: { setId },
    update: {
      wordCount: totalWordCount,
      documentCount,
      avgWordCount,
      avgDocLength,
      distinctWordCount: totalDistinctWords, // Approximate
      avgWordLength
    },
    create: {
      wordCount: totalWordCount,
      documentCount,
      avgWordCount,
      avgDocLength,
      distinctWordCount: totalDistinctWords,
      avgWordLength,
      documentSet: { connect: { id: setId } }
    }
  });
}