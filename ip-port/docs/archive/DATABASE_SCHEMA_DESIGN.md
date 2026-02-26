# Database Schema Design

## Overview

This document defines the PostgreSQL schema (via Prisma ORM) for the IP Portfolio Analysis Platform, incorporating:
- Patent data and scoring
- Company classification (including aggregator detection)
- Patent clusters
- Citation relationships
- Vendor analysis integration
- Expert review tracking

---

## Entity Relationship Diagram

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Patent    │────<│ PatentCitation  │>────│   Company    │
└─────────────┘     └─────────────────┘     └──────────────┘
       │                                           │
       │            ┌─────────────────┐            │
       └───────────<│ PatentCompany   │>───────────┘
                    └─────────────────┘
       │
       │            ┌─────────────────┐
       ├───────────<│ PatentCluster   │
       │            └─────────────────┘
       │                    │
       │            ┌───────┴───────┐
       │            │    Cluster    │
       │            └───────────────┘
       │
       │            ┌─────────────────┐
       ├───────────<│  PatentScore   │
       │            └─────────────────┘
       │
       │            ┌─────────────────┐
       ├───────────<│ VendorAnalysis │
       │            └─────────────────┘
       │                    │
       │            ┌───────┴───────┐
       │            │ ProductMatch  │
       │            └───────────────┘
       │
       │            ┌─────────────────┐
       └───────────<│  ExpertReview  │
                    └─────────────────┘
```

---

## Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// =============================================================================
// CORE ENTITIES
// =============================================================================

model Patent {
  id                    String   @id @default(cuid())
  patentId              String   @unique @map("patent_id")
  title                 String
  abstract              String?
  grantDate             DateTime @map("grant_date")
  expirationDate        DateTime @map("expiration_date")
  yearsRemaining        Float    @map("years_remaining")

  // Ownership
  assignee              String?
  assigneeNormalized    String?  @map("assignee_normalized")

  // Citation metrics
  forwardCitations      Int      @default(0) @map("forward_citations")
  competitorCitations   Int      @default(0) @map("competitor_citations")

  // Technical classification
  primaryCpc            String?  @map("primary_cpc")
  cpcCodes              String[] @map("cpc_codes")

  // Sector assignment
  sector                String?
  sectorName            String?  @map("sector_name")
  sectorSource          String?  @map("sector_source") // term | mlt | cpc | llm

  // LLM analysis scores (1-5)
  eligibilityScore      Float?   @map("eligibility_score")
  validityScore         Float?   @map("validity_score")
  claimBreadth          Float?   @map("claim_breadth")
  enforcementClarity    Float?   @map("enforcement_clarity")
  designAroundDifficulty Float?  @map("design_around_difficulty")
  marketRelevanceScore  Float?   @map("market_relevance_score")

  // IPR & Prosecution
  iprRiskScore          Float?   @map("ipr_risk_score")
  prosecutionQualityScore Float? @map("prosecution_quality_score")

  // V3 LLM signals
  implementationType    String?  @map("implementation_type")
  standardsRelevance    String?  @map("standards_relevance")
  claimTypePrimary      String?  @map("claim_type_primary")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  // Relations
  scores                PatentScore[]
  citations             PatentCitation[]
  citedBy               PatentCitation[]  @relation("CitedPatent")
  companyRelations      PatentCompany[]
  clusterMemberships    PatentCluster[]
  vendorAnalyses        VendorAnalysis[]
  expertReviews         ExpertReview[]

  @@map("patents")
  @@index([patentId])
  @@index([sector])
  @@index([yearsRemaining])
  @@index([competitorCitations])
}

model Company {
  id                    String   @id @default(cuid())
  name                  String   @unique
  normalizedName        String   @map("normalized_name")
  patterns              String[] // Matching patterns for this company

  // Classification
  companyType           CompanyType @default(UNKNOWN) @map("company_type")
  aggregatorScore       Float    @default(0) @map("aggregator_score") // 0-1

  // Industry
  industry              String?
  sectors               String[] // Sectors this company operates in

  // Size & Financials (optional enrichment)
  marketCap             String?  @map("market_cap") // small | medium | large | mega
  employeeCount         Int?     @map("employee_count")
  annualRevenue         String?  @map("annual_revenue")

  // Patent portfolio
  portfolioSize         Int?     @map("portfolio_size")
  annualFilings         Int?     @map("annual_filings")

  // Litigation history
  litigationAsDefendant Int      @default(0) @map("litigation_as_defendant")
  litigationAsPlaintiff Int      @default(0) @map("litigation_as_plaintiff")
  settlementRate        Float?   @map("settlement_rate")

  // Our tracking
  isCompetitor          Boolean  @default(false) @map("is_competitor")
  onWatchlist           Boolean  @default(false) @map("on_watchlist")
  watchlistCategory     String?  @map("watchlist_category")
  competitorCategory    String?  @map("competitor_category") // from competitors.json

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  // Relations
  patentRelations       PatentCompany[]
  citationsToUs         PatentCitation[]

  @@map("companies")
  @@index([normalizedName])
  @@index([companyType])
  @@index([isCompetitor])
}

enum CompanyType {
  PRACTICING    // Makes products/services
  AGGREGATOR    // NPE/PAE - licensing/litigation focused
  HYBRID        // Both practicing and aggressive licensing
  UNIVERSITY    // Academic institution
  GOVERNMENT    // Government entity
  UNKNOWN
}

// =============================================================================
// RELATIONSHIPS
// =============================================================================

model PatentCitation {
  id                    String   @id @default(cuid())

  // Our patent being cited
  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  // The citing patent (may or may not be in our system)
  citingPatentId        String   @map("citing_patent_id")
  citingPatent          Patent?  @relation("CitedPatent", fields: [citingPatentId], references: [id])
  citingPatentNumber    String   @map("citing_patent_number")
  citingPatentTitle     String?  @map("citing_patent_title")

  // Citator company
  companyId             String?  @map("company_id")
  company               Company? @relation(fields: [companyId], references: [id])
  assigneeRaw           String   @map("assignee_raw")

  // Citation metadata
  citationDate          DateTime? @map("citation_date")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")

  @@map("patent_citations")
  @@unique([patentId, citingPatentNumber])
  @@index([patentId])
  @@index([companyId])
}

model PatentCompany {
  id                    String   @id @default(cuid())

  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  companyId             String   @map("company_id")
  company               Company  @relation(fields: [companyId], references: [id])

  // Relationship type
  relationshipType      CompanyRelationType @map("relationship_type")

  // Citation metrics (if citator)
  citationCount         Int      @default(0) @map("citation_count")
  citingPatentCount     Int      @default(0) @map("citing_patent_count")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("patent_companies")
  @@unique([patentId, companyId, relationshipType])
  @@index([patentId])
  @@index([companyId])
}

enum CompanyRelationType {
  CITATOR       // Company cites this patent
  ASSIGNEE      // Company owns/owned this patent
  DEFENDANT     // Identified as potential defendant
  LICENSEE      // Has license to this patent
}

// =============================================================================
// CLUSTERS
// =============================================================================

model Cluster {
  id                    String   @id @default(cuid())
  clusterId             Int      @unique @map("cluster_id")
  name                  String

  // Cluster characteristics
  clusterType           ClusterType @map("cluster_type")
  patentCount           Int      @map("patent_count")

  // Term-based clusters
  centroidTerms         Json?    @map("centroid_terms") // [{term, weight}]
  dominantCpcs          String[] @map("dominant_cpcs")
  intraClusterSimilarity Float?  @map("intra_cluster_similarity")

  // Co-citation clusters
  coCitationCount       Int?     @map("co_citation_count")

  // Competitive context
  totalCompetitorCitations Int   @default(0) @map("total_competitor_citations")
  topCompanies          Json?    @map("top_companies") // [{company, patents}]

  // Analysis status
  heatMapTested         Boolean  @default(false) @map("heat_map_tested")
  claimChartPrepared    Boolean  @default(false) @map("claim_chart_prepared")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  // Relations
  patents               PatentCluster[]

  @@map("clusters")
  @@index([clusterType])
}

enum ClusterType {
  TERM_BASED    // Based on claim/abstract term analysis
  CO_CITATION   // Based on patents cited together
  CPC_BASED     // Based on CPC classification
  MANUAL        // Manually created group
}

model PatentCluster {
  id                    String   @id @default(cuid())

  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  clusterId             String   @map("cluster_id")
  cluster               Cluster  @relation(fields: [clusterId], references: [id])

  // Role in cluster
  isChampion            Boolean  @default(false) @map("is_champion") // Selected as representative
  similarityScore       Float?   @map("similarity_score")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")

  @@map("patent_clusters")
  @@unique([patentId, clusterId])
  @@index([patentId])
  @@index([clusterId])
}

// =============================================================================
// SCORING
// =============================================================================

model PatentScore {
  id                    String   @id @default(cuid())

  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  // Score identification
  scoreVersion          String   @map("score_version") // v2, v3, custom
  profileId             String?  @map("profile_id") // stakeholder profile
  profileName           String?  @map("profile_name")

  // Scores
  finalScore            Float    @map("final_score")
  consensusRank         Int?     @map("consensus_rank")
  profileRank           Int?     @map("profile_rank")

  // Factor breakdown (JSON for flexibility)
  factorScores          Json?    @map("factor_scores")

  // Timestamps
  calculatedAt          DateTime @default(now()) @map("calculated_at")

  @@map("patent_scores")
  @@unique([patentId, scoreVersion, profileId])
  @@index([patentId])
  @@index([scoreVersion])
  @@index([finalScore])
}

// =============================================================================
// VENDOR INTEGRATION
// =============================================================================

model VendorAnalysis {
  id                    String   @id @default(cuid())

  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  // Vendor info
  vendorName            String   @map("vendor_name")
  analysisType          AnalysisType @map("analysis_type")

  // Analysis details
  analysisDate          DateTime @map("analysis_date")
  cost                  Float?

  // Results
  rawResponse           Json?    @map("raw_response")
  recommendationScore   Float?   @map("recommendation_score") // 1-5
  recommendation        String?  // HIGH_PRIORITY, MEDIUM, LOW, SKIP

  // Parsed summary
  summary               String?
  keyFindings           Json?    @map("key_findings")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")

  // Relations
  productMatches        ProductMatch[]
  claimMappings         ClaimMapping[]

  @@map("vendor_analyses")
  @@index([patentId])
  @@index([vendorName])
  @@index([analysisType])
}

enum AnalysisType {
  HEAT_MAP
  CLAIM_CHART
  INVALIDITY
  FREEDOM_TO_OPERATE
  LANDSCAPE
}

model ProductMatch {
  id                    String   @id @default(cuid())

  vendorAnalysisId      String   @map("vendor_analysis_id")
  vendorAnalysis        VendorAnalysis @relation(fields: [vendorAnalysisId], references: [id])

  // Product info
  productName           String   @map("product_name")
  companyName           String   @map("company_name")
  marketSegment         String?  @map("market_segment")

  // Match quality
  matchConfidence       Float    @map("match_confidence") // 0-1
  claimElementsMatched  String[] @map("claim_elements_matched")

  // Market data
  revenueEstimate       String?  @map("revenue_estimate")
  marketShare           Float?   @map("market_share")

  // Evidence
  evidenceUrls          String[] @map("evidence_urls")
  evidenceSummary       String?  @map("evidence_summary")

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")

  @@map("product_matches")
  @@index([vendorAnalysisId])
  @@index([companyName])
}

model ClaimMapping {
  id                    String   @id @default(cuid())

  vendorAnalysisId      String   @map("vendor_analysis_id")
  vendorAnalysis        VendorAnalysis @relation(fields: [vendorAnalysisId], references: [id])

  // Target
  defendant             String
  product               String
  claimNumber           Int      @map("claim_number")

  // Mapping details
  elementMappings       Json     @map("element_mappings") // [{elementId, claimText, evidence, confidence}]
  overallScore          Float    @map("overall_score") // 1-5
  mappingStrength       String   @map("mapping_strength") // STRONG, MODERATE, WEAK

  // Risk assessment
  validityConcerns      String[] @map("validity_concerns")
  designAroundRisk      String   @map("design_around_risk") // LOW, MEDIUM, HIGH

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")

  @@map("claim_mappings")
  @@index([vendorAnalysisId])
  @@index([defendant])
}

// =============================================================================
// EXPERT REVIEW
// =============================================================================

model ExpertReview {
  id                    String   @id @default(cuid())

  patentId              String   @map("patent_id")
  patent                Patent   @relation(fields: [patentId], references: [id])

  // Reviewer
  reviewerName          String   @map("reviewer_name")
  reviewerExpertise     String?  @map("reviewer_expertise")

  // Review details
  reviewType            ReviewType @map("review_type")
  reviewDate            DateTime @map("review_date")
  timeSpentHours        Float?   @map("time_spent_hours")

  // Scores
  overallScore          Float    @map("overall_score") // 1-5
  confidenceScore       Float    @map("confidence_score") // 1-5

  // Findings
  notes                 String?
  keyFindings           Json?    @map("key_findings")
  recommendations       Json?

  // Status
  status                ReviewStatus @default(DRAFT)

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("expert_reviews")
  @@index([patentId])
  @@index([reviewType])
  @@index([status])
}

enum ReviewType {
  VALIDITY
  INFRINGEMENT
  DAMAGES
  TECHNICAL
  CLAIM_CONSTRUCTION
  PRIOR_ART
}

enum ReviewStatus {
  DRAFT
  IN_PROGRESS
  FINAL
  ARCHIVED
}

// =============================================================================
// LITIGATION TRACKING
// =============================================================================

model AssertionPackage {
  id                    String   @id @default(cuid())
  name                  String

  // Target
  defendant             String
  defendantCompanyId    String?  @map("defendant_company_id")

  // Patents included
  patentIds             String[] @map("patent_ids")

  // Status
  status                PackageStatus @default(DRAFT)

  // Assessment
  strengthScore         Float?   @map("strength_score")
  damagesEstimateLow    Float?   @map("damages_estimate_low")
  damagesEstimateHigh   Float?   @map("damages_estimate_high")
  suggestedForum        String?  @map("suggested_forum")

  // Key factors
  keyStrengths          Json?    @map("key_strengths")
  keyRisks              Json?    @map("key_risks")

  // Notes
  notes                 String?

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("assertion_packages")
  @@index([defendant])
  @@index([status])
}

enum PackageStatus {
  DRAFT
  UNDER_REVIEW
  APPROVED
  SENT
  NEGOTIATING
  SETTLED
  LITIGATION
  CLOSED
}
```

---

## Migration Strategy

### Phase 1: Core Tables
```bash
# Create initial migration
npx prisma migrate dev --name init_core_tables

# Tables: Patent, Company, PatentCitation, PatentCompany
```

### Phase 2: Clusters & Scoring
```bash
npx prisma migrate dev --name add_clusters_scoring

# Tables: Cluster, PatentCluster, PatentScore
```

### Phase 3: Vendor Integration
```bash
npx prisma migrate dev --name add_vendor_integration

# Tables: VendorAnalysis, ProductMatch, ClaimMapping
```

### Phase 4: Expert Review & Assertions
```bash
npx prisma migrate dev --name add_expert_assertions

# Tables: ExpertReview, AssertionPackage
```

---

## Data Import Scripts

### Import from JSON outputs

```typescript
// scripts/import-to-database.ts

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function importPatents() {
  // Load multi-score analysis
  const msData = JSON.parse(fs.readFileSync('output/multi-score-analysis-2026-01-19.json', 'utf-8'));

  for (const p of msData.patents) {
    await prisma.patent.upsert({
      where: { patentId: p.patent_id },
      update: { /* update fields */ },
      create: {
        patentId: p.patent_id,
        title: p.title,
        // ... map all fields
      }
    });
  }
}

async function importCompanies() {
  // Load competitors.json
  const competitors = JSON.parse(fs.readFileSync('config/competitors.json', 'utf-8'));

  for (const [category, data] of Object.entries(competitors.categories)) {
    for (const company of data.companies) {
      await prisma.company.upsert({
        where: { name: company.name },
        update: { patterns: company.patterns },
        create: {
          name: company.name,
          normalizedName: company.name.toLowerCase(),
          patterns: company.patterns,
          companyType: 'PRACTICING',
          isCompetitor: true,
          competitorCategory: category,
        }
      });
    }
  }
}

async function importClusters() {
  const clusters = JSON.parse(fs.readFileSync('output/clusters/cluster-definitions-2026-01-17.json', 'utf-8'));

  for (const c of clusters.clusters) {
    const cluster = await prisma.cluster.upsert({
      where: { clusterId: c.id },
      update: { /* update */ },
      create: {
        clusterId: c.id,
        name: c.name,
        clusterType: 'TERM_BASED',
        patentCount: c.patentCount,
        centroidTerms: c.centroidTerms,
        dominantCpcs: c.dominantCPCs,
        totalCompetitorCitations: c.totalCompetitorCitations,
        topCompanies: c.uniqueCompetitors,
      }
    });

    // Link patents to cluster
    for (const patentId of c.patentIds) {
      const patent = await prisma.patent.findUnique({
        where: { patentId }
      });

      if (patent) {
        await prisma.patentCluster.upsert({
          where: {
            patentId_clusterId: {
              patentId: patent.id,
              clusterId: cluster.id
            }
          },
          update: {},
          create: {
            patentId: patent.id,
            clusterId: cluster.id,
          }
        });
      }
    }
  }
}
```

---

## API Endpoints (Future)

```
GET    /patents              - List patents with filters
GET    /patents/:id          - Get patent details
GET    /patents/:id/citations - Get citation relationships
GET    /patents/:id/scores   - Get all scores for patent

GET    /companies            - List companies
GET    /companies/:id        - Get company details
GET    /companies/:id/citations - Get patents this company cites
PATCH  /companies/:id        - Update company classification

GET    /clusters             - List clusters
GET    /clusters/:id         - Get cluster with patents
POST   /clusters/:id/champion - Set champion patent for cluster

POST   /vendor-analyses      - Record vendor analysis
GET    /vendor-analyses/:patentId - Get analyses for patent

POST   /expert-reviews       - Create expert review
PATCH  /expert-reviews/:id   - Update review

POST   /assertion-packages   - Create assertion package
GET    /assertion-packages   - List packages with filters
```

---

*Last Updated: 2026-01-19*
*Version: 1.0*
