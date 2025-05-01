// === src/operations/generateExhaustiveSearch.ts ===
import { PrismaClient, DocSetExhSearchSelectMode, DocSetExhSearchEvalMode, 
         TermSearchType, SearchLogicOperator } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

interface ExhaustiveSearchParams {
  corpusDocumentSetName: string;
  corpusName: string;
  name?: string;
  nextTermSelectMode: DocSetExhSearchSelectMode;
  nextTermEvalMode: DocSetExhSearchEvalMode;
  evalTermCount?: number;
  exhaustivenessThreshold?: number;
}

/**
 * Generate an exhaustive search for a document set
 * This creates a compound search with OR operators that covers the entire set
 */
export async function generateDocSetExhaustiveSearch(params: ExhaustiveSearchParams): Promise<void> {
  // Find corpus
  const corpus = await prisma.corpus.findUnique({
    where: { name: params.corpusName }
  });

  if (!corpus) {
    throw new Error(`Corpus not found: ${params.corpusName}`);
  }

  // Find document set
  const documentSet = await prisma.corpusDocumentSet.findFirst({
    where: {
      name: params.corpusDocumentSetName,
      corpusId: corpus.id
    },
    include: {
      documents: {
        include: {
          document: true
        }
      }
    }
  });

  if (!documentSet) {
    throw new Error(`Document set not found: ${params.corpusDocumentSetName} in corpus ${params.corpusName}`);
  }

  console.log(`Generating exhaustive search for document set ${documentSet.name} with ${documentSet.documents.length} documents`);

  // Create a default name if not provided
  const name = params.name || 
    `ExhaustiveSearch_${documentSet.name}_${params.nextTermSelectMode}_${params.nextTermEvalMode}_${Date.now()}`;
  
  // Get the evaluation term count or default to 0 (all terms)
  const evalTermCount = params.evalTermCount || 0;
  
  // Get the exhaustiveness threshold or default to 1.0 (100%)
  const exhaustivenessThreshold = params.exhaustivenessThreshold || 1.0;

  // Create the exhaustive search record
  const exhaustiveSearch = await prisma.docSetExhaustiveSearch.create({
    data: {
      name,
      nextTermSelectMode: params.nextTermSelectMode,
      nextTermEvalMode: params.nextTermEvalMode,
      evalTermCount,
      exhaustivenessThreshold,
      searchText: '', // Will be updated as we build the search
      corpusDocumentSet: { connect: { id: documentSet.id } }
    }
  });

  console.log(`Created exhaustive search record with ID ${exhaustiveSearch.id}`);

  // Get all document IDs in the set
  const targetDocumentIds = new Set(documentSet.documents.map(sd => sd.documentId));
  console.log(`Target document set contains ${targetDocumentIds.size} documents`);

  // Get all search term results for this corpus that we can use
  // These would have been created by the ESSEARCHTERMTEST operation
  const termTestSets = await prisma.corpusDocumentSet.findMany({
    where: {
      corpusId: corpus.id,
      operation: {
        searchType: 'ESSEARCHTERMTEST'
      }
    },
    include: {
      documents: {
        select: {
          documentId: true
        }
      },
      operation: true,
      metrics: true
    }
  });

  console.log(`Found ${termTestSets.length} search term test sets to evaluate`);

  if (termTestSets.length === 0) {
    throw new Error(`No search term test results found for corpus ${params.corpusName}. Run ESSEARCHTERMTEST first.`);
  }

  // Map from term name to set of document IDs
  const termToDocIds = new Map<string, Set<number>>();
  
  // Map from term name to document set ID
  const termToSetId = new Map<string, number>();

  // Extract the term name from the set name (Term_[term]_timestamp)
  for (const set of termTestSets) {
    const termMatch = set.name.match(/^Term_([^_]+)_\d+$/);
    if (termMatch) {
      const term = termMatch[1].replace(/_/g, ' '); // Restore spaces in the term
      const docIds = new Set(set.documents.map(sd => sd.documentId));
      termToDocIds.set(term, docIds);
      termToSetId.set(term, set.id);
    }
  }

  console.log(`Extracted ${termToDocIds.size} unique terms from test results`);

  // Sort terms based on the selection mode
  let availableTerms = Array.from(termToDocIds.keys());
  
  if (params.nextTermSelectMode === 'MINHITS') {
    // Sort by minimum number of hits
    availableTerms.sort((a, b) => {
      const aHits = termToDocIds.get(a)?.size || 0;
      const bHits = termToDocIds.get(b)?.size || 0;
      return aHits - bHits;
    });
  } else if (params.nextTermSelectMode === 'MAXHITS') {
    // Sort by maximum number of hits
    availableTerms.sort((a, b) => {
      const aHits = termToDocIds.get(a)?.size || 0;
      const bHits = termToDocIds.get(b)?.size || 0;
      return bHits - aHits;
    });
  } else {
    // Random order
    availableTerms = shuffleArray(availableTerms);
  }

  // Build the exhaustive search
  // We'll keep track of the document IDs we've covered so far
  const coveredDocIds = new Set<number>();
  
  // And the terms we've selected
  const selectedTerms: string[] = [];
  
  // And the corresponding searches
  const selectedSearches: number[] = [];

  // Iterate until we've covered all documents or reached the threshold
  while (coveredDocIds.size < targetDocumentIds.size * exhaustivenessThreshold && availableTerms.length > 0) {
    // If we're evaluating a limited number of terms, take the top N
    const termsToEvaluate = evalTermCount > 0 && evalTermCount < availableTerms.length
      ? availableTerms.slice(0, evalTermCount)
      : [...availableTerms];
    
    // Find the best term to add next
    let bestTerm = '';
    let bestIncrement = 0;
    
    for (const term of termsToEvaluate) {
      const termDocIds = termToDocIds.get(term) || new Set<number>();
      
      // Calculate how many new documents this term would add
      let newDocCount = 0;
      Array.from(termDocIds).forEach(docId => {
        if (targetDocumentIds.has(docId) && !coveredDocIds.has(docId)) {
          newDocCount++;
        }
      });

      // Determine if this is the best term based on evaluation mode
      if (params.nextTermEvalMode === 'INCMAX') {
        // Look for maximum increment
        if (newDocCount > bestIncrement) {
          bestIncrement = newDocCount;
          bestTerm = term;
        }
      } else { // INCMIN
        // Look for minimum non-zero increment
        if (newDocCount > 0 && (bestIncrement === 0 || newDocCount < bestIncrement)) {
          bestIncrement = newDocCount;
          bestTerm = term;
        }
      }
    }
    
    if (bestTerm === '' || bestIncrement === 0) {
      // No term adds any new documents, we're done
      break;
    }
    
    // Add the best term
    selectedTerms.push(bestTerm);
    
    // Create a TermSearch for this term (if not already exists)
    const termDocIds = termToDocIds.get(bestTerm) || new Set<number>();
    
    // Determine if this is a phrase or keyword
    const isPhrase = bestTerm.includes(' ');
    const termSearchType = isPhrase ? TermSearchType.PHRASE : TermSearchType.KEYWORD;
    
    // Create the search record
    const searchName = isPhrase 
      ? `term_phrase_${bestTerm.replace(/\s+/g, '_')}`
      : `term_keyword_${bestTerm}`;
    
    // First create the base ESSearch
    const search = await prisma.eSSearch.create({
      data: {
        name: searchName,
        invert: false
      }
    });
    
    // Then create the TermSearch
    await prisma.termSearch.create({
      data: {
        termSearchType,
        term: bestTerm,
        search: { connect: { id: search.id } }
      }
    });
    
    // Create a query execution to link the term search with its result set
    await prisma.eSQueryExecution.create({
      data: {
        search: { connect: { id: search.id } },
        resultSet: { connect: { id: termToSetId.get(bestTerm) || 0 } }
      }
    });
    
    selectedSearches.push(search.id);
    
    // Update covered document IDs
    Array.from(termDocIds).forEach(docId => {
      if (targetDocumentIds.has(docId)) {
        coveredDocIds.add(docId);
      }
    });

    // Remove the term from available terms
    availableTerms = availableTerms.filter(t => t !== bestTerm);
    
    console.log(`Added term: ${bestTerm} (${bestIncrement} new docs, total coverage: ${coveredDocIds.size}/${targetDocumentIds.size})`);
  }
  
  // Build the compound search with all selected terms
  if (selectedTerms.length > 0) {
    // Create the compound search
    //const compoundSearchName = `compound_${selectedSearches.sort((a, b) => a - b).join('_')}`;
    //gm: generatinng above search was too long, appending all ids, for now use doc set name
    // lets have option for new name
    //const compoundSearchName = params.corpusDocumentSetName;
    const compoundSearchName = `${params.corpusDocumentSetName}_${Date.now()}`;

    console.log(`Adding compound search compoundSearchName: ${compoundSearchName}`);
    
    const compoundSearch = await prisma.eSSearch.create({
      data: {
        name: compoundSearchName,
        invert: false,
        compoundSearch: {
          create: {
            logicOperator: SearchLogicOperator.OR
          }
        }
      },
      include: {
        compoundSearch: true
      }
    });
    
    // Add the subqueries
    for (let i = 0; i < selectedSearches.length; i++) {
      await prisma.compoundSearchSubquery.create({
        data: {
          compoundSearch: { connect: { id: compoundSearch.compoundSearch!.id } },
          subquery: { connect: { id: selectedSearches[i] } },
          position: i
        }
      });
    }
    
    // Build the search text
    const searchText = selectedTerms.map(term => {
      if (term.includes(' ')) {
        return `"${term}"`;
      } else {
        return term;
      }
    }).join(' OR ');
    
    const finalSearchText = selectedTerms.length > 1 ? `(${searchText})` : searchText;
    
    // Update the exhaustive search record with the search text and the result search
    await prisma.docSetExhaustiveSearch.update({
      where: { id: exhaustiveSearch.id },
      data: {
        searchText: finalSearchText,
        resultSearch: { connect: { id: compoundSearch.id } }
      }
    });
    
    console.log(`Created compound search with ${selectedTerms.length} terms`);
    console.log(`Final search text: ${finalSearchText}`);
    console.log(`Coverage: ${coveredDocIds.size}/${targetDocumentIds.size} documents (${(coveredDocIds.size / targetDocumentIds.size * 100).toFixed(2)}%)`);
    
    // Calculate and store metrics for the query
    const wordCount = selectedTerms.reduce((count, term) => count + term.split(/\s+/).length, 0);
    const termCount = selectedTerms.length;
    const queryComplexity = termCount > 1 ? termCount + 2 : termCount; // +2 for parentheses if more than one term
    
    // Create an execution record for the compound search
    const execution = await prisma.eSQueryExecution.create({
      data: {
        search: { connect: { id: compoundSearch.id } },
        resultSet: { connect: { id: documentSet.id } }
      }
    });
    
    // Create metrics for the execution
    await prisma.queryMetrics.create({
      data: {
        hitsPerWord: coveredDocIds.size / (wordCount || 1),
        hitsPerTerm: coveredDocIds.size / (termCount || 1),
        hitsPerQuery: coveredDocIds.size,
        wordCount,
        termCount,
        queryComplexity,
        execution: { connect: { id: execution.id } }
      }
    });
  } else {
    console.log(`No terms selected for exhaustive search`);
  }
}

/**
 * Shuffle an array in place
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
