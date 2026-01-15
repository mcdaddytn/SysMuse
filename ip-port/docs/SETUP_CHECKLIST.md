# IP-PORT Project Setup Checklist

## Quick Setup (Download & Install)

Follow this checklist to set up your **ip-port** Claude Code project.

---

## Step 1: Create Project Directory

```bash
mkdir ip-port
cd ip-port
```

---

## Step 2: Download Files

Download all files from the outputs and place them in the corresponding directories:

### Root Directory Files (8 files)
```bash
ip-port/
```

- [ ] `README.md` ← Main project overview
- [ ] `PACKAGE_SUMMARY.md` ← Package contents summary
- [ ] `CLAUDE_CODE_GUIDE.md` ← Claude Code quick start
- [ ] `BROADCOM_CASE_STUDY_SUMMARY.md` ← Broadcom case study overview
- [ ] `PROJECT_STRUCTURE.md` ← Complete file structure (THIS FILE)
- [ ] `package.json` ← NPM configuration
- [ ] `tsconfig.json` ← TypeScript configuration
- [ ] `.env.example` ← Environment variables template
- [ ] `.gitignore` ← Git ignore patterns

### `/clients` Directory (4 files)
```bash
mkdir clients
```

- [ ] `clients/base-client.ts` ← Shared HTTP client
- [ ] `clients/patentsview-client.ts` ← PatentsView API
- [ ] `clients/odp-file-wrapper-client.ts` ← File Wrapper API
- [ ] `clients/odp-ptab-client.ts` ← PTAB API

### `/config` Directory (1 file)
```bash
mkdir config
```

- [ ] `config/broadcom-assignees.json` ← Broadcom assignee variants

### `/docs` Directory (3 files)
```bash
mkdir docs
```

- [ ] `docs/API_REFERENCE.md` ← Complete API documentation
- [ ] `docs/CASE_STUDY_BROADCOM.md` ← Broadcom case study
- [ ] `docs/BROADCOM_QUICK_START.md` ← Broadcom quick start

### `/examples` Directory (5 files)
```bash
mkdir examples
```

- [ ] `examples/test-patentsview.ts` ← PatentsView tests
- [ ] `examples/test-file-wrapper.ts` ← File Wrapper tests
- [ ] `examples/test-ptab.ts` ← PTAB tests
- [ ] `examples/comprehensive-patent-analysis.ts` ← Full analysis example
- [ ] `examples/broadcom-portfolio-builder.ts` ← Broadcom portfolio builder

**Total: 21 source files**

---

## Step 3: Install Dependencies

```bash
npm install
```

This installs:
- `node-fetch` (HTTP client)
- `dotenv` (environment variables)
- `typescript` (TypeScript compiler)
- `ts-node` (TypeScript execution)
- `@types/node` (Node.js types)

---

## Step 4: Configure API Keys

```bash
# Copy template
cp .env.example .env

# Edit .env and add your keys
nano .env  # or use your preferred editor
```

Add to `.env`:
```
PATENTSVIEW_API_KEY=your_patentsview_key_here
USPTO_ODP_API_KEY=your_uspto_odp_key_here
```

### Getting API Keys

**PatentsView API Key:**
1. Request at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18
2. Fill out form (name, email, use case)
3. Receive key by email (usually within 24 hours)

**USPTO ODP API Key:**
1. Create USPTO.gov account: https://www.uspto.gov/
2. Complete ID.me verification (requires govt ID + SSN)
3. Get API key at: https://data.uspto.gov/myodp

---

## Step 5: Verify Installation

### Test Individual APIs
```bash
# Test PatentsView (requires PATENTSVIEW_API_KEY)
npm run test:patentsview

# Test File Wrapper (requires USPTO_ODP_API_KEY)
npm run test:filewrapper

# Test PTAB (requires USPTO_ODP_API_KEY)
npm run test:ptab
```

### Expected Output
Each test should show:
- ✓ Client created successfully
- ✓ Test cases passing
- ✓ Sample data retrieved

---

## Step 6: Run Examples

### Quick Example (~5 minutes)
```bash
npm run example:analysis
```

Analyzes a single patent using all three APIs.

### Full Example (~35 minutes)
```bash
npm run example:broadcom
```

Builds complete Broadcom portfolio (50,000+ patents).

---

## File Download Reference

### All Files Available in Outputs

All files have been presented in this chat session. You can download them individually by clicking each file name above.

**Files are located in:**
```
/outputs/uspto-api-docs/
```

**Download and place in:**
```
ip-port/
```

---

## Verification Checklist

After setup, verify you have:

- [ ] All 21 source files downloaded
- [ ] `node_modules/` directory created (after npm install)
- [ ] `.env` file created with your API keys
- [ ] At least one test script runs successfully
- [ ] No TypeScript compilation errors

---

## Project Structure Verification

Run this to check your structure:

```bash
tree -L 2 -I 'node_modules|dist'
```

Should show:
```
ip-port/
├── README.md
├── PACKAGE_SUMMARY.md
├── CLAUDE_CODE_GUIDE.md
├── BROADCOM_CASE_STUDY_SUMMARY.md
├── PROJECT_STRUCTURE.md
├── package.json
├── tsconfig.json
├── .env.example
├── .env
├── .gitignore
├── clients/
│   ├── base-client.ts
│   ├── patentsview-client.ts
│   ├── odp-file-wrapper-client.ts
│   └── odp-ptab-client.ts
├── config/
│   └── broadcom-assignees.json
├── docs/
│   ├── API_REFERENCE.md
│   ├── CASE_STUDY_BROADCOM.md
│   └── BROADCOM_QUICK_START.md
└── examples/
    ├── test-patentsview.ts
    ├── test-file-wrapper.ts
    ├── test-ptab.ts
    ├── comprehensive-patent-analysis.ts
    └── broadcom-portfolio-builder.ts
```

---

## Claude Code Setup

### Initial Context Files

When starting a Claude Code session for this project, provide:

1. **First time:**
   - `CLAUDE_CODE_GUIDE.md`
   - `PROJECT_STRUCTURE.md`
   - `README.md`

2. **For patent analysis work:**
   - `API_REFERENCE.md`
   - Relevant client file (e.g., `patentsview-client.ts`)
   - Relevant example (e.g., `broadcom-portfolio-builder.ts`)

3. **For building portfolios:**
   - `CASE_STUDY_BROADCOM.md`
   - `config/broadcom-assignees.json`
   - `examples/broadcom-portfolio-builder.ts`

---

## Troubleshooting

### "npm install fails"
- Ensure you have Node.js 16+ installed
- Run `npm cache clean --force`
- Try `npm install --legacy-peer-deps`

### "TypeScript errors"
- Run `npm install -D typescript ts-node @types/node`
- Check `tsconfig.json` is present

### "API key not found"
- Verify `.env` file exists (not `.env.example`)
- Check API key is on correct line
- No quotes needed around keys

### "Cannot find module"
- All imports use `.js` extension (TypeScript requirement for ESM)
- Check file paths are correct
- Run `npm install` again

---

## Next Steps After Setup

1. **Run tests** to verify API connections
2. **Review documentation** in `/docs`
3. **Run Broadcom example** to see full workflow
4. **Adapt for your use case** (create new configs/builders)
5. **Integrate with your tools** (databases, dashboards, etc.)

---

## Quick Command Reference

```bash
# Install
npm install

# Test APIs
npm run test:patentsview
npm run test:filewrapper
npm run test:ptab
npm run test:all

# Run examples
npm run example:analysis        # ~5 minutes
npm run example:broadcom         # ~35 minutes

# Build TypeScript
npm run build

# Custom execution
npx ts-node --esm examples/your-script.ts
```

---

## Support Resources

- **PatentsView Docs:** https://search.patentsview.org/docs/
- **USPTO ODP:** https://data.uspto.gov/
- **Project Docs:** See `/docs` directory
- **API Reference:** `docs/API_REFERENCE.md`
- **Case Study:** `docs/CASE_STUDY_BROADCOM.md`

---

**Once you complete this checklist, your ip-port project is ready for use with Claude Code!**
