// === src/lib/termBooster.ts ===
import { PrismaClient, TermBoostMode } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

interface BoostCategory {
  id: number;
  name: string;
  boost: number;
  terms: BoostTerm[];
}

interface BoostTerm {
  term: string;
  boost: number;
  boostMode: TermBoostMode;
}

/**
 * Manages term boosting based on categories and specific terms
 */
export class TermBooster {
  private categories: BoostCategory[] = [];
  private exactMatchMap: Map<string, number> = new Map();
  private containsTerms: BoostTerm[] = [];

  constructor() {}

  /**
   * Load boost categories and terms from the database
   * @param categoryNames Optional array of category names to load (loads all if not specified)
   */
  public async loadCategories(categoryNames?: string[]): Promise<void> {
    // Reset state
    this.categories = [];
    this.exactMatchMap.clear();
    this.containsTerms = [];

    try {
      // Query categories from database
      const categories = await prisma.termBoostCategory.findMany({
        where: categoryNames?.length ? { name: { in: categoryNames } } : undefined,
        include: {
          termBoosts: true
        }
      });

      // Process categories and terms
      for (const category of categories) {
        const boostCategory: BoostCategory = {
          id: category.id,
          name: category.name,
          boost: category.boost,
          terms: []
        };

        // Process terms in this category
        for (const termBoost of category.termBoosts) {
          const boostTerm: BoostTerm = {
            term: termBoost.term,
            boost: termBoost.boost,
            boostMode: termBoost.boostMode
          };

          boostCategory.terms.push(boostTerm);

          // Add to appropriate lookup structure
          if (termBoost.boostMode === 'EXACT') {
            const combinedBoost = category.boost * termBoost.boost;
            this.exactMatchMap.set(termBoost.term.toLowerCase(), combinedBoost);
          } else {
            this.containsTerms.push({
              term: termBoost.term.toLowerCase(),
              boost: termBoost.boost * category.boost,
              boostMode: 'CONTAINS'
            });
          }
        }

        this.categories.push(boostCategory);
      }

      console.log(`Loaded ${this.categories.length} boost categories with ${this.exactMatchMap.size} exact match terms and ${this.containsTerms.length} contains terms`);
    } catch (error) {
      console.error('Error loading term boost categories:', error);
    }
  }

  /**
   * Get the boost factor for a specific term
   * @param term The term to get the boost for
   * @returns The boost factor (default: 1.0)
   */
  public getBoostForTerm(term: string): number {
    const lowerTerm = term.toLowerCase();
    
    // Check for exact match first
    const exactBoost = this.exactMatchMap.get(lowerTerm);
    if (exactBoost !== undefined) {
      return exactBoost;
    }
    
    // Check for contains matches (for multi-word terms)
    if (term.includes(' ')) {
      let highestBoost = 1.0;
      
      for (const boostTerm of this.containsTerms) {
        if (lowerTerm.includes(boostTerm.term)) {
          // Update if this boost is higher
          if (boostTerm.boost > highestBoost) {
            highestBoost = boostTerm.boost;
          }
        }
      }
      
      return highestBoost;
    }
    
    // Default boost
    return 1.0;
  }

  /**
   * Add a new boost category
   * @param name Category name
   * @param boost Default boost factor
   */
  public async addCategory(name: string, boost: number = 1.0): Promise<number> {
    try {
      const category = await prisma.termBoostCategory.create({
        data: {
          name,
          boost
        }
      });
      
      await this.loadCategories(); // Reload categories
      return category.id;
    } catch (error) {
      console.error(`Error creating boost category "${name}":`, error);
      throw error;
    }
  }

  /**
   * Add a term to a boost category
   * @param categoryId Category ID
   * @param term Term text
   * @param boost Boost factor
   * @param boostMode Boost mode (EXACT or CONTAINS)
   */
  public async addTerm(
    categoryId: number, 
    term: string, 
    boost: number = 1.0, 
    boostMode: TermBoostMode = 'EXACT'
  ): Promise<void> {
    try {
      await prisma.termBoost.create({
        data: {
          term,
          boost,
          boostMode,
          category: { connect: { id: categoryId } }
        }
      });
      
      await this.loadCategories(); // Reload categories
    } catch (error) {
      console.error(`Error adding boost term "${term}":`, error);
      throw error;
    }
  }
}
