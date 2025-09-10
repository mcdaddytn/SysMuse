# Address Unique Constraint Bug - Implementation Guide

## Issue Description
When importing multiple trials sequentially, we're encountering a unique constraint violation on the `addressId` field in the `LawFirmOffice` table. This occurs even though we're properly using the correlation map to translate JSON placeholder IDs to database IDs.

## Root Cause Analysis

### Database Schema
```prisma
model LawFirmOffice {
  addressId  Int?  @unique  // ← This unique constraint is the issue
  // ... other fields
}
```

The `@unique` constraint means each address can only be associated with ONE law firm office across the entire database.

### Current Behavior
1. Trial 1 imports successfully, creating addresses and law firm offices
2. Trial 2 attempts to import, but its law firm offices try to use addressIds that are already taken
3. Even with proper correlation mapping, the unique constraint prevents multiple offices from sharing addresses

### The Problem
The correlation map correctly translates JSON IDs to database IDs, but this doesn't solve the fundamental issue:
- Different trials have different law firm offices
- These offices might legitimately share the same physical address
- The unique constraint prevents this sharing

## Current Implementation Status

### ✅ What's Working
1. **Correlation Map**: Properly translates JSON placeholder IDs to database IDs
2. **Import Order**: Addresses imported before LawFirmOffices
3. **ConditionalInsert**: Prevents duplicate entities
4. **Logging**: Comprehensive logging added to debug ID mappings

### ❌ What's Not Working
1. **Address Sharing**: Multiple LawFirmOffices cannot share the same address
2. **Cross-Trial Conflicts**: Offices from different trials conflict on addressId

## Detailed Bug Scenario

### Example Flow
```
Trial 1 (01 Genband):
  - Creates Address ID 1 (Dallas office)
  - Creates LawFirmOffice ID 1, assigns addressId = 1 ✅

Trial 2 (02 Contentguard):
  - Creates/finds Address ID 8 (Chicago office)  
  - Creates LawFirmOffice ID 9, assigns addressId = 8
  - If any office tries to reuse an existing addressId → CONSTRAINT VIOLATION ❌
```

## Proposed Solutions

### Solution 1: Remove Unique Constraint (Recommended)
**Change the schema to allow address sharing:**

```prisma
model LawFirmOffice {
  addressId  Int?  // Remove @unique constraint
  address    Address?  @relation(...)
}

model Address {
  lawFirmOffices  LawFirmOffice[]  // Change to one-to-many
}
```

**Pros:**
- Allows legitimate address sharing
- Reflects real-world scenario (multiple offices can share a building)
- Minimal code changes required

**Cons:**
- Requires database migration
- Changes data model assumptions

### Solution 2: Duplicate Addresses
**Create separate address records for each office:**

```typescript
// In importLawFirmOffices
if (addressId && existingWithAddress) {
  // Create a duplicate address for this office
  const originalAddress = await tx.address.findUnique({ where: { id: addressId } });
  const newAddress = await tx.address.create({
    data: { ...originalAddress, id: undefined }
  });
  addressId = newAddress.id;
}
```

**Pros:**
- No schema changes required
- Works with current constraints

**Cons:**
- Data duplication
- Complicates address updates
- Not semantically correct

### Solution 3: Address Pool with Junction Table
**Create a many-to-many relationship:**

```prisma
model LawFirmOfficeAddress {
  id              Int @id @default(autoincrement())
  lawFirmOfficeId Int @unique
  addressId       Int
  lawFirmOffice   LawFirmOffice @relation(...)
  address         Address @relation(...)
  
  @@index([addressId])
}
```

**Pros:**
- Maintains referential integrity
- Allows complex address relationships

**Cons:**
- Requires significant refactoring
- Adds complexity

## Immediate Next Steps

### 1. Add Diagnostic Logging (COMPLETED ✅)
```typescript
console.log(`[LawFirmOffice Import] Processing office: ${office.name}`);
console.log(`  - Address mapping: JSON id=${office.addressId} -> DB id=${addressId}`);
// Check for existing usage
const existingWithAddress = await tx.lawFirmOffice.findFirst({
  where: { addressId }
});
if (existingWithAddress) {
  console.log(`  ❌ ERROR: Address ${addressId} already used by office ${existingWithAddress.id}`);
}
```

### 2. Temporary Workaround
Until schema is fixed, implement address duplication:

```typescript
// In importLawFirmOffices, before creating office
if (addressId) {
  const conflict = await tx.lawFirmOffice.findFirst({ 
    where: { addressId } 
  });
  
  if (conflict) {
    console.log(`  ⚠️ Address conflict detected, creating duplicate`);
    // Fetch original address data
    const original = await tx.address.findUnique({ 
      where: { id: addressId } 
    });
    // Create duplicate
    const duplicate = await tx.address.create({
      data: {
        street1: original.street1,
        street2: original.street2,
        city: original.city,
        state: original.state,
        zipCode: original.zipCode,
        country: original.country,
        fullAddress: original.fullAddress + ' (dup)'
      }
    });
    addressId = duplicate.id;
    // Update correlation map
    this.correlationMap.Address.set(office.addressId, duplicate.id);
  }
}
```

### 3. Long-term Fix
1. Update schema.prisma to remove `@unique` from `addressId`
2. Change Address relation to one-to-many
3. Run migration: `npx prisma migrate dev`
4. Update seed data if necessary
5. Test with multiple trials

## Testing Strategy

### Test Case 1: Single Trial Import
```bash
npx prisma db push --force-reset
npx ts-node src/cli/override.ts import "output/multi-trial/01 Genband/trial-metadata.json"
# Should succeed ✅
```

### Test Case 2: Multiple Trial Import
```bash
npx prisma db push --force-reset
npx ts-node src/cli/override.ts import "output/multi-trial/01 Genband/trial-metadata.json"
npx ts-node src/cli/override.ts import "output/multi-trial/02 Contentguard/trial-metadata.json"
# Currently fails ❌
# Should succeed after fix ✅
```

### Test Case 3: Re-import Same Trial
```bash
npx ts-node src/cli/override.ts import "output/multi-trial/01 Genband/trial-metadata.json"
npx ts-node src/cli/override.ts import "output/multi-trial/01 Genband/trial-metadata.json"
# Should skip duplicates via ConditionalInsert ✅
```

## Command Reference

### Debug Import with Logging
```bash
# Reset and import with full logging
npx prisma db push --force-reset
npx ts-node src/cli/override.ts import "output/multi-trial/01 Genband/trial-metadata.json" 2>&1 | tee import-debug.log

# Check for address conflicts
grep "ERROR: Address" import-debug.log
grep "correlation map" import-debug.log
```

### Check Database State
```typescript
// Check address usage
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const offices = await p.lawFirmOffice.findMany({
    include: { address: true, lawFirm: true }
  });
  console.log('LawFirmOffices with addresses:');
  offices.forEach(o => {
    console.log(`  ${o.lawFirm.name} - ${o.name}: addressId=${o.addressId}`);
  });
  await p.$disconnect();
})();
```

## Decision Required

**Recommended Action**: Implement Solution 1 (Remove Unique Constraint)

This is the most straightforward fix that aligns with real-world data modeling where multiple offices can share the same address. The constraint appears to be an incorrect assumption in the original schema design.

## Files Affected
- `/prisma/schema.prisma` - Remove @unique from addressId
- `/src/services/override/OverrideImporter.ts` - Already has logging, may need workaround
- `/docs/impl/address-constraint-bug-implementation.md` - This documentation

## Timeline
1. **Immediate**: Deploy workaround (address duplication) to unblock testing
2. **Next Sprint**: Update schema and migrate database
3. **Future**: Consider more sophisticated address management if needed