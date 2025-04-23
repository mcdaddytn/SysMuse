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



ts-node src/index.ts config/importStopwordsConvert.json


npx ts-node src/index.ts config/importStopwordsConvert.json


