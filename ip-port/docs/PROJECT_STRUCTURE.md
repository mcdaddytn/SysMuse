# IP-PORT Project - Complete File Structure

## Project Overview
**Project Name:** `ip-port`
**Description:** TypeScript clients for USPTO Patent Data APIs with production-ready portfolio analysis tools

## Complete Directory Structure

```
ip-port/
├── README.md                                    # Main project overview
├── PACKAGE_SUMMARY.md                           # Package contents and features
├── CLAUDE_CODE_GUIDE.md                         # Quick start for Claude Code
├── BROADCOM_CASE_STUDY_SUMMARY.md              # Broadcom case study overview
├── package.json                                 # NPM dependencies and scripts
├── tsconfig.json                                # TypeScript configuration
├── .env.example                                 # Environment variables template
├── .env                                         # Your API keys (create from .env.example)
├── .gitignore                                   # Git ignore file (node_modules, .env, etc.)
│
├── clients/                                     # API Client Libraries
│   ├── base-client.ts                          # Shared HTTP client, rate limiting, retry logic
│   ├── patentsview-client.ts                   # PatentsView API client
│   ├── odp-file-wrapper-client.ts              # File Wrapper/Prosecution History API client
│   └── odp-ptab-client.ts                      # PTAB/IPR API client
│
├── config/                                      # Configuration Files
│   └── broadcom-assignees.json                 # Broadcom assignee name variants (35+ variants)
│
├── docs/                                        # Documentation
│   ├── API_REFERENCE.md                        # Complete API documentation (all 3 APIs)
│   ├── CASE_STUDY_BROADCOM.md                  # Broadcom portfolio case study (15+ pages)
│   └── BROADCOM_QUICK_START.md                 # Quick start guide for Broadcom builder
│
├── examples/                                    # Example Scripts & Tests
│   ├── test-patentsview.ts                     # Test PatentsView API connection
│   ├── test-file-wrapper.ts                    # Test File Wrapper API connection
│   ├── test-ptab.ts                            # Test PTAB API connection
│   ├── comprehensive-patent-analysis.ts         # Full workflow example (all 3 APIs)
│   └── broadcom-portfolio-builder.ts           # Production Broadcom portfolio builder
│
├── types/                                       # TypeScript Type Definitions (optional)
│   ├── patentsview-types.ts                    # PatentsView response types (if separated)
│   ├── file-wrapper-types.ts                   # File Wrapper response types (if separated)
│   └── ptab-types.ts                           # PTAB response types (if separated)
│
├── output/                                      # Generated Output Files (created at runtime)
│   ├── broadcom-portfolio-YYYY-MM-DD.json      # Portfolio data (generated)
│   └── broadcom-patents-YYYY-MM-DD.csv         # Patent list CSV (generated)
│
├── node_modules/                                # NPM dependencies (install with npm install)
│   └── ...
│
└── dist/                                        # Compiled TypeScript (if using build)
    └── ...
```

## File Descriptions

### Root Level Files

| File | Purpose | Size |
|------|---------|------|
| `README.md` | Main project documentation and overview | ~5 KB |
| `PACKAGE_SUMMARY.md` | Summary of what's included in the package | ~8 KB |
| `CLAUDE_CODE_GUIDE.md` | Quick start guide for using with Claude Code | ~6 KB |
| `BROADCOM_CASE_STUDY_SUMMARY.md` | Overview of Broadcom case study implementation | ~7 KB |
| `package.json` | NPM configuration, dependencies, scripts | ~1 KB |
| `tsconfig.json` | TypeScript compiler configuration | ~1 KB |
| `.env.example` | Template for environment variables | <1 KB |
| `.env` | Your actual API keys (YOU CREATE THIS) | <1 KB |
| `.gitignore` | Git ignore patterns | <1 KB |

### `/clients` - API Client Libraries (4 files)

| File | Purpose | Lines | Key Features |
|------|---------|-------|--------------|
| `base-client.ts` | Shared HTTP functionality | ~250 | Rate limiting, retry logic, error handling |
| `patentsview-client.ts` | PatentsView API wrapper | ~400 | Patent search, citations, pagination |
| `odp-file-wrapper-client.ts` | File Wrapper API wrapper | ~350 | Prosecution history, office actions, documents |
| `odp-ptab-client.ts` | PTAB API wrapper | ~350 | IPR proceedings, PTAB decisions, trials |

### `/config` - Configuration Files (1 file)

| File | Purpose | Contents |
|------|---------|----------|
| `broadcom-assignees.json` | Broadcom assignee variants | 7 entities, 35+ name variants, acquisition dates |

### `/docs` - Documentation (3 files)

| File | Purpose | Pages | Topics |
|------|---------|-------|--------|
| `API_REFERENCE.md` | Complete API reference | ~30 | All endpoints, query syntax, examples |
| `CASE_STUDY_BROADCOM.md` | Broadcom case study | ~15 | Problem, solution, implementation, results |
| `BROADCOM_QUICK_START.md` | Quick start guide | ~8 | Setup, run instructions, customization |

### `/examples` - Example Scripts (5 files)

| File | Purpose | Runtime | What It Does |
|------|---------|---------|--------------|
| `test-patentsview.ts` | Test PatentsView | ~1 min | 7 test cases for PatentsView API |
| `test-file-wrapper.ts` | Test File Wrapper | ~2 min | 9 test cases for File Wrapper API |
| `test-ptab.ts` | Test PTAB | ~2 min | 11 test cases for PTAB API |
| `comprehensive-patent-analysis.ts` | Full analysis workflow | ~5 min | Complete patent analysis using all 3 APIs |
| `broadcom-portfolio-builder.ts` | Broadcom portfolio | ~35 min | Build complete 50K+ patent portfolio |

### `/types` - Type Definitions (optional, 3 files)

These are optional - types are currently defined in client files. You can extract them here if you prefer separation.

### `/output` - Generated Files (created at runtime)

This directory is created when you run the scripts. Contains:
- JSON files with complete portfolio data
- CSV files for spreadsheet import
- Generated reports

## NPM Scripts

```json
{
  "test:patentsview": "Test PatentsView API connection",
  "test:filewrapper": "Test File Wrapper API connection", 
  "test:ptab": "Test PTAB API connection",
  "test:all": "Run all API tests",
  "example:analysis": "Run comprehensive patent analysis example",
  "example:broadcom": "Build complete Broadcom portfolio",
  "build": "Compile TypeScript to JavaScript"
}
```

## Dependencies

### Production Dependencies
```json
{
  "node-fetch": "^3.3.2",    // HTTP client for API calls
  "dotenv": "^16.3.1"        // Environment variable management
}
```

### Development Dependencies
```json
{
  "@types/node": "^20.10.0",  // Node.js type definitions
  "typescript": "^5.3.3",     // TypeScript compiler
  "ts-node": "^10.9.2"        // Run TypeScript directly
}
```

## Setup Instructions

### 1. Create Project Directory
```bash
mkdir ip-port
cd ip-port
```

### 2. Download All Files
Download files maintaining the directory structure shown above.

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure API Keys
```bash
cp .env.example .env
# Edit .env and add your API keys:
# PATENTSVIEW_API_KEY=your_key_here
# USPTO_ODP_API_KEY=your_key_here
```

### 5. Run Tests
```bash
# Test individual APIs
npm run test:patentsview
npm run test:filewrapper
npm run test:ptab

# Or test all at once
npm run test:all
```

### 6. Run Examples
```bash
# Comprehensive patent analysis
npm run example:analysis

# Build Broadcom portfolio (30-35 minutes)
npm run example:broadcom
```

## .gitignore (Create This File)

```gitignore
# Dependencies
node_modules/
package-lock.json

# Environment
.env

# Output
output/
dist/
*.log

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
```

## File Size Summary

| Category | Files | Total Size |
|----------|-------|------------|
| Documentation | 7 files | ~70 KB |
| Client Code | 4 files | ~60 KB |
| Examples | 5 files | ~50 KB |
| Config | 2 files | ~5 KB |
| **Total (pre-install)** | **18 files** | **~185 KB** |
| node_modules/ | ~100 packages | ~20 MB |
| **Total (post-install)** | **~118 files** | **~20 MB** |

## Quick Reference: What Each File Does

### Core Functionality
- **`base-client.ts`** → HTTP client with rate limiting
- **`patentsview-client.ts`** → Search patents, get citations
- **`odp-file-wrapper-client.ts`** → Get prosecution history
- **`odp-ptab-client.ts`** → Find IPR challenges

### Configuration
- **`broadcom-assignees.json`** → Assignee name variants
- **`.env`** → Your API keys

### Testing
- **`test-*.ts`** → Verify API connections work
- **`comprehensive-patent-analysis.ts`** → End-to-end workflow

### Production Use
- **`broadcom-portfolio-builder.ts`** → Real-world portfolio builder

### Documentation
- **`API_REFERENCE.md`** → Complete API documentation
- **`CASE_STUDY_BROADCOM.md`** → How to build portfolios
- **`CLAUDE_CODE_GUIDE.md`** → Quick start guide

## Claude Code Project Setup

### Recommended Initial Context Files

When starting a new Claude Code session, provide these files as context:

1. **`CLAUDE_CODE_GUIDE.md`** - Quick orientation
2. **`API_REFERENCE.md`** - API details
3. **`clients/patentsview-client.ts`** - Example client code
4. **`examples/broadcom-portfolio-builder.ts`** - Real-world example

### For Specific Tasks

**Building a portfolio:**
- `CASE_STUDY_BROADCOM.md`
- `config/broadcom-assignees.json`
- `examples/broadcom-portfolio-builder.ts`

**Working with prosecution history:**
- `API_REFERENCE.md` (File Wrapper section)
- `clients/odp-file-wrapper-client.ts`
- `examples/test-file-wrapper.ts`

**Checking IPR challenges:**
- `API_REFERENCE.md` (PTAB section)
- `clients/odp-ptab-client.ts`
- `examples/test-ptab.ts`

## Total Project Statistics

- **Total Files (source):** 18
- **Total Lines of Code:** ~2,500
- **Total Documentation:** ~50 pages
- **Installation Size:** ~20 MB (with node_modules)
- **Runtime Memory:** <1 GB
- **API Calls (full Broadcom build):** ~150
- **Execution Time (full build):** ~35 minutes

---

This structure provides everything needed for professional patent portfolio analysis and is optimized for use with Claude Code.
