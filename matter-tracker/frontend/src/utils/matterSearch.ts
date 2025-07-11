// src/utils/matterSearch.ts

import type { Matter, MatterLookaheadMode } from 'src/types/models';

export function filterMatters(
  matters: Matter[], 
  searchQuery: string, 
  mode: MatterLookaheadMode
): Matter[] {
  if (!searchQuery) {
    return matters;
  }

  const needle = searchQuery.toLowerCase();
  
  switch (mode) {
    case 'COMBINED_STARTS_WITH':
      return matters.filter(matter => {
        const combined = `${matter.client.name} ${matter.name}`.toLowerCase();
        return combined.startsWith(needle);
      });
      
    case 'INDIVIDUAL_STARTS_WITH':
      return matters.filter(matter => {
        const clientName = matter.client.name.toLowerCase();
        const matterName = matter.name.toLowerCase();
        return clientName.startsWith(needle) || matterName.startsWith(needle);
      });
      
    case 'COMBINED_CONTAINS':
      return matters.filter(matter => {
        const combined = `${matter.client.name} ${matter.name}`.toLowerCase();
        return combined.includes(needle);
      });
      
    case 'INDIVIDUAL_CONTAINS':
    default:
      return matters.filter(matter => {
        const clientName = matter.client.name.toLowerCase();
        const matterName = matter.name.toLowerCase();
        return clientName.includes(needle) || matterName.includes(needle);
      });
  }
}

export function getMatterDisplayString(matter: Matter): string {
  return `${matter.client.name} - ${matter.name}`;
}