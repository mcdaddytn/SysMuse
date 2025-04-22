// === src/lib/config.ts ===
import fs from 'fs';

export function loadConfig(configFile: string) {
  return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
}