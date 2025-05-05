// === src/setup/loadBoostCategories.ts ===
import fs from 'fs';
import path from 'path';
import { PrismaClient, TermBoostMode } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const DATA_PATH = process.env.DATA_PATH || './data';

interface BoostTerm {
  term: string;
  boost: number;
  boostMode: TermBoostMode;
}

interface BoostCategory {
  name: string;
  boost: number;
  terms: BoostTerm[];
}

/**
 * Load boost categories and terms from a JSON file
 */
export async function loadBoostCategories(
  filename: string = 'boost-categories.json',
  deleteExisting: boolean = false
): Promise<void> {
  const filePath = path.join(DATA_PATH, filename);
  
  try {
    // Read the file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const categories: BoostCategory[] = JSON.parse(fileContent);
    
    console.log(`Loaded ${categories.length} categories from ${filePath}`);
    
    // Delete existing categories if requested
    if (deleteExisting) {
      console.log('Deleting existing categories...');
      await prisma.termBoost.deleteMany({});
      await prisma.termBoostCategory.deleteMany({});
    }
    
    // Create categories
    for (const category of categories) {
      console.log(`Processing category "${category.name}" with ${category.terms.length} terms`);
      
      // Create or update the category
      const dbCategory = await prisma.termBoostCategory.upsert({
        where: { name: category.name },
        update: { boost: category.boost },
        create: {
          name: category.name,
          boost: category.boost
        }
      });
      
      // Create terms for this category
      for (const term of category.terms) {
        await prisma.termBoost.upsert({
          where: {
            term_categoryId: {
              term: term.term,
              categoryId: dbCategory.id
            }
          },
          update: {
            boost: term.boost,
            boostMode: term.boostMode
          },
          create: {
            term: term.term,
            boost: term.boost,
            boostMode: term.boostMode,
            categoryId: dbCategory.id
          }
        });
      }
      
      console.log(`Created/updated category "${category.name}" with ID ${dbCategory.id}`);
    }
    
    console.log('Boost categories and terms loaded successfully');
  } catch (error) {
    console.error('Error loading boost categories:', error);
    throw error;
  }
}

// If this file is run directly, execute the load
if (require.main === module) {
  loadBoostCategories()
    .catch(e => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
