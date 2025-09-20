import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  OverrideData,
  CorrelationMap,
  ImportResult,
  ValidationResult,
  TrialOverride,
  AttorneyOverride,
  WitnessOverride,
  LawFirmOverride,
  LawFirmOfficeOverride,
  AddressOverride,
  JudgeOverride,
  CourtReporterOverride,
  TrialAttorneyOverride,
  MarkerOverride,
  MarkerSectionOverride
} from './types';
// Speaker imports removed - speakers are now created during transcript parsing, not import
import { generateFileToken, generateCaseHandle } from '../../utils/fileTokenGenerator';

export class OverrideImporter {
  private prisma: PrismaClient;
  private correlationMap: CorrelationMap;
  private currentImportData: OverrideData | null = null;
  private insertedEntities: {
    attorneys: Set<number>;
    lawFirms: Set<number>;
    lawFirmOffices: Set<number>;
    addresses: Set<number>;
    courtReporters: Set<number>;
  };

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.correlationMap = this.initializeCorrelationMap();
    this.insertedEntities = {
      attorneys: new Set(),
      lawFirms: new Set(),
      lawFirmOffices: new Set(),
      addresses: new Set(),
      courtReporters: new Set()
    };
  }

  private initializeCorrelationMap(): CorrelationMap {
    return {
      Trial: new Map(),
      Attorney: new Map(),
      Witness: new Map(),
      LawFirm: new Map(),
      LawFirmOffice: new Map(),
      Address: new Map(),
      Judge: new Map(),
      CourtReporter: new Map(),
      Speaker: new Map(),
      Marker: new Map(),
      MarkerSection: new Map()
    };
  }

  /**
   * Reset correlation map and inserted entities tracking
   * This should be called before each new import to avoid ID conflicts
   */
  public resetState(): void {
    this.correlationMap = this.initializeCorrelationMap();
    this.insertedEntities = {
      attorneys: new Set(),
      lawFirms: new Set(),
      lawFirmOffices: new Set(),
      addresses: new Set(),
      courtReporters: new Set()
    };
    this.currentImportData = null;
  }

  async loadOverrideFile(filePath: string): Promise<OverrideData> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Override file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    try {
      return JSON.parse(content) as OverrideData;
    } catch (error) {
      throw new Error(`Invalid JSON in override file: ${error}`);
    }
  }

  validateOverrides(data: OverrideData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate Trial data
    if (data.Trial) {
      const trials = Array.isArray(data.Trial) ? data.Trial : [data.Trial];
      trials.forEach((trial, index) => {
        // For Update action, id is required
        if (trial.overrideAction !== 'Insert' && !trial.id) {
          errors.push(`Trial[${index}]: missing id for Update action`);
        }
        if (!trial.name) errors.push(`Trial[${index}]: missing name`);
        if (!trial.caseNumber) errors.push(`Trial[${index}]: missing caseNumber`);
        if (!trial.court) errors.push(`Trial[${index}]: missing court`);
      });
    }

    // Validate Attorney data
    if (data.Attorney) {
      data.Attorney.forEach((attorney, index) => {
        if (attorney.overrideAction !== 'Insert' && !attorney.id) {
          errors.push(`Attorney[${index}]: missing id for Update action`);
        }
        if (!attorney.name) errors.push(`Attorney[${index}]: missing name`);
      });
    }

    // Validate Witness data
    if (data.Witness) {
      data.Witness.forEach((witness, index) => {
        if (witness.overrideAction !== 'Insert' && !witness.id && !witness.name) {
          errors.push(`Witness[${index}]: missing id or name for Update action`);
        }
        if (!witness.name) errors.push(`Witness[${index}]: missing name`);
      });
    }

    // Validate LawFirm data
    if (data.LawFirm) {
      data.LawFirm.forEach((firm, index) => {
        if (!firm.id) errors.push(`LawFirm[${index}]: missing id`);
        if (!firm.name) errors.push(`LawFirm[${index}]: missing name`);
      });
    }

    // Validate relationships
    if (data.LawFirmOffice) {
      data.LawFirmOffice.forEach((office, index) => {
        if (!office.lawFirmId) {
          errors.push(`LawFirmOffice[${index}]: missing lawFirmId`);
        } else if (data.LawFirm && !data.LawFirm.find(f => f.id === office.lawFirmId)) {
          warnings.push(`LawFirmOffice[${index}]: references non-existent LawFirm ${office.lawFirmId}`);
        }
        
        if (office.addressId && data.Address && !data.Address.find(a => a.id === office.addressId)) {
          warnings.push(`LawFirmOffice[${index}]: references non-existent Address ${office.addressId}`);
        }
      });
    }

    if (data.TrialAttorney) {
      data.TrialAttorney.forEach((ta, index) => {
        if (!ta.trialId) errors.push(`TrialAttorney[${index}]: missing trialId`);
        if (!ta.attorneyId) errors.push(`TrialAttorney[${index}]: missing attorneyId`);
        
        const trials = data.Trial ? (Array.isArray(data.Trial) ? data.Trial : [data.Trial]) : [];
        if (trials.length > 0 && !trials.find((t: TrialOverride) => t.id === ta.trialId)) {
          warnings.push(`TrialAttorney[${index}]: references non-existent Trial ${ta.trialId}`);
        }
        if (data.Attorney && !data.Attorney.find(a => a.id === ta.attorneyId)) {
          warnings.push(`TrialAttorney[${index}]: references non-existent Attorney ${ta.attorneyId}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async applyOverrides(data: OverrideData): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      imported: {},
      errors: []
    };

    // Reset state to ensure clean import (important for multi-trial processing)
    this.resetState();

    // Store current import data for reference
    this.currentImportData = data;

    try {
      // NOTE: We're NOT using a single transaction for everything anymore
      // Each entity type gets its own transaction to prevent cascading failures
      // This is appropriate for override imports where we use ConditionalInsert
      
      // Import in dependency order, but with separate transactions
      
      // 1. Import Addresses first (no dependencies) - Own transaction
      if (data.Address && data.Address.length > 0) {
        try {
          console.log(`[IMPORT] Starting Address import (${data.Address.length} items)...`);
          result.imported.addresses = await this.prisma.$transaction(async (tx) => {
            return await this.importAddresses(tx, data.Address!);
          });
          console.log(`[IMPORT] ✅ Address import completed: ${result.imported.addresses} imported`);
        } catch (error) {
          console.log(`⚠️ WARNING: Address import encountered issues: ${error}`);
          console.log(`⚠️ Continuing with other imports...`);
          result.imported.addresses = 0;
        }
      }

      // 2. Import Trials (no dependencies on other override entities) - Own transaction
      if (data.Trial) {
        const trials = Array.isArray(data.Trial) ? data.Trial : [data.Trial];
        if (trials.length > 0) {
          try {
            console.log(`[IMPORT] Starting Trial import (${trials.length} items)...`);
            result.imported.trials = await this.prisma.$transaction(async (tx) => {
              return await this.importTrials(tx, trials);
            });
            console.log(`[IMPORT] ✅ Trial import completed: ${result.imported.trials} imported`);
          } catch (error) {
            console.error(`❌ ERROR: Trial import failed: ${error}`);
            result.errors?.push(`Trial import failed: ${error}`);
            // Don't throw - continue with other imports
          }
        }
      }

      // 3. Import LawFirms (no dependencies) - Own transaction
      if (data.LawFirm && data.LawFirm.length > 0) {
        try {
          console.log(`[IMPORT] Starting LawFirm import (${data.LawFirm.length} items)...`);
          result.imported.lawFirms = await this.prisma.$transaction(async (tx) => {
            return await this.importLawFirms(tx, data.LawFirm!);
          });
          console.log(`[IMPORT] ✅ LawFirm import completed: ${result.imported.lawFirms} imported`);
        } catch (error) {
          console.error(`❌ ERROR: LawFirm import failed: ${error}`);
          result.errors?.push(`LawFirm import failed: ${error}`);
          // Don't throw - continue with other imports
        }
      }

      // 4. Import LawFirmOffices (depends on LawFirm and Address) - Own transaction
      if (data.LawFirmOffice && data.LawFirmOffice.length > 0) {
        try {
          console.log(`[IMPORT] Starting LawFirmOffice import (${data.LawFirmOffice.length} items)...`);
          result.imported.lawFirmOffices = await this.prisma.$transaction(async (tx) => {
            return await this.importLawFirmOffices(tx, data.LawFirmOffice!);
          });
          console.log(`[IMPORT] ✅ LawFirmOffice import completed: ${result.imported.lawFirmOffices} imported`);
        } catch (error) {
          console.log(`⚠️ WARNING: LawFirmOffice import encountered issues: ${error}`);
          console.log(`⚠️ Continuing with Attorney and TrialAttorney imports...`);
          result.imported.lawFirmOffices = 0;
        }
      }

      // 5. Import Attorneys (needs speaker creation) - Own transaction
      // Check metadata flag - default to true if not specified
      const importAttorney = data.metadata?.importAttorney !== false;
      console.log(`[IMPORT FLAGS] importAttorney: ${importAttorney} (metadata value: ${data.metadata?.importAttorney})`);
      if (importAttorney && data.Attorney && data.Attorney.length > 0) {
        try {
          console.log(`[IMPORT] Importing ${data.Attorney.length} attorneys`);
          result.imported.attorneys = await this.prisma.$transaction(async (tx) => {
            return await this.importAttorneys(tx, data.Attorney!);
          });
          console.log(`[IMPORT] ✅ Attorney import completed: ${result.imported.attorneys} imported`);
        } catch (error) {
          console.error(`❌ ERROR: Attorney import failed: ${error}`);
          result.errors?.push(`Attorney import failed: ${error}`);
          // Don't throw - continue with other imports
        }
      } else if (!importAttorney && data.Attorney && data.Attorney.length > 0) {
        console.log(`[IMPORT] Skipping ${data.Attorney.length} attorneys due to importAttorney=false`);
      }

      // 6. Import Judges (depends on Trial and Speaker) - Own transaction
      // Check metadata flag - default to false if not specified
      const importJudge = data.metadata?.importJudge === true;
      console.log(`[IMPORT FLAGS] importJudge: ${importJudge} (metadata value: ${data.metadata?.importJudge})`);
      if (importJudge && data.Judge && data.Judge.length > 0) {
        try {
          console.log(`[IMPORT] Importing ${data.Judge.length} judges`);
          result.imported.judges = await this.prisma.$transaction(async (tx) => {
            return await this.importJudges(tx, data.Judge!);
          });
        } catch (error) {
          console.error(`❌ ERROR: Judge import failed: ${error}`);
          result.errors?.push(`Judge import failed: ${error}`);
        }
      } else if (!importJudge && data.Judge && data.Judge.length > 0) {
        console.log(`[IMPORT] Skipping ${data.Judge.length} judges due to importJudge=false`);
      }

      // 7. Import CourtReporters (depends on Trial and Address) - Own transaction
      // Check metadata flag - default to false if not specified
      const importCourtReporter = data.metadata?.importCourtReporter === true;
      console.log(`[IMPORT FLAGS] importCourtReporter: ${importCourtReporter} (metadata value: ${data.metadata?.importCourtReporter})`);
      if (importCourtReporter && data.CourtReporter && data.CourtReporter.length > 0) {
        try {
          console.log(`[IMPORT] Importing ${data.CourtReporter.length} court reporters`);
          result.imported.courtReporters = await this.prisma.$transaction(async (tx) => {
            return await this.importCourtReporters(tx, data.CourtReporter!);
          });
        } catch (error) {
          console.error(`❌ ERROR: CourtReporter import failed: ${error}`);
          result.errors?.push(`CourtReporter import failed: ${error}`);
        }
      } else if (!importCourtReporter && data.CourtReporter && data.CourtReporter.length > 0) {
        console.log(`[IMPORT] Skipping ${data.CourtReporter.length} court reporters due to importCourtReporter=false`);
      }

      // 8. Import TrialAttorneys (depends on Trial, Attorney, LawFirm, LawFirmOffice) - Own transaction
      if (data.TrialAttorney && data.TrialAttorney.length > 0) {
        try {
          result.imported.trialAttorneys = await this.prisma.$transaction(async (tx) => {
            return await this.importTrialAttorneys(tx, data.TrialAttorney!);
          });
        } catch (error) {
          console.error(`❌ ERROR: TrialAttorney import failed: ${error}`);
          result.errors?.push(`TrialAttorney import failed: ${error}`);
        }
      }

      // 9. Import Witnesses (needs speaker creation) - Own transaction
      if (data.Witness && data.Witness.length > 0) {
        try {
          result.imported.witnesses = await this.prisma.$transaction(async (tx) => {
            return await this.importWitnesses(tx, data.Witness!);
          });
        } catch (error) {
          console.error(`❌ ERROR: Witness import failed: ${error}`);
          result.errors?.push(`Witness import failed: ${error}`);
        }
      }

      // 10. Import Markers - Own transaction
      if (data.Marker && data.Marker.length > 0) {
        try {
          result.imported.markers = await this.prisma.$transaction(async (tx) => {
            return await this.importMarkers(tx, data.Marker!);
          });
        } catch (error) {
          console.error(`❌ ERROR: Marker import failed: ${error}`);
          result.errors?.push(`Marker import failed: ${error}`);
        }
      }

      // 11. Import MarkerSections (depends on Marker) - Own transaction
      if (data.MarkerSection && data.MarkerSection.length > 0) {
        try {
          result.imported.markerSections = await this.prisma.$transaction(async (tx) => {
            return await this.importMarkerSections(tx, data.MarkerSection!);
          });
        } catch (error) {
          console.error(`❌ ERROR: MarkerSection import failed: ${error}`);
          result.errors?.push(`MarkerSection import failed: ${error}`);
        }
      }

      // Set success based on whether there were any errors
      // It's OK if nothing was imported (e.g., ConditionalInsert found everything already exists)
      // We only fail if there were actual errors
      result.success = !result.errors || result.errors.length === 0;
      result.correlationMap = this.correlationMap;
    } catch (error) {
      result.success = false;
      result.errors?.push(`Transaction failed: ${error}`);
    }

    return result;
  }

  private async importAddresses(tx: any, addresses: AddressOverride[]): Promise<number> {
    console.log(`\n[Address Import] Starting import of ${addresses.length} addresses`);
    let count = 0;
    for (const address of addresses) {
      console.log(`\n[Address Import] Processing address JSON id=${address.id}: ${address.fullAddress?.substring(0, 50)}...`);
      const action = address.overrideAction || 'Upsert';
      const overrideKey = address.overrideKey || 'fullAddress';
      
      // For ConditionalInsert, check if address is referenced by an inserted office or court reporter
      if (action === 'ConditionalInsert') {
        const isReferenced = this.insertedEntities.lawFirmOffices.size > 0 || 
                           this.insertedEntities.courtReporters.size > 0;
        
        if (!isReferenced) {
          console.log(`ConditionalInsert: Address not referenced by any inserted entity, skipping`);
          continue;
        }
        
        // Check if address already exists (by matching all fields)
        const existingAddress = await tx.address.findFirst({
          where: {
            street1: address.street1,
            street2: address.street2,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode
          }
        });
        
        if (existingAddress) {
          console.log(`ConditionalInsert: Address already exists, skipping`);
          if (address.id) {
            this.correlationMap.Address.set(address.id, existingAddress.id);
          }
          continue;
        }
      }
      
      // Handle Upsert
      if (action === 'Upsert') {
        // Since fullAddress doesn't have unique constraint, find first then create or update
        let existing = null;
        if (overrideKey === 'fullAddress' && address.fullAddress) {
          existing = await tx.address.findFirst({
            where: { fullAddress: address.fullAddress }
          });
        } else if (overrideKey === 'id') {
          // Cannot upsert by placeholder ID from JSON
          console.log(`Warning: Cannot upsert address by placeholder id ${address.id}, treating as insert`);
          // Skip the existing check, will create new
        }
        
        let upserted;
        if (existing) {
          // Update existing
          upserted = await tx.address.update({
            where: { id: existing.id },
            data: {
              street1: address.street1,
              street2: address.street2,
              city: address.city,
              state: address.state,
              zipCode: address.zipCode,
              country: address.country || 'USA',
              fullAddress: address.fullAddress
            }
          });
        } else {
          // Create new
          console.log(`  - Creating new address`);
          upserted = await tx.address.create({
            data: {
              street1: address.street1,
              street2: address.street2,
              city: address.city,
              state: address.state,
              zipCode: address.zipCode,
              country: address.country || 'USA',
              fullAddress: address.fullAddress
            }
          });
          console.log(`  ✅ Created address with DB id=${upserted.id}`);
        }
        
        // Always set correlation map for address
        if (address.id !== undefined && address.id !== null) {
          this.correlationMap.Address.set(address.id, upserted.id);
          console.log(`  - Added to correlation map: JSON id=${address.id} -> DB id=${upserted.id}`);
        }
        this.insertedEntities.addresses.add(upserted.id);
        count++;
      } else if (action === 'Insert') {
        const created = await tx.address.create({
          data: {
            street1: address.street1,
            street2: address.street2,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
            country: address.country || 'USA',
            fullAddress: address.fullAddress
          }
        });
        
        // Always set correlation map for address
        if (address.id !== undefined && address.id !== null) {
          this.correlationMap.Address.set(address.id, created.id);
        }
        this.insertedEntities.addresses.add(created.id);
        count++;
      }
    }
    return count;
  }

  private async importTrials(tx: any, trials: TrialOverride[]): Promise<number> {
    let count = 0;
    for (const trial of trials) {
      const action = trial.overrideAction || 'Upsert';
      
      // Generate shortNameHandle from shortName if not provided
      const shortNameHandle = trial.shortNameHandle || 
        (trial.shortName ? generateFileToken(trial.shortName) : null);
      
      // ALWAYS derive caseHandle from caseNumber, never trust override data
      const caseHandle = generateCaseHandle(trial.caseNumber);
      
      // Handle ConditionalInsert
      if (action === 'ConditionalInsert') {
        // Check if trial exists by EITHER shortName OR caseNumber
        // This prevents duplicate key violations
        const existing = await tx.trial.findFirst({ 
          where: {
            OR: [
              { shortName: trial.shortName },
              { caseNumber: trial.caseNumber }
            ]
          }
        });
        
        if (existing) {
          const matchedBy = existing.shortName === trial.shortName ? 'shortName' : 'caseNumber';
          console.log(`ConditionalInsert: Trial exists (matched by ${matchedBy}), skipping creation`);
          console.log(`  Existing: id=${existing.id}, shortName="${existing.shortName}", caseNumber="${existing.caseNumber}"`);
          console.log(`  Override: shortName="${trial.shortName}", caseNumber="${trial.caseNumber}"`);
          if (trial.id) {
            this.correlationMap.Trial.set(trial.id, existing.id);
          }
          continue;
        }
        
        // Create new trial
        const created = await tx.trial.create({
          data: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseNumber: trial.caseNumber,
            caseHandle,
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            alternateCaseNumber: trial.alternateCaseNumber,
            alternateDefendant: trial.alternateDefendant,
            court: trial.court,
            courtDivision: trial.courtDivision,
            courtDistrict: trial.courtDistrict,
            totalPages: trial.totalPages
          }
        });
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, created.id);
        }
        count++;
      } else if (action === 'Insert') {
        // Create new trial
        const created = await tx.trial.create({
          data: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseNumber: trial.caseNumber,
            caseHandle, // Use derived value, not from override
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            alternateCaseNumber: trial.alternateCaseNumber,
            alternateDefendant: trial.alternateDefendant,
            court: trial.court,
            courtDivision: trial.courtDivision,
            courtDistrict: trial.courtDistrict,
            totalPages: trial.totalPages
          }
        });
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, created.id);
        }
        count++;
      } else if (action === 'Upsert') {
        // Determine upsert key based on overrideKey field
        const upsertKey = trial.overrideKey || 'caseNumber';
        const whereClause = upsertKey === 'shortName' 
          ? { shortName: trial.shortName }
          : { caseNumber: trial.caseNumber };
        
        // Upsert based on the specified key
        const upserted = await tx.trial.upsert({
          where: whereClause,
          create: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseNumber: trial.caseNumber,
            caseHandle, // Use derived value, not from override
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            alternateCaseNumber: trial.alternateCaseNumber,
            alternateDefendant: trial.alternateDefendant,
            court: trial.court,
            courtDivision: trial.courtDivision,
            courtDistrict: trial.courtDistrict,
            totalPages: trial.totalPages
          },
          update: {
            name: trial.name,
            shortName: trial.shortName,
            shortNameHandle,
            caseHandle, // Use derived value, not from override
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            alternateCaseNumber: trial.alternateCaseNumber,
            alternateDefendant: trial.alternateDefendant,
            court: trial.court,
            courtDivision: trial.courtDivision,
            courtDistrict: trial.courtDistrict,
            totalPages: trial.totalPages
          }
        });
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, upserted.id);
        }
        count++;
      } else if (action === 'Update') {
        // Update existing trial
        let updated;
        if (typeof trial.id === 'number') {
          // Update by ID
          updated = await tx.trial.update({
            where: { id: trial.id },
            data: {
              name: trial.name,
              shortName: trial.shortName,
              shortNameHandle,
              caseHandle, // Use derived value, not from override
              plaintiff: trial.plaintiff,
              defendant: trial.defendant,
              alternateCaseNumber: trial.alternateCaseNumber,
              alternateDefendant: trial.alternateDefendant,
              court: trial.court,
              courtDivision: trial.courtDivision,
              courtDistrict: trial.courtDistrict,
              totalPages: trial.totalPages
            }
          });
        } else {
          // Update by caseNumber as unique key
          updated = await tx.trial.update({
            where: { caseNumber: trial.caseNumber },
            data: {
              name: trial.name,
              shortName: trial.shortName,
              shortNameHandle,
              plaintiff: trial.plaintiff,
              defendant: trial.defendant,
              alternateCaseNumber: trial.alternateCaseNumber,
              alternateDefendant: trial.alternateDefendant,
              court: trial.court,
              courtDivision: trial.courtDivision,
              courtDistrict: trial.courtDistrict,
              totalPages: trial.totalPages
            }
          });
        }
        if (trial.id) {
          this.correlationMap.Trial.set(trial.id, updated.id);
        }
        count++;
      }
    }
    return count;
  }

  private async importLawFirms(tx: any, firms: LawFirmOverride[]): Promise<number> {
    let count = 0;
    for (const firm of firms) {
      const action = firm.overrideAction || 'Upsert';
      const overrideKey = firm.overrideKey || 'id';
      
      // For ConditionalInsert, only import if attorneys are being imported
      if (action === 'ConditionalInsert') {
        // Check if attorneys are being imported at all (not just inserted)
        const importingAttorneys = this.currentImportData?.Attorney && this.currentImportData.Attorney.length > 0;
        
        if (!importingAttorneys) {
          console.log(`ConditionalInsert: No attorneys being imported, skipping LawFirm ${firm.name}`);
          continue;
        }
      }
      
      let existingFirm = null;
      
      // Find existing firm based on override key
      if (action === 'Update' || action === 'Upsert' || action === 'ConditionalInsert') {
        if (overrideKey === 'id' && firm.id) {
          existingFirm = await tx.lawFirm.findUnique({
            where: { id: Number(firm.id) }
          });
        } else if (overrideKey === 'lawFirmFingerprint' && firm.lawFirmFingerprint) {
          existingFirm = await tx.lawFirm.findFirst({
            where: { lawFirmFingerprint: firm.lawFirmFingerprint }
          });
        }
      }
      
      // Handle ConditionalInsert - if exists, skip entirely
      if (action === 'ConditionalInsert' && existingFirm) {
        console.log(`ConditionalInsert: LawFirm exists (fingerprint=${firm.lawFirmFingerprint}), skipping`);
        this.correlationMap.LawFirm.set(firm.id || existingFirm.id, existingFirm.id);
        continue;
      }
      
      if (action === 'Insert' && existingFirm) {
        throw new Error(`LawFirm already exists with ${overrideKey}: ${firm[overrideKey as keyof LawFirmOverride]}`);
      }
      
      if (action === 'Update' && !existingFirm) {
        throw new Error(`LawFirm not found with ${overrideKey}: ${firm[overrideKey as keyof LawFirmOverride]}`);
      }
      
      let created;
      if (existingFirm) {
        // Update existing firm
        created = await tx.lawFirm.update({
          where: { id: existingFirm.id },
          data: {
            name: firm.name,
            lawFirmFingerprint: firm.lawFirmFingerprint
          }
        });
      } else {
        // Create new firm
        created = await tx.lawFirm.create({
          data: {
            name: firm.name,
            lawFirmFingerprint: firm.lawFirmFingerprint
          }
        });
        // Track that this firm was actually inserted
        this.insertedEntities.lawFirms.add(created.id);
      }
      
      this.correlationMap.LawFirm.set(firm.id || created.id, created.id);
      count++;
    }
    return count;
  }

  private async importLawFirmOffices(tx: any, offices: LawFirmOfficeOverride[]): Promise<number> {
    console.log(`\n[LawFirmOffice Import] Starting import of ${offices.length} offices`);
    console.log(`[LawFirmOffice Import] Current Address correlations:`, Array.from(this.correlationMap.Address.entries()));
    let count = 0;
    for (const office of offices) {
      console.log(`\n[LawFirmOffice Import] Processing office: ${office.name} (JSON id=${office.id})`);
      const action = office.overrideAction || 'Upsert';
      const overrideKey = office.overrideKey || 'id';
      
      // For ConditionalInsert, check if law firms are being imported
      if (action === 'ConditionalInsert') {
        const importingLawFirms = this.currentImportData?.LawFirm && this.currentImportData.LawFirm.length > 0;
        if (!importingLawFirms) {
          console.log(`ConditionalInsert: No law firms being imported, skipping LawFirmOffice ${office.name}`);
          continue;
        }
      }
      
      const lawFirmId = this.correlationMap.LawFirm.get(office.lawFirmId);
      console.log(`  - LawFirm mapping: JSON id=${office.lawFirmId} -> DB id=${lawFirmId}`);
      if (!lawFirmId) {
        throw new Error(`LawFirm not found for office: ${office.id}`);
      }

      const addressId = office.addressId ? 
        this.correlationMap.Address.get(office.addressId) : undefined;
      console.log(`  - Address mapping: JSON id=${office.addressId} -> DB id=${addressId}`);
      
      if (office.addressId && !addressId) {
        console.log(`  ⚠️ Warning: Address ${office.addressId} not found in correlation map for LawFirmOffice ${office.name}`);
        console.log(`  Available address mappings:`, Array.from(this.correlationMap.Address.entries()));
      }
      
      let existingOffice = null;
      
      // Find existing office based on override key
      if (action === 'Update' || action === 'Upsert' || action === 'ConditionalInsert') {
        if (overrideKey === 'id' && office.id) {
          existingOffice = await tx.lawFirmOffice.findUnique({
            where: { id: Number(office.id) }
          });
        } else if (overrideKey === 'lawFirmOfficeFingerprint' && office.lawFirmOfficeFingerprint) {
          existingOffice = await tx.lawFirmOffice.findFirst({
            where: { lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint }
          });
        }
      }
      
      // Handle ConditionalInsert - if exists, skip entirely
      if (action === 'ConditionalInsert' && existingOffice) {
        console.log(`ConditionalInsert: LawFirmOffice exists (fingerprint=${office.lawFirmOfficeFingerprint}), skipping`);
        this.correlationMap.LawFirmOffice.set(office.id || existingOffice.id, existingOffice.id);
        continue;
      }
      
      if (action === 'Insert' && existingOffice) {
        throw new Error(`LawFirmOffice already exists with ${overrideKey}: ${office[overrideKey as keyof LawFirmOfficeOverride]}`);
      }
      
      if (action === 'Update' && !existingOffice) {
        throw new Error(`LawFirmOffice not found with ${overrideKey}: ${office[overrideKey as keyof LawFirmOfficeOverride]}`);
      }
      
      let created;
      if (existingOffice) {
        // Update existing office - check for address conflicts
        let finalAddressId = addressId;
        if (addressId && existingOffice.addressId !== addressId) {
          const existingWithAddress = await tx.lawFirmOffice.findFirst({
            where: { 
              addressId,
              NOT: { id: existingOffice.id }
            }
          });
          if (existingWithAddress) {
            console.log(`  ⚠️ WARNING: Address ${addressId} is already used by LawFirmOffice ${existingWithAddress.id} (${existingWithAddress.name})`);
            console.log(`  ⚠️ Keeping existing addressId to avoid conflict`);
            finalAddressId = existingOffice.addressId;
          }
        }
        
        created = await tx.lawFirmOffice.update({
          where: { id: existingOffice.id },
          data: {
            lawFirmId,
            name: office.name,
            addressId: finalAddressId,
            lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
          }
        });
      } else {
        // Check if office already exists with same lawFirmId and name
        const existingByName = await tx.lawFirmOffice.findFirst({
          where: {
            lawFirmId,
            name: office.name
          }
        });
        
        if (existingByName) {
          // Update the existing office instead of creating a duplicate
          created = await tx.lawFirmOffice.update({
            where: { id: existingByName.id },
            data: {
              addressId,
              lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
            }
          });
        } else {
          // Create new office
          console.log(`  - Creating new LawFirmOffice with data:`, {
            lawFirmId,
            name: office.name,
            addressId,
            lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
          });
          
          // Check if addressId is already in use
          let finalAddressId = addressId;
          if (addressId) {
            const existingWithAddress = await tx.lawFirmOffice.findFirst({
              where: { addressId }
            });
            if (existingWithAddress) {
              console.log(`  ⚠️ WARNING: Address ${addressId} is already used by LawFirmOffice ${existingWithAddress.id} (${existingWithAddress.name})`);
              console.log(`  ⚠️ Creating LawFirmOffice without address to avoid conflict`);
              finalAddressId = undefined;
            }
          }
          
          created = await tx.lawFirmOffice.create({
            data: {
              lawFirmId,
              name: office.name,
              addressId: finalAddressId,
              lawFirmOfficeFingerprint: office.lawFirmOfficeFingerprint
            }
          });
          console.log(`  ✅ Created LawFirmOffice with DB id=${created.id}`);
          // Track that this office was actually inserted
          this.insertedEntities.lawFirmOffices.add(created.id);
        }
      }
      
      this.correlationMap.LawFirmOffice.set(office.id || created.id, created.id);
      count++;
    }
    return count;
  }

  private async importAttorneys(tx: any, attorneys: AttorneyOverride[]): Promise<number> {
    let count = 0;
    
    // We need a trial ID for creating speakers
    // Get the first trial from our correlation map
    const trialIds = Array.from(this.correlationMap.Trial.values());
    if (trialIds.length === 0) {
      throw new Error('No trial found to associate attorneys with. Import trials first.');
    }
    const trialId = trialIds[0];
    
    for (const attorney of attorneys) {
      const action = attorney.overrideAction || 'Upsert';
      const overrideKey = attorney.overrideKey || 'id';
      
      // Generate attorney fingerprint (use provided or generate)
      const fingerprint = attorney.attorneyFingerprint || this.generateAttorneyFingerprint(attorney);
      
      let existingAttorney = null;
      
      // Find existing attorney based on override key
      if (action === 'Update' || action === 'Upsert' || action === 'ConditionalInsert') {
        if (overrideKey === 'id' && attorney.id) {
          existingAttorney = await tx.attorney.findUnique({
            where: { id: Number(attorney.id) }
            // speaker relation removed - now on TrialAttorney
          });
        } else if (overrideKey === 'attorneyFingerprint' && fingerprint) {
          existingAttorney = await tx.attorney.findFirst({
            where: { attorneyFingerprint: fingerprint }
            // speaker relation removed - now on TrialAttorney
          });
        }
      }
      
      // Handle ConditionalInsert - if exists, skip entirely
      if (action === 'ConditionalInsert' && existingAttorney) {
        console.log(`ConditionalInsert: Attorney exists (fingerprint=${fingerprint}), skipping`);
        this.correlationMap.Attorney.set(attorney.id || existingAttorney.id, existingAttorney.id);
        continue; // Skip this attorney entirely
      }
      
      if (action === 'Insert' && existingAttorney) {
        throw new Error(`Attorney already exists with ${overrideKey}: ${attorney[overrideKey as keyof AttorneyOverride]}`);
      }
      
      if (action === 'Update' && !existingAttorney) {
        throw new Error(`Attorney not found with ${overrideKey}: ${attorney[overrideKey as keyof AttorneyOverride]}`);
      }
      
      let created;
      
      if (existingAttorney) {
        // Update existing attorney
        // Update attorney
        created = await tx.attorney.update({
          where: { id: existingAttorney.id },
          data: {
            name: attorney.name,
            title: attorney.title,
            firstName: attorney.firstName,
            middleInitial: attorney.middleInitial,
            lastName: attorney.lastName,
            suffix: attorney.suffix,
            speakerPrefix: attorney.speakerPrefix,
            barNumber: attorney.barNumber,
            attorneyFingerprint: fingerprint
          }
        });
      } else {
        // Create new attorney (without speaker - speakers are created during parsing)
        created = await tx.attorney.create({
          data: {
            name: attorney.name,
            title: attorney.title,
            firstName: attorney.firstName,
            middleInitial: attorney.middleInitial,
            lastName: attorney.lastName,
            suffix: attorney.suffix,
            speakerPrefix: attorney.speakerPrefix,
            barNumber: attorney.barNumber,
            attorneyFingerprint: fingerprint
            // Note: speakerId removed - speakers are created during transcript parsing
          }
        });
        // Track that this attorney was actually inserted
        this.insertedEntities.attorneys.add(created.id);
      }
      
      this.correlationMap.Attorney.set(attorney.id || created.id, created.id);
      // Note: Speaker correlation removed - speakers are created during parsing
      count++;
    }
    return count;
  }
  
  private generateAttorneyFingerprint(attorney: AttorneyOverride): string {
    // Generate a consistent fingerprint for attorney matching
    // This can be used to identify the same attorney across different trials
    const parts = [
      attorney.lastName?.toUpperCase(),
      attorney.firstName?.toUpperCase(),
      attorney.middleInitial?.toUpperCase(),
      attorney.suffix?.toUpperCase()
    ].filter(Boolean);
    return parts.join('_');
  }

  private async importJudges(tx: any, judges: JudgeOverride[]): Promise<number> {
    let count = 0;
    for (const judge of judges) {
      const trialId = judge.trialId ? 
        this.correlationMap.Trial.get(judge.trialId) : undefined;
      
      if (!trialId) {
        throw new Error(`Trial not found for judge: ${judge.name}`);
      }

      const action = judge.overrideAction?.toLowerCase() || 'insert';
      let created;
      
      if (action === 'upsert' && judge.judgeFingerprint) {
        // Check if a judge exists for this trial already
        const existingForTrial = await tx.judge.findUnique({
          where: { trialId }
        });
        
        if (existingForTrial) {
          // Update the existing judge for this trial
          created = await tx.judge.update({
            where: { id: existingForTrial.id },
            data: {
              name: judge.name,
              title: judge.title,
              honorific: judge.honorific,
              judgeFingerprint: judge.judgeFingerprint
            }
          });
        } else {
          // Create a new judge for this trial
          created = await tx.judge.create({
            data: {
              name: judge.name,
              title: judge.title,
              honorific: judge.honorific,
              judgeFingerprint: judge.judgeFingerprint,
              trialId
            }
          });
        }
      } else {
        // Create judge (without speaker - speakers are created during parsing)
        created = await tx.judge.create({
          data: {
            name: judge.name,
            title: judge.title,
            honorific: judge.honorific,
            judgeFingerprint: judge.judgeFingerprint,
            // Note: speakerId removed - speakers are created during transcript parsing
            trialId
          }
        });
      }
      
      if (judge.id) {
        this.correlationMap.Judge.set(judge.id, created.id);
      }
      count++;
    }
    return count;
  }

  private async importCourtReporters(tx: any, reporters: CourtReporterOverride[]): Promise<number> {
    let count = 0;
    for (const reporter of reporters) {
      const trialId = reporter.trialId ? 
        this.correlationMap.Trial.get(reporter.trialId) : undefined;
      
      if (!trialId) {
        throw new Error(`Trial not found for court reporter: ${reporter.name}`);
      }

      const addressId = reporter.addressId ? 
        this.correlationMap.Address.get(reporter.addressId) : undefined;

      const action = reporter.overrideAction?.toLowerCase() || 'insert';
      let created;
      
      if (action === 'upsert' && reporter.courtReporterFingerprint) {
        // Check if a court reporter exists for this trial already
        const existingForTrial = await tx.courtReporter.findUnique({
          where: { trialId }
        });
        
        if (existingForTrial) {
          // Update the existing court reporter for this trial
          created = await tx.courtReporter.update({
            where: { id: existingForTrial.id },
            data: {
              name: reporter.name,
              credentials: reporter.credentials,
              title: reporter.title,
              stateNumber: reporter.stateNumber,
              expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
              addressId,
              phone: reporter.phone,
              courtReporterFingerprint: reporter.courtReporterFingerprint
            }
          });
        } else {
          // Create a new court reporter for this trial
          created = await tx.courtReporter.create({
            data: {
              name: reporter.name,
              credentials: reporter.credentials,
              title: reporter.title,
              stateNumber: reporter.stateNumber,
              expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
              addressId,
              phone: reporter.phone,
              courtReporterFingerprint: reporter.courtReporterFingerprint,
              trialId
            }
          });
        }
      } else {
        // Create new court reporter
        created = await tx.courtReporter.create({
          data: {
            name: reporter.name,
            credentials: reporter.credentials,
            title: reporter.title,
            stateNumber: reporter.stateNumber,
            expirationDate: reporter.expirationDate ? new Date(reporter.expirationDate) : undefined,
            addressId,
            phone: reporter.phone,
            trialId,
            courtReporterFingerprint: reporter.courtReporterFingerprint
          }
        });
      }
      if (reporter.id) {
        this.correlationMap.CourtReporter.set(reporter.id, created.id);
      }
      count++;
    }
    return count;
  }

  private async importTrialAttorneys(tx: any, trialAttorneys: TrialAttorneyOverride[]): Promise<number> {
    let count = 0;
    for (const ta of trialAttorneys) {
      const action = ta.overrideAction || 'Upsert';

      const trialId = this.correlationMap.Trial.get(ta.trialId) || ta.trialId;
      const attorneyId = this.correlationMap.Attorney.get(ta.attorneyId) || ta.attorneyId;
      const lawFirmId = ta.lawFirmId ?
        (this.correlationMap.LawFirm.get(ta.lawFirmId) || ta.lawFirmId) : undefined;
      let lawFirmOfficeId = ta.lawFirmOfficeId ?
        (this.correlationMap.LawFirmOffice.get(ta.lawFirmOfficeId) || ta.lawFirmOfficeId) : undefined;

      // Convert 'side' to 'role' if present (for LLM-generated metadata compatibility)
      let role = ta.role;
      if (!role && (ta as any).side) {
        const side = ((ta as any).side as string).toLowerCase();
        if (side === 'plaintiff') {
          role = 'PLAINTIFF';
        } else if (side === 'defendant') {
          role = 'DEFENDANT';
        } else if (side === 'third_party' || side === 'third party') {
          role = 'THIRD_PARTY';
        }
      }

      if (!trialId || !attorneyId) {
        console.log(`Skipping TrialAttorney: missing required IDs (trial=${ta.trialId}, attorney=${ta.attorneyId})`);
        continue;
      }
      
      // If lawFirmOfficeId is missing (due to address conflict), just proceed without it
      if (ta.lawFirmOfficeId && !lawFirmOfficeId) {
        console.log(`⚠️ WARNING: LawFirmOffice ${ta.lawFirmOfficeId} not found (likely due to address conflict), proceeding without office assignment`);
        lawFirmOfficeId = undefined;
      }
      
      // Additional validation: ensure the lawFirmOfficeId actually exists in the database
      if (lawFirmOfficeId) {
        const officeExists = await tx.lawFirmOffice.findUnique({
          where: { id: Number(lawFirmOfficeId) }
        });
        
        if (!officeExists) {
          console.log(`⚠️ WARNING: LawFirmOffice ID ${lawFirmOfficeId} does not exist in database, clearing reference`);
          lawFirmOfficeId = undefined;
        }
      }
      
      // Handle ConditionalInsert
      if (action === 'ConditionalInsert') {
        // Check if the TrialAttorney association already exists
        const existing = await tx.trialAttorney.findUnique({
          where: {
            trialId_attorneyId: {
              trialId: Number(trialId),
              attorneyId: Number(attorneyId)
            }
          }
        });
        
        if (existing) {
          console.log(`ConditionalInsert: TrialAttorney association already exists for attorney ${attorneyId} in trial ${trialId}, skipping`);
          continue;
        }
        
        // Create new association
        await tx.trialAttorney.create({
          data: {
            trialId: Number(trialId),
            attorneyId: Number(attorneyId),
            speakerId: ta.speakerId || null,
            lawFirmId: lawFirmId ? Number(lawFirmId) : undefined,
            lawFirmOfficeId: lawFirmOfficeId ? Number(lawFirmOfficeId) : undefined,
            role: role || 'UNKNOWN'
          }
        });
        count++;
      } else if (action === 'Upsert') {
        // Upsert based on unique constraint
        await tx.trialAttorney.upsert({
          where: {
            trialId_attorneyId: {
              trialId: Number(trialId),
              attorneyId: Number(attorneyId)
            }
          },
          create: {
            trialId: Number(trialId),
            attorneyId: Number(attorneyId),
            speakerId: ta.speakerId || null,
            lawFirmId: lawFirmId ? Number(lawFirmId) : undefined,
            lawFirmOfficeId: lawFirmOfficeId ? Number(lawFirmOfficeId) : undefined,
            role: role || 'UNKNOWN'
          },
          update: {
            speakerId: ta.speakerId || null,
            lawFirmId: lawFirmId ? Number(lawFirmId) : undefined,
            lawFirmOfficeId: lawFirmOfficeId ? Number(lawFirmOfficeId) : undefined,
            role: role || 'UNKNOWN'
          }
        });
        count++;
      } else if (action === 'Insert') {
        // Always create new
        await tx.trialAttorney.create({
          data: {
            trialId: Number(trialId),
            attorneyId: Number(attorneyId),
            speakerId: ta.speakerId || null,
            lawFirmId: lawFirmId ? Number(lawFirmId) : undefined,
            lawFirmOfficeId: lawFirmOfficeId ? Number(lawFirmOfficeId) : undefined,
            role: role || 'UNKNOWN'
          }
        });
        count++;
      }
    }
    return count;
  }

  private async importWitnesses(tx: any, witnesses: WitnessOverride[]): Promise<number> {
    let count = 0;
    
    // Get the first trial from our correlation map for speaker creation
    const trialIds = Array.from(this.correlationMap.Trial.values());
    if (trialIds.length === 0) {
      throw new Error('No trial found to associate witnesses with. Import trials first.');
    }
    const trialId = trialIds[0];
    
    for (const witness of witnesses) {
      const action = witness.overrideAction || 'Upsert';
      
      if (action === 'Insert') {
        // Create new witness (without speaker - speakers are created during parsing)
        const created = await tx.witness.create({
          data: {
            trialId: witness.trialId ? this.correlationMap.Trial.get(witness.trialId) || trialId : trialId,
            name: witness.name,
            witnessType: witness.witnessType || 'UNKNOWN',
            witnessCaller: witness.witnessCaller || 'UNKNOWN',
            expertField: witness.expertField
            // Note: speakerId removed - speakers are created during transcript parsing
          }
        });
        
        if (witness.id) {
          this.correlationMap.Witness.set(witness.id, created.id);
        }
        count++;
      } else {
        // Update existing witness by name (as unique key within trial)
        const existingWitness = await tx.witness.findFirst({
          where: {
            trialId: witness.trialId ? this.correlationMap.Trial.get(witness.trialId) || trialId : trialId,
            name: witness.name
          }
        });
        
        if (existingWitness) {
          await tx.witness.update({
            where: { id: existingWitness.id },
            data: {
              witnessType: witness.witnessType || existingWitness.witnessType,
              witnessCaller: witness.witnessCaller || existingWitness.witnessCaller,
              expertField: witness.expertField !== undefined ? witness.expertField : existingWitness.expertField
            }
          });
          
          if (witness.id) {
            this.correlationMap.Witness.set(witness.id, existingWitness.id);
          }
          count++;
        }
      }
    }
    return count;
  }

  private async importMarkers(tx: any, markers: MarkerOverride[]): Promise<number> {
    let count = 0;
    
    for (const marker of markers) {
      const action = marker.overrideAction || 'Upsert';
      const trialId = marker.trialId ? this.correlationMap.Trial.get(marker.trialId) : null;
      
      if (!trialId) {
        throw new Error(`Trial not found for marker: ${marker.name}`);
      }
      
      if (action === 'Insert') {
        // Create new marker
        const created = await tx.marker.create({
          data: {
            trialId,
            name: marker.name,
            markerType: marker.markerType || 'CUSTOM',
            startLineId: marker.startLineId ? Number(marker.startLineId) : null,
            endLineId: marker.endLineId ? Number(marker.endLineId) : null,
            metadata: marker.metadata || {}
          }
        });
        
        if (marker.id) {
          this.correlationMap.Marker.set(marker.id, created.id);
        }
        count++;
      } else {
        // Update existing marker - would need unique identifier
        // For now, skip updates as markers don't have a natural unique key
        console.warn(`Marker updates not yet supported for: ${marker.name}`);
      }
    }
    return count;
  }

  private async importMarkerSections(tx: any, sections: MarkerSectionOverride[]): Promise<number> {
    let count = 0;
    
    for (const section of sections) {
      const action = section.overrideAction || 'Upsert';
      const markerId = this.correlationMap.Marker.get(section.markerId);
      
      if (!markerId) {
        throw new Error(`Marker not found for section: ${section.sectionName}`);
      }
      
      if (action === 'Insert') {
        // Create new marker section
        const created = await tx.markerSection.create({
          data: {
            markerId,
            sectionName: section.sectionName,
            startLineId: section.startLineId ? Number(section.startLineId) : null,
            endLineId: section.endLineId ? Number(section.endLineId) : null,
            orderIndex: section.orderIndex || 0
          }
        });
        
        if (section.id) {
          this.correlationMap.MarkerSection.set(section.id, created.id);
        }
        count++;
      } else {
        // Update existing marker section - would need unique identifier
        console.warn(`MarkerSection updates not yet supported for: ${section.sectionName}`);
      }
    }
    return count;
  }

  getCorrelationMap(): CorrelationMap {
    return this.correlationMap;
  }
}