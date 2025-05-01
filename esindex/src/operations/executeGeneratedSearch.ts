// === src/operations/executeGeneratedSearch.ts ===
import { PrismaClient, ESSearch, TermSearch, CompoundSearch, SearchLogicOperator } from '@prisma/client';
import { esClient } from '../lib/es';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

/**
 * Execute a generated search against Elasticsearch and store the results
 */
export async function executeGeneratedSearch(
  searchId: number,
  corpusName: string,
  resultSetName?: string
): Promise<void> {
  // Find the search
  const search = await prisma.eSSearch.findUnique({
    where: { id: searchId },
    include: {
      termSearch: true,
      compoundSearch: {
        include: {
          subqueries: {
            include: {
              subquery: {
                include: {
                  termSearch: true,
                  compoundSearch: {
                    include: {
                      subqueries: {
                        include: {
                          subquery: {
                            include: {
                              termSearch: true
                            }
                          }
                        },
                        orderBy: {
                          position: 'asc'
                        }
                      }
                    }
                  }
                }
              }
            },
            orderBy: {
              position: 'asc'
            }
          }
        }
      }
    }
  });

  if (!search) {
    throw new Error(`Search with ID ${searchId} not found`);
  }

  // Find the corpus
  const corpus = await prisma.corpus.findUnique({
    where: { name: corpusName }
  });

  if (!corpus) {
    throw new Error(`Corpus with name ${corpusName} not found`);
  }

  console.log(`Executing search "${search.name}" (ID: ${search.id}) against corpus ${corpusName}`);

  // Build the query
  const esQuery = buildElasticSearchQuery(search);
  
  console.log('Executing Elasticsearch query:', JSON.stringify(esQuery, null, 2));

  // Execute the search
  const searchResult = await esClient.search({
    index: corpusName,
    body: esQuery,
    size: 1000 // Consider pagination for large result sets
  });

  const hits = searchResult.hits.hits;
  console.log(`Search returned ${hits.length} hits`);

  // Generate result set name if not provided
  const setName = resultSetName || `SearchResult_${search.name}_${Date.now()}`;

  // Create an operation record for this execution
  const operation = await prisma.corpusSetOperation.create({
    data: {
      name: `Execute_${search.name}`,
      searchType: 'ESJSONSEARCH', // Use JSON search as the type
      operationText: JSON.stringify(esQuery),
      corpus: { connect: { id: corpus.id } }
    }
  });

  // Create a document set for the results
  const documentSet = await prisma.corpusDocumentSet.create({
    data: {
      name: setName,
      corpus: { connect: { id: corpus.id } },
      operation: { connect: { id: operation.id } }
    }
  });

  // Map ES results to database documents
  const esIdsToFind = hits.map(hit => hit._id);
  
  const dbDocuments = await prisma.document.findMany({
    where: {
      corpusId: corpus.id,
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
  for (const doc of dbDocuments) {
    const setDoc = await prisma.setDocument.create({
      data: {
        documentSet: { connect: { id: documentSet.id } },
        document: { connect: { id: doc.id } }
      }
    });
    
    // Create metrics with relevance score and rank
    await prisma.documentMetrics.create({
      data: {
        relevanceScore: esIdToScore.get(doc.esId) || 0,
        rank: Array.from(esIdToScore.keys()).indexOf(doc.esId) + 1,
        setDocument: { connect: { id: setDoc.id } }
      }
    });
  }

  // Create execution record to link the search with its result set
  const execution = await prisma.eSQueryExecution.create({
    data: {
      search: { connect: { id: search.id } },
      resultSet: { connect: { id: documentSet.id } }
    }
  });

  // Calculate and store metrics for the search
  await calculateQueryMetrics(execution.id, search, documentSet.id);

  // Calculate overall set metrics
  await calculateSetMetrics(documentSet.id);
  
  console.log(`Execution complete. Created document set "${setName}" with ${dbDocuments.length} documents`);
}

/**
 * Build an Elasticsearch query from an ESSearch object
 */
function buildElasticSearchQuery(search: ESSearch & {
  termSearch?: TermSearch | null,
  compoundSearch?: (CompoundSearch & {
    subqueries: {
      subquery: ESSearch & {
        termSearch?: TermSearch | null,
        compoundSearch?: (CompoundSearch & {
          subqueries: {
            subquery: ESSearch & {
              termSearch?: TermSearch | null
            }
          }[]
        }) | null
      }
    }[]
  }) | null
}): any {
  // If this is a term search
  if (search.termSearch) {
    const term = search.termSearch.term;
    const isPhrase = search.termSearch.termSearchType === 'PHRASE';
    
    let query: any;
    
    if (isPhrase) {
      // Use match_phrase for phrases
      query = {
        match_phrase: {
          _all: term
        }
      };
    } else {
      // Use match for keywords
      query = {
        match: {
          _all: term
        }
      };
    }
    
    // Apply inversion if needed
    if (search.invert) {
      return {
        bool: {
          must_not: query
        }
      };
    }
    
    return query;
  }
  
  // If this is a compound search
  if (search.compoundSearch) {
    const logicOperator = search.compoundSearch.logicOperator;
    const subqueries = search.compoundSearch.subqueries.map(sq => {
      return buildElasticSearchQuery(sq.subquery);
    });
    
    let boolQuery: any;
    
    if (logicOperator === SearchLogicOperator.AND) {
      boolQuery = {
        bool: {
          must: subqueries
        }
      };
    } else {
      boolQuery = {
        bool: {
          should: subqueries,
          minimum_should_match: 1
        }
      };
    }
    
    // Apply inversion if needed
    if (search.invert) {
      return {
        bool: {
          must_not: boolQuery
        }
      };
    }
    
    return boolQuery;
  }
  
  // Fallback to match_all
  return {
    match_all: {}
  };
}

/**
 * Calculate and store metrics for a query execution
 */
async function calculateQueryMetrics(
  executionId: number,
  search: ESSearch,
  resultSetId: number
): Promise<void> {
  // Get the document set
  const documentSet = await prisma.corpusDocumentSet.findUnique({
    where: { id: resultSetId },
    include: {
      documents: true
    }
  });

  if (!documentSet) {
    throw new Error(`Document set with ID ${resultSetId} not found`);
  }

  // Calculate metrics
  const hitsCount = documentSet.documents.length;
  
  // Count words, terms, and complexity
  const stats = await countSearchStats(search);
  
  const hitsPerWord = stats.wordCount > 0 ? hitsCount / stats.wordCount : 0;
  const hitsPerTerm = stats.termCount > 0 ? hitsCount / stats.termCount : 0;
  const hitsPerQuery = hitsCount;
  
  // Create or update metrics
  await prisma.queryMetrics.create({
    data: {
      hitsPerWord,
      hitsPerTerm,
      hitsPerQuery,
      wordCount: stats.wordCount,
      termCount: stats.termCount,
      queryComplexity: stats.complexity,
      execution: { connect: { id: executionId } }
    }
  });
  
  console.log(`Calculated query metrics for execution ${executionId}:`);
  console.log(`Words: ${stats.wordCount}, Terms: ${stats.termCount}, Complexity: ${stats.complexity}`);
  console.log(`Hits per word: ${hitsPerWord.toFixed(2)}, Hits per term: ${hitsPerTerm.toFixed(2)}, Total hits: ${hitsPerQuery}`);
}

/**
 * Count words, terms, and complexity in a search
 */
async function countSearchStats(search: ESSearch & {
  termSearch?: TermSearch | null,
  compoundSearch?: (CompoundSearch & {
    subqueries: {
      subquery: ESSearch & {
        termSearch?: TermSearch | null,
        compoundSearch?: any
      }
    }[]
  }) | null
}): Promise<{ wordCount: number, termCount: number, complexity: number }> {
  let wordCount = 0;
  let termCount = 0;
  let complexity = 1; // Start with 1 for the search itself
  
  if (search.termSearch) {
    // Count words in the term
    wordCount += search.termSearch.term.split(/\s+/).length;
    termCount += 1;
  } else if (search.compoundSearch) {
    // Add complexity for each subquery
    complexity += search.compoundSearch.subqueries.length;
    
    // Add complexity for the boolean operator
    complexity += 1;
    
    // Process each subquery
    for (const sq of search.compoundSearch.subqueries) {
      const subStats = await countSearchStats(sq.subquery);
      wordCount += subStats.wordCount;
      termCount += subStats.termCount;
      complexity += subStats.complexity;
    }
  }
  
  // Add complexity for inversion if needed
  if (search.invert) {
    complexity += 1;
  }
  
  return { wordCount, termCount, complexity };
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
