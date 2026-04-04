/**
 * Create USPTO Index Database
 *
 * Creates the ip_portfolio_uspto database if it doesn't exist,
 * then runs prisma db push to create/sync tables.
 *
 * Usage:
 *   npx tsx scripts/create-uspto-db.ts
 */
import 'dotenv/config';
import { execSync } from 'child_process';

const DB_NAME = 'ip_portfolio_uspto';
const DB_USER = 'ip_admin';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ip_dev_password';
const DOCKER_CONTAINER = 'ip-port-postgres';

async function main() {
  console.log(`Creating database "${DB_NAME}" if it doesn't exist...`);

  try {
    // Use docker exec to run psql inside the postgres container
    const checkResult = execSync(
      `docker exec ${DOCKER_CONTAINER} psql -U ${DB_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (checkResult === '1') {
      console.log(`Database "${DB_NAME}" already exists.`);
    } else {
      execSync(
        `docker exec ${DOCKER_CONTAINER} psql -U ${DB_USER} -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"`,
        { encoding: 'utf-8', stdio: 'inherit' }
      );
      console.log(`Database "${DB_NAME}" created.`);
    }
  } catch (err: any) {
    console.error(`Failed to create database: ${err.message}`);
    console.error('Make sure the Docker postgres container is running (docker compose up -d postgres).');
    process.exit(1);
  }

  // Run prisma generate first (needed before db push)
  console.log('\nRunning prisma generate...');
  try {
    execSync('npx prisma generate --schema=prisma/uspto/schema.prisma', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    console.log('Client generated successfully.');
  } catch (err: any) {
    console.error(`Failed to generate client: ${err.message}`);
    process.exit(1);
  }

  // Run prisma db push to create/sync tables
  console.log('\nRunning prisma db push...');
  try {
    execSync('npx prisma db push --schema=prisma/uspto/schema.prisma', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    console.log('Schema synced successfully.');
  } catch (err: any) {
    console.error(`Failed to push schema: ${err.message}`);
    process.exit(1);
  }

  console.log('\nUSPTO index database is ready.');
}

main();
