project-root/
+-- .env                        # Environment config (DB, ES, file paths)
+-- prisma/
¦   +-- schema.prisma          # Prisma DB schema
+-- data/                      # (External) CSV files
+-- config/
¦   +-- enron.json             # Run config for Enron dataset
¦   +-- ted_talks.json         # Run config for TED dataset
+-- src/
¦   +-- lib/
¦   ¦   +-- es.ts              # Elasticsearch client loader
¦   ¦   +-- config.ts          # Config loader from JSON
¦   +-- cli/
¦   ¦   +-- importCorpus.ts    # Document import + BM25 term extraction
¦   +-- setup/
¦   ¦   +-- setupIndices.ts    # Elasticsearch index definitions
¦   +-- index.ts               # CLI entry point


Run docker
docker-compose up -d

Check Elasticsearch:
curl http://localhost:9200

Check Kibana:
http://localhost:5601

Stop the Services
docker-compose down

To remove persistent data volume:
docker-compose down -v


Summary

Task	Command
Start	docker-compose up -d
Stop	docker-compose down
Stop and clear all data	docker-compose down -v
Check ES is running	curl http://localhost:9200
Open Kibana UI	http://localhost:5601

Basic Connectivity
curl http://localhost:9200

Cluster Health
curl http://localhost:9200/_cluster/health?pretty

List All Indices
curl http://localhost:9200/_cat/indices?v

Get Index Mappings
curl http://localhost:9200/_mapping?pretty

For a specific index (e.g., ted_talks):
curl http://localhost:9200/ted_talks/_mapping?pretty

View Index Settings
curl http://localhost:9200/ted_talks/_settings?pretty

Get Document Count for an Index
curl http://localhost:9200/ted_talks/_count

Or count only those with a match:
curl -X GET "localhost:9200/ted_talks/_count" -H 'Content-Type: application/json' -d'
{
  "query": {
    "match_all": {}
  }
}'

View Documents (sample)
curl http://localhost:9200/ted_talks/_search?pretty

Or limit the output:
curl -X GET "localhost:9200/ted_talks/_search?size=1&pretty"

Summary Table

Purpose	Command
Cluster status	/_cluster/health?pretty
List indices	/_cat/indices?v
Get all mappings	/_mapping?pretty
Index-specific mapping	/INDEX/_mapping?pretty
Index settings	/INDEX/_settings?pretty
Document count	/INDEX/_count
Preview data	/INDEX/_search?size=1&pretty





Setup Instructions
Install dependencies:

npm install

Configure .env:
	Set MySQL connection
	Elasticsearch URL
	Path to dataset CSVs

Initialize database:

npx prisma migrate dev --name init


Now can run this sequence

In mysql client:
DROP SCHEMA `search_gen` ;
CREATE SCHEMA `search_gen` ;

npx prisma generate
npx prisma db push

ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTed.json config/summaryTed.json


npx ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTed.json config/summaryTed.json


npx ts-node src/index.ts config/importStopwords.json config/importIndexTedKeyword.json config/importCorpusTed.json config/summaryTed.json


npx ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTedPhrase.json config/summaryTed.json





npx ts-node src/index.ts config/convertTedTalksSubset.json
npx ts-node src/index.ts config/convertEnronEmailsSubset.json

npx ts-node src/index.ts config/importIndexTed.json config/importCorpusTed.json config/summaryTed.json
npx ts-node src/index.ts config/importIndexEnron.json config/importCorpusEnron.json config/summaryEnron.json



npx ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTed.json config/summaryTed.json

npx ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTedTitle.json config/summaryTed.json

npx ts-node src/index.ts config/importStopwords.json config/importIndexTed.json config/importCorpusTedDesc.json config/summaryTed.json


npx ts-node src/index.ts config/importIndexTed.json config/importCorpusTed.json


npx ts-node src/index.ts config/importIndexTed.json
npx ts-node src/index.ts config/importCorpusTed.json
npx ts-node src/index.ts config/summaryTed.json

npx ts-node src/index.ts config/importIndexEnron.json 
npx ts-node src/index.ts config/importCorpusEnron.json 
npx ts-node src/index.ts config/summaryEnron.json



New sequence after database refactor:

[First, set up the corpus types:]
npx ts-node src/index.ts config/setupTedCorpusType.json

[Then, define the document types and fields:]
npx ts-node src/index.ts config/setupTedDocumentTypes.json

[Import stopwords, now linked to the corpus:]
npx ts-node src/index.ts config/importStopwords.json

[Set up the Elasticsearch index:]
npx ts-node src/index.ts config/importIndexTed.json

[Import the corpus data:]
npx ts-node src/index.ts config/importCorpusTed.json

[Run the summary to verify:]
npx ts-node src/index.ts config/summaryTed.json

[Optionally, create an initial snapshot:]
npx ts-node src/index.ts config/corpusSnapshotExample.json


All in one command:
npx ts-node src/index.ts config/setupTedCorpusType.json config/setupTedDocumentTypes.json config/importStopwords.json config/importIndexTed.json config/importCorpusTed.json config/summaryTed.json config/corpusSnapshotExample.json

npx ts-node src/index.ts config/searchTermTestBatch1.json config/searchTermTestBatch2.json config/searchTermTestBatchRem.json

OR

npx ts-node src/index.ts config/searchTermTestBatchAll.json

npx ts-node src/index.ts config/exhaustiveSearchMaxHits.json

npx ts-node src/index.ts config/exhaustiveSearchMinHits.json

npx ts-node src/index.ts config/exhaustiveSearchRandom.json



[Run the first batch:]
npx ts-node src/index.ts config/searchTermTestBatch1.json

[Run the next batch:]
npx ts-node src/index.ts config/searchTermTestBatch2.json

[Run the remaining:]
npx ts-node src/index.ts config/searchTermTestBatchRem.json



[Run the remaining:]
npx ts-node src/index.ts config/searchTermTestBatchAll.json


[run exh search test]
npx ts-node src/index.ts config/exhaustiveSearchMaxHits.json



#!/bin/bash
# Enron Dataset Processing Sequence
# Copy these commands to execute them one by one

# NOTE: Before running these commands, ensure you have:
# 1. The Enron emails dataset converted to JSON using convertEnronEmails
# 2. Elasticsearch running
# 3. A file named 'email_stopwords.txt' in your data directory

# Step 1: Setup corpus type
npx ts-node src/index.ts config/setupEnronCorpusType.json

# Step 2: Setup document types
npx ts-node src/index.ts config/setupEnronDocumentTypes.json

# Step 3: Import stopwords
npx ts-node src/index.ts config/importStopwordsEnron.json

# Step 4: Set up Elasticsearch index
npx ts-node src/index.ts config/importIndexEnron.json

# Step 5: Import corpus data
npx ts-node src/index.ts config/importCorpusEnron.json

# Step 6: Generate corpus summary
npx ts-node src/index.ts config/summaryEnron.json

# Step 7: Create corpus snapshot (baseline)
npx ts-node src/index.ts config/enronSnapshotOperation.json

# Step 8: Run search term tests in batches
npx ts-node src/index.ts config/enronTermTestBatch1.json
# Check results before continuing

npx ts-node src/index.ts config/enronTermTestBatch2.json
# Check results before continuing

npx ts-node src/index.ts config/enronTermTestRemaining.json

# Step 9: Run keyword search example
npx ts-node src/index.ts config/enronKeywordSearch.json

# --- Running multiple operations in sequence ---
# For initial setup (through corpus import):
npx ts-node src/index.ts config/setupEnronCorpusType.json config/setupEnronDocumentTypes.json config/importStopwordsEnron.json config/importIndexEnron.json config/importCorpusEnron.json config/summaryEnron.json

# For operations and testing:
npx ts-node src/index.ts config/enronSnapshotOperation.json config/enronTermTestBatch1.json

npx ts-node src/index.ts config/enronSnapshotOperation.json config/enronTermTestBatch1.json config/enronTermTestBatch2.json config/enronTermTestRem.json




-- SQL query to get record counts for all tables in the database
SELECT 
  table_name, 
  table_rows,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM 
  information_schema.tables
WHERE 
  table_schema = 'search_gen' -- Replace with your database name if different
ORDER BY 
  table_rows DESC, size_mb DESC;

-- For more accurate counts (tables may have estimated counts in information_schema)
-- You can run this second query which gets exact counts but is slower:

SELECT 'Corpus' AS table_name, COUNT(*) AS row_count FROM `Corpus`
UNION
SELECT 'CorpusType' AS table_name, COUNT(*) AS row_count FROM `CorpusType`
UNION
SELECT 'CorpusDocumentType' AS table_name, COUNT(*) AS row_count FROM `CorpusDocumentType`
UNION
SELECT 'Document' AS table_name, COUNT(*) AS row_count FROM `Document`
UNION
SELECT 'DocumentTypeField' AS table_name, COUNT(*) AS row_count FROM `DocumentTypeField`
UNION
SELECT 'SearchTerm' AS table_name, COUNT(*) AS row_count FROM `SearchTerm`
UNION
SELECT 'Stopword' AS table_name, COUNT(*) AS row_count FROM `Stopword`
UNION
SELECT 'CorpusSetOperation' AS table_name, COUNT(*) AS row_count FROM `CorpusSetOperation`
UNION
SELECT 'CorpusDocumentSet' AS table_name, COUNT(*) AS row_count FROM `CorpusDocumentSet`
UNION
SELECT 'SetDocument' AS table_name, COUNT(*) AS row_count FROM `SetDocument`
UNION
SELECT 'SetMetrics' AS table_name, COUNT(*) AS row_count FROM `SetMetrics`
UNION
SELECT 'DocumentMetrics' AS table_name, COUNT(*) AS row_count FROM `DocumentMetrics`
ORDER BY row_count DESC;





After 1st batch:

searchterm	981	0.19
setdocument	913	0.09
documentmetrics	713	0.08
document	200	0.08
stopword	190	0.05
corpusdocumentset	51	0.05
setmetrics	51	0.03
documenttypefield	7	0.03
corpussetoperation	2	0.03
corpus	1	0.05
corpusdocumenttype	1	0.05
corpustype	1	0.05

After 2nd batch (not refreshing) ?:


searchterm	981	0.19
setdocument	913	0.09
documentmetrics	713	0.08
document	200	0.08
stopword	190	0.05
corpusdocumentset	51	0.05
setmetrics	51	0.03
documenttypefield	7	0.03
corpussetoperation	2	0.03
corpus	1	0.05
corpusdocumenttype	1	0.05
corpustype	1	0.05
















ts-node src/index.ts config/importStopwordsConvert.json


npx ts-node src/index.ts config/importStopwordsConvert.json

curl -X POST "localhost:9200/ted_talks/_search?pretty" -H "Content-Type: application/json" --data "@config/testagg.json"

curl -X POST "localhost:9200/ted_talks/_search?pretty" -H "Content-Type: application/json" --data "@config/testagg3.json"

curl -X POST "localhost:9200/ted_talks/_search?pretty" -H "Content-Type: application/json" --data "@config/testagg-title.json"


