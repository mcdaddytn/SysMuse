#!/bin/bash

echo "=========================================="
echo "Testing Multi-Pass Parser Implementation"
echo "=========================================="

echo "1. Backing up current database state..."
./db/backupdb.sh before-multipass

echo "2. Resetting database..."
npx prisma db push --force-reset
npx prisma generate

echo "3. Loading seed data..."
npm run seed

echo "4. Running multi-pass parser..."
npm run cli parse --phase1 --config config/example-trial-config-mac.json --parser-mode multi-pass --debug-output

echo "5. Getting record counts after multi-pass..."
docker exec judicial-postgres psql -U judicial_user -d judicial_transcripts -c "SELECT 'Multi-Pass Results:' as label; SELECT table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count FROM (SELECT table_name, table_schema, query_to_xml(format('SELECT count(*) as cnt FROM %I.%I', table_schema, table_name), false, true, '') as xml_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') t ORDER BY table_name;"

echo "6. Comparing with baseline..."
echo "Baseline totals: 65,560 records"
echo "Check docs/baseline-record-counts.md for detailed comparison"

echo "=========================================="
echo "Test Complete"
echo "=========================================="