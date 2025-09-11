import { HumanMessage, SystemMessage } from 'langchain/schema';
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { OverrideData, MetadataOverride } from '../override/types';
import { PromptBuilder, LLMPrompt, DatabaseContext } from './PromptBuilder';
import { MultiProviderLLM, LLMProvider } from './MultiProviderLLM';
import { PrismaClient } from '@prisma/client';
import { 
  generatePersonFingerprint, 
  generateLawFirmFingerprint,
  generateLawFirmOfficeFingerprint
} from '../../utils/fingerprintUtils';

export interface LLMContext {
  transcriptHeader: string;
  trialName?: string;
  trialPath?: string;
}

export interface ExtractedEntities extends OverrideData {
  metadata?: MetadataOverride & {
    extractedAt: string;
    model: string;
    trialPath?: string;
  };
}

export interface ExtractorConfig {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}

export class LLMExtractor {
  private multiLLM: MultiProviderLLM;
  private config: ExtractorConfig;
  private promptBuilder?: PromptBuilder;
  private prisma?: PrismaClient;
  private systemConfig: any;

  constructor(config?: ExtractorConfig, prisma?: PrismaClient) {
    this.config = config || {};
    
    // Initialize multi-provider LLM
    this.multiLLM = new MultiProviderLLM({
      provider: config?.provider,
      model: config?.model,
      temperature: config?.temperature,
      maxTokens: config?.maxTokens,
      apiKey: config?.apiKey
    });

    this.prisma = prisma;
    if (prisma) {
      this.promptBuilder = new PromptBuilder(prisma);
    }

    // Load system configuration
    this.systemConfig = this.loadSystemConfig();
  }

  private loadSystemConfig(): any {
    const configPath = path.join(process.cwd(), 'config', 'system-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return {};
  }

  async extractTranscriptHeader(transcriptPath: string, pageLimit: number = 2): Promise<string> {
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const content = fs.readFileSync(transcriptPath, 'utf-8');
    
    // Split by form feed character (page break)
    const pages = content.split('\f');
    
    // Get first N pages
    const headerPages = pages.slice(0, pageLimit).join('\n\n--- PAGE BREAK ---\n\n');
    
    return headerPages;
  }

  private buildSystemPrompt(): string {
    return `You are a legal document parser specializing in extracting entity information from court transcript headers.

Your task is to extract structured data about the trial, attorneys, law firms, judges, and court reporters from the provided transcript header.

Generate a JSON object with the following structure. Use sequential IDs starting from 1 for correlation between related entities:

{
  "Trial": [{
    "id": 1,
    "name": "Full case name",
    "caseNumber": "Case number (CRITICAL: extract exactly as shown, e.g., '2:13-CV-00103-JRG')",
    "plaintiff": "Plaintiff name",
    "defendant": "Defendant name", 
    "court": "Court name",
    "courtDivision": "Division if mentioned",
    "courtDistrict": "District if mentioned"
  }],
  "Attorney": [
    {
      "id": 1,
      "name": "Full name with title",
      "title": "MR./MS./DR.",
      "firstName": "First name",
      "middleInitial": "Middle initial if present",
      "lastName": "Last name",
      "suffix": "Jr./III/etc if present",
      "speakerPrefix": "How they're addressed in court (e.g., 'MR. SMITH')",
      "barNumber": null
    }
  ],
  "LawFirm": [
    {
      "id": 1,
      "name": "Law firm name"
    }
  ],
  "LawFirmOffice": [
    {
      "id": 1,
      "lawFirmId": 1,
      "name": "Main Office",
      "addressId": 1
    }
  ],
  "Address": [
    {
      "id": 1,
      "street1": "Street address",
      "street2": "Suite/Floor if present",
      "city": "City",
      "state": "State",
      "zipCode": "ZIP code",
      "country": "USA",
      "fullAddress": "Complete address as single string"
    }
  ],
  "Judge": [
    {
      "id": 1,
      "name": "Judge full name",
      "title": "Title/position",
      "honorific": "THE HONORABLE or similar",
      "trialId": 1
    }
  ],
  "CourtReporter": [
    {
      "id": 1,
      "name": "Reporter name",
      "credentials": "CSR, TCRR, etc",
      "title": "Official Reporter or similar",
      "trialId": 1,
      "addressId": null
    }
  ],
  "TrialAttorney": [
    {
      "id": 1,
      "trialId": 1,
      "attorneyId": 1,
      "lawFirmOfficeId": 1,
      "side": "plaintiff or defendant",
      "leadCounsel": false
    }
  ]
}

Important rules:
1. Correlate attorneys to their law firms by matching the firm names that appear after attorney names
2. Create one LawFirmOffice per unique address for each law firm
3. Use consistent IDs to maintain relationships (e.g., attorney's law firm reference)
4. Extract all attorneys listed for both plaintiff and defendant
5. Parse names carefully to separate title, first, middle, last, and suffix
6. If information is not present, use null rather than empty string
7. CRITICAL: Create TrialAttorney associations for EVERY attorney you extract:
   - Look for "FOR THE PLAINTIFF:" or "FOR PLAINTIFF:" sections - these attorneys have side="plaintiff"
   - Look for "FOR THE DEFENDANT:" or "FOR DEFENDANT:" or "FOR THE DEFENDANTS:" sections - these attorneys have side="defendant"
   - Match attorneyId to the Attorney you extracted
   - Match lawFirmOfficeId to the office the attorney is associated with
   - Set leadCounsel to false by default
   - If you cannot determine the side from context, use "unknown" as the side value

Return ONLY the JSON object, no additional text or explanation.`;
  }

  async requestEntityExtraction(
    context: LLMContext,
    savePrompt: boolean = false
  ): Promise<ExtractedEntities> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = `Extract entity information from the following court transcript header:

${context.transcriptHeader}`;

    // Create LLMPrompt object for saving
    const prompt: LLMPrompt = {
      system: systemPrompt,
      user: userPrompt,
      metadata: {
        trialName: context.trialName,
        timestamp: new Date().toISOString(),
        promptVersion: 'extraction-v1'
      }
    };

    // Save prompt and context if requested
    if (savePrompt) {
      await this.saveContextAndPrompt(prompt, context);
    }

    try {
      const llm = this.multiLLM.getLLM();
      if (!llm) {
        throw new Error(`LLM not initialized. API key required for ${this.multiLLM.getProvider()} provider.`);
      }
      
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ];

      const response = await llm.call(messages);
      
      // Parse the JSON response
      let jsonStr = response.content as string;
      
      // Clean up the response - remove markdown code blocks if present
      jsonStr = jsonStr.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7); // Remove ```json
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3); // Remove ```
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3); // Remove trailing ```
      }
      jsonStr = jsonStr.trim();
      
      const entities = JSON.parse(jsonStr) as ExtractedEntities;

      // Add fingerprints to entities
      this.addFingerprints(entities);
      
      // Add override configuration fields (pass context for trial shortName)
      this.addOverrideFields(entities, context);

      // Add metadata with import flags
      entities.metadata = {
        extractedAt: new Date().toISOString(),
        model: `${this.multiLLM.getProvider()}:${this.multiLLM.getModel()}`,
        trialPath: context.trialPath,
        userReview: true,  // Always require user review of LLM extracted data
        importAttorney: true,  // Default: import attorneys
        importJudge: false,    // Default: don't import judges (likely shared across trials)
        importCourtReporter: false  // Default: don't import court reporters (likely shared)
      };

      // Save response if prompt was saved
      if (savePrompt) {
        await this.saveResponse(entities, context);
      }

      return entities;
    } catch (error) {
      console.error('LLM extraction error:', error);
      throw new Error(`Failed to extract entities: ${error}`);
    }
  }

  private async saveContextAndPrompt(
    prompt: LLMPrompt,
    context: LLMContext
  ): Promise<void> {
    const outputDir = this.systemConfig.llm?.output?.baseDir || 'output/llm';
    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');
    const trialName = context.trialName?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';

    // Create directories
    const promptsDir = path.join(outputDir, 'prompts');
    const contextsDir = path.join(outputDir, 'contexts');
    
    [promptsDir, contextsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Save prompt as JSON
    const promptFile = path.join(promptsDir, `${timestamp}-${trialName}-prompt.json`);
    fs.writeFileSync(promptFile, JSON.stringify(prompt, null, 2));

    // Save prompt as Markdown for readability
    const promptMd = path.join(promptsDir, `${timestamp}-${trialName}-prompt.md`);
    const mdContent = `# LLM Extraction Prompt
## Trial: ${context.trialName || 'Unknown'}
## Timestamp: ${prompt.metadata?.timestamp}

### System Prompt
\`\`\`
${prompt.system}
\`\`\`

### User Prompt
\`\`\`
${prompt.user}
\`\`\`
`;
    fs.writeFileSync(promptMd, mdContent);

    // Save context
    const contextFile = path.join(contextsDir, `${timestamp}-${trialName}-context.json`);
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2));

    console.log(`Saved prompt and context to ${outputDir}`);
  }

  private async saveResponse(
    entities: ExtractedEntities,
    context: LLMContext
  ): Promise<void> {
    const outputDir = this.systemConfig.llm?.output?.baseDir || 'output/llm';
    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');
    const trialName = context.trialName?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';

    const responsesDir = path.join(outputDir, 'responses');
    if (!fs.existsSync(responsesDir)) {
      fs.mkdirSync(responsesDir, { recursive: true });
    }

    const responseFile = path.join(responsesDir, `${timestamp}-${trialName}-response.json`);
    fs.writeFileSync(responseFile, JSON.stringify(entities, null, 2));

    // Also save in overrides directory for easy access
    const overridesDir = path.join(outputDir, 'overrides');
    if (!fs.existsSync(overridesDir)) {
      fs.mkdirSync(overridesDir, { recursive: true });
    }

    const overrideFile = path.join(overridesDir, `${trialName}-override.json`);
    fs.writeFileSync(overrideFile, JSON.stringify(entities, null, 2));
  }

  async extractFromTrialFolder(trialPath: string): Promise<ExtractedEntities | null> {
    // Find the first session transcript
    const files = fs.readdirSync(trialPath);
    const transcriptFiles = files
      .filter(f => f.endsWith('.txt'))
      .sort(); // Sort to get first session

    if (transcriptFiles.length === 0) {
      console.warn(`No transcript files found in ${trialPath}`);
      return null;
    }

    const firstTranscript = path.join(trialPath, transcriptFiles[0]);
    const header = await this.extractTranscriptHeader(firstTranscript);

    return this.requestEntityExtraction({
      transcriptHeader: header,
      trialName: path.basename(trialPath),
      trialPath
    });
  }

  async extractFromAllTrials(basePath: string): Promise<ExtractedEntities[]> {
    const results: ExtractedEntities[] = [];
    
    // Read all subdirectories
    const trials = fs.readdirSync(basePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => path.join(basePath, dirent.name));

    for (const trialPath of trials) {
      console.log(`Extracting entities from ${path.basename(trialPath)}...`);
      try {
        const entities = await this.extractFromTrialFolder(trialPath);
        if (entities) {
          results.push(entities);
        }
      } catch (error) {
        console.error(`Failed to extract from ${trialPath}:`, error);
      }
    }

    return results;
  }

  validateExtraction(entities: ExtractedEntities): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for required Trial fields
    if (!entities.Trial) {
      errors.push('No Trial entity extracted');
    } else {
      const trials = Array.isArray(entities.Trial) ? entities.Trial : [entities.Trial];
      if (trials.length === 0) {
        errors.push('No Trial entity extracted');
      } else {
        const trial = trials[0];
        if (!trial.caseNumber) errors.push('Missing trial caseNumber');
        if (!trial.name) errors.push('Missing trial name');
        if (!trial.court) errors.push('Missing trial court');
      }
    }

    // Check for at least one attorney
    if (!entities.Attorney || entities.Attorney.length === 0) {
      errors.push('No attorneys extracted');
    }

    // Validate ID correlations
    if (entities.LawFirmOffice) {
      entities.LawFirmOffice.forEach((office, idx) => {
        if (!entities.LawFirm?.find(f => f.id === office.lawFirmId)) {
          errors.push(`LawFirmOffice[${idx}] references non-existent LawFirm ${office.lawFirmId}`);
        }
        if (office.addressId && !entities.Address?.find(a => a.id === office.addressId)) {
          errors.push(`LawFirmOffice[${idx}] references non-existent Address ${office.addressId}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async saveExtraction(entities: ExtractedEntities, outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(entities, null, 2));
  }

  private addFingerprints(entities: ExtractedEntities): void {
    // Add fingerprints to Attorney entities
    if (entities.Attorney) {
      entities.Attorney.forEach(attorney => {
        if (attorney.lastName && attorney.firstName) {
          attorney.attorneyFingerprint = generatePersonFingerprint(attorney.lastName, attorney.firstName);
        }
      });
    }

    // Add fingerprints to LawFirm entities
    if (entities.LawFirm) {
      entities.LawFirm.forEach(firm => {
        if (firm.name) {
          firm.lawFirmFingerprint = generateLawFirmFingerprint(firm.name);
        }
      });
    }

    // Add fingerprints to LawFirmOffice entities
    if (entities.LawFirmOffice && entities.LawFirm) {
      entities.LawFirmOffice.forEach(office => {
        // Find the related law firm
        const lawFirm = entities.LawFirm?.find(f => f.id === office.lawFirmId);
        if (lawFirm?.lawFirmFingerprint && entities.Address) {
          // Find the office address
          const address = entities.Address.find(a => a.id === office.addressId);
          if (address?.city) {
            office.lawFirmOfficeFingerprint = generateLawFirmOfficeFingerprint(
              lawFirm.lawFirmFingerprint, 
              address.city
            );
          }
        }
      });
    }

    // Add fingerprints to Judge entities
    if (entities.Judge) {
      entities.Judge.forEach(judge => {
        // Parse name to extract first and last name
        const nameParts = this.parseJudgeName(judge.name);
        if (nameParts.lastName && nameParts.firstName) {
          judge.judgeFingerprint = generatePersonFingerprint(nameParts.lastName, nameParts.firstName);
        }
      });
    }

    // Add fingerprints to CourtReporter entities
    if (entities.CourtReporter) {
      entities.CourtReporter.forEach(reporter => {
        // Parse name to extract first and last name
        const nameParts = this.parseReporterName(reporter.name);
        if (nameParts.lastName && nameParts.firstName) {
          reporter.courtReporterFingerprint = generatePersonFingerprint(nameParts.lastName, nameParts.firstName);
        }
      });
    }
  }

  private parseJudgeName(fullName: string): { firstName: string | null; lastName: string | null } {
    if (!fullName) {
      return { firstName: null, lastName: null };
    }
    // Remove honorifics
    let cleanName = fullName.replace(/^(THE HONORABLE|HONORABLE|JUDGE|JUSTICE)\s+/i, '');
    const parts = cleanName.trim().split(/\s+/);
    
    if (parts.length < 2) {
      return { firstName: null, lastName: null };
    }
    
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  }

  private parseReporterName(fullName: string): { firstName: string | null; lastName: string | null } {
    if (!fullName) {
      return { firstName: null, lastName: null };
    }
    // Remove credentials
    let cleanName = fullName.replace(/,?\s*(CSR|TCRR|RPR|CRR|RMR|CRC|CCR).*$/i, '');
    const parts = cleanName.trim().split(/\s+/);
    
    if (parts.length < 2) {
      return { firstName: null, lastName: null };
    }
    
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  }

  private addOverrideFields(entities: any, context?: LLMContext): void {
    // Add override fields for Attorneys - use ConditionalInsert to avoid updating existing
    if (entities.Attorney) {
      entities.Attorney.forEach((attorney: any) => {
        attorney.overrideAction = 'ConditionalInsert';
        attorney.overrideKey = 'attorneyFingerprint';
      });
    }

    // Add override fields for Judges
    if (entities.Judge) {
      entities.Judge.forEach((judge: any) => {
        judge.overrideAction = 'Upsert';
        judge.overrideKey = 'judgeFingerprint';
      });
    }

    // Add override fields for LawFirms - use ConditionalInsert
    if (entities.LawFirm) {
      entities.LawFirm.forEach((firm: any) => {
        firm.overrideAction = 'ConditionalInsert';
        firm.overrideKey = 'lawFirmFingerprint';
      });
    }

    // Add override fields for LawFirmOffices - use ConditionalInsert
    if (entities.LawFirmOffice) {
      entities.LawFirmOffice.forEach((office: any) => {
        office.overrideAction = 'ConditionalInsert';
        office.overrideKey = 'lawFirmOfficeFingerprint';
      });
    }
    
    // Add override fields for Addresses - use ConditionalInsert
    if (entities.Address) {
      entities.Address.forEach((address: any) => {
        address.overrideAction = 'ConditionalInsert';
        address.overrideKey = 'id';  // Addresses don't have fingerprints
      });
    }

    // Add override fields for CourtReporters - use ConditionalInsert
    if (entities.CourtReporter) {
      entities.CourtReporter.forEach((reporter: any) => {
        reporter.overrideAction = 'ConditionalInsert';
        reporter.overrideKey = 'courtReporterFingerprint';
      });
    }

    // Add override fields for Trials
    if (entities.Trial) {
      const trials = Array.isArray(entities.Trial) ? entities.Trial : [entities.Trial];
      trials.forEach((trial: any) => {
        // Set shortName from the trial folder name (passed in context)
        if (context?.trialName) {
          trial.shortName = context.trialName;
        }
        trial.overrideAction = 'Upsert';  // Use upsert since trial may already exist from phase1
        trial.overrideKey = 'shortName';  // Use shortName for upsert instead of caseNumber
        // Remove caseHandle if it exists (will be derived at import time)
        delete trial.caseHandle;
      });
    }

    // Add override fields for Addresses (always insert)
    if (entities.Address) {
      entities.Address.forEach((address: any) => {
        address.overrideAction = 'Insert';
      });
    }

    // Add override fields for TrialAttorney associations
    if (entities.TrialAttorney) {
      entities.TrialAttorney.forEach((ta: any) => {
        ta.overrideAction = 'ConditionalInsert';
        ta.overrideKey = 'attorneyFingerprint';  // Use attorney fingerprint to avoid duplicates
      });
    }
  }
}