// src/utils/timeUtils.ts

import type { TimeIncrementType, TeamMember } from 'src/types/models';

/**
 * Format time value based on increment type
 */
export function formatTime(value: number, timeIncrementType: TimeIncrementType): string {
  if (timeIncrementType === 'PERCENT') {
    return `${value}%`;
  } else {
    // Convert minutes to HH:MM format
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}

/**
 * Parse time input based on increment type
 */
export function parseTimeInput(input: string, timeIncrementType: TimeIncrementType): number {
  if (timeIncrementType === 'PERCENT') {
    return parseInt(input) || 0;
  } else {
    // Parse HH:MM format
    const parts = input.split(':');
    if (parts.length === 2) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      return hours * 60 + minutes;
    }
    return parseInt(input) || 0;
  }
}

/**
 * Convert time value to display format with tooltip
 */
export function formatTimeWithTooltip(
  value: number, 
  timeIncrementType: TimeIncrementType, 
  teamMember: TeamMember
): { display: string; tooltip: string } {
  if (timeIncrementType === 'PERCENT') {
    const hours = (value / 100) * teamMember.workingHours;
    return {
      display: `${value}%`,
      tooltip: `${hours.toFixed(1)} hours`
    };
  } else {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    const percentage = teamMember.workingHours > 0 ? (value / (teamMember.workingHours * 60)) * 100 : 0;
    return {
      display: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
      tooltip: `${percentage.toFixed(1)}% of total time`
    };
  }
}

/**
 * Calculate total time in appropriate format
 */
export function calculateTotalTime(values: number[], timeIncrementType: TimeIncrementType): number {
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * Get maximum time value based on increment type and working hours
 */
export function getMaxTimeValue(timeIncrementType: TimeIncrementType, workingHours: number): number {
  if (timeIncrementType === 'PERCENT') {
    return 100;
  } else {
    return workingHours * 60; // Convert hours to minutes
  }
}

/**
 * Get time increment step for spin controls
 */
export function getTimeIncrementStep(timeIncrementType: TimeIncrementType, timeIncrement: number): number {
  if (timeIncrementType === 'PERCENT') {
    return timeIncrement; // Should always be 1 for percent
  } else {
    return timeIncrement; // Minutes increment
  }
}

/**
 * Validate time increment value
 */
export function validateTimeIncrement(timeIncrementType: TimeIncrementType, timeIncrement: number): number {
  const validHourMinuteIncrements = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30];
  
  if (timeIncrementType === 'PERCENT') {
    return 1; // Only valid value for percent
  } else if (timeIncrementType === 'HOURS_MINUTES') {
    // Find the closest valid increment
    if (validHourMinuteIncrements.includes(timeIncrement)) {
      return timeIncrement;
    }
    
    // Find the closest valid value
    let closest = validHourMinuteIncrements[0];
    let minDiff = Math.abs(timeIncrement - closest);
    
    for (const validIncrement of validHourMinuteIncrements) {
      const diff = Math.abs(timeIncrement - validIncrement);
      if (diff < minDiff) {
        minDiff = diff;
        closest = validIncrement;
      }
    }
    
    return closest;
  }
  
  return 1; // Default fallback
}

/**
 * Check if total time is valid (100% for percent mode, or within working hours for time mode)
 */
export function isValidTotalTime(
  total: number, 
  timeIncrementType: TimeIncrementType, 
  workingHours: number
): boolean {
  if (timeIncrementType === 'PERCENT') {
    return total === 100;
  } else {
    return total <= workingHours * 60; // Working hours converted to minutes
  }
}