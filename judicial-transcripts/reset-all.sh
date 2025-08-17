#!/bin/bash

# Simple reset script using exact commands that work

echo "========================================="
echo "Judicial Transcripts - Complete Reset"
echo "========================================="
echo ""

echo "Step 1: Generate Prisma Client (if schema changed)"
npm run prisma:generate

echo ""
echo "Step 2: Clear database and push schema"
npx prisma db push --force-reset

echo ""
echo "Step 3: Seed database"
npm run seed

echo ""
echo "Step 4: Reset Elasticsearch"
npm run es:reset -- --force

echo ""
echo "========================================="
echo "Reset Complete!"
echo "========================================="