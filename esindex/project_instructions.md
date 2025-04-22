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

