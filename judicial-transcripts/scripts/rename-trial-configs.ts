#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
import { generateFileToken } from '../src/utils/fileTokenGenerator';

// Map of old file patterns to shortNames based on multi-trial-config-mac.json
const trialMappings: { [key: string]: string } = {
  '01-01-genband.json': '01 Genband',
  '02-02-contentguard.json': '02 Contentguard',
  '03-03-core-wireless.json': '03 Core Wireless',
  '04-04-intellectual-ventures.json': '04 Intellectual Ventures',
  '05-05-personalized-media-v-zynga.json': '05 Personalized Media v Zynga',
  '06-06-simpleair.json': '06 Simpleair',
  '07-07-usa-re-joshua-harman-v-trinity-industries.json': '07 Usa Re Joshua Harman V Trinity Industries',
  '10-10-metaswitch-genband-2016.json': '10 Metaswitch Genband 2016',
  '11-11-dataquill-limited-v--zte-corporation-et-al.json': '11 Dataquill Limited V. Zte Corporation Et Al',
  '12-12-gree-supercell.json': '12 Gree Supercell',
  '14-14-optis-wireless-technology-v--apple-inc.json': '14 Optis Wireless Technology V. Apple Inc',
  '15-15-optis-wireless-technology-v--huawei.json': '15 Optis Wireless Technology V. Huawei',
  '16-16-saint-lawrence-v--motorola.json': '16 Saint Lawrence V. Motorola',
  '17-17-wi-lan-v--apple.json': '17 Wi-Lan V. Apple,',
  '18-18-wi-lan-v--htc.json': '18 Wi-Lan V. Htc',
  '19-19-alfonso-cioffi-et-al-v--google.json': '19 Alfonso Cioffi Et Al V. Google',
  '20-20-biscotti-inc--v--microsoft-corp.json': '20 Biscotti Inc. V. Microsoft Corp',
  '21-21-cassidian-v-microdata.json': '21 Cassidian V Microdata',
  '22-22-core-wireless-v--apple.json': '22 Core Wireless V. Apple',
  '23-23-flexuspine-v--globus-medical.json': '23 Flexuspine V. Globus Medical',
  '24-24-fractus-v--t-mobile-us.json': '24 Fractus V. T-Mobile Us',
  '28-28-implicit-v-netscout.json': '28 Implicit V Netscout',
  '29-29-intellectual-ventures-v--t-mobile.json': '29 Intellectual Ventures V. T Mobile',
  '30-30-kaist-ip-us-llc-v--samsung.json': '30 Kaist Ip Us Llc V. Samsung',
  '31-31-mobile-tele-v--htc.json': '31 Mobile Tele V. Htc',
  '32-32-netlist-v-samsung.json': '32 Netlist V Samsung',
  '33-33-personal-audio-v--cbs.json': '33 Personal Audio V. Cbs',
  '34-34-personalized-media-v-google.json': '34 Personalized Media V Google',
  '35-35-rembrandt-v-samsung.json': '35 Rembrandt V Samsung',
  '36-36-salazar-v--htc.json': '36 Salazar V. Htc',
  '37-37-simpleair-v--google.json': '37 Simpleair V. Google',
  '39-39-tqp-development-llc-vs-v--1-800-flowers.json': '39 Tqp Development Llc Vs V. 1-800-Flowers',
  '40-40-usaa-v-wells.json': '40 USAA V Wells',
  '42-42-vocalife-amazon.json': '42 Vocalife Amazon',
  '43-43-whirlpool-v--tst.json': '43 Whirlpool V. Tst',
  '44-44-beneficial-v--advance.json': '44 Beneficial V. Advance',
  '45-45-chrimar-v--dell.json': '45 Chrimar V. Dell',
  '46-46-droplets-v--ebay.json': '46 Droplets V. Ebay',
  '48-48-intellectual-v-great-west.json': '48 Intellectual V Great West',
  '49-49-luvncare-v-royal-king.json': '49 Luvncare V Royal King',
  '50-50-packet-netscout.json': '50 Packet Netscout',
  '50-50-packet.json': '50 Packet',
  '51-51-packet-sandvine.json': '51 Packet Sandvine',
  '52-52-personalized-apple.json': '52 Personalized Apple',
  '55-55-ssl-v-citrix.json': '55 SSL V Citrix',
  '59-59-gree-v--supercell.json': '59 Gree V. Supercell',
  '61-61-nichia-corporation-v--everlight-electronics.json': '61 Nichia Corporation V. Everlight Electronics',
  '62-62-simpleair-v--google-582.json': '62 Simpleair V. Google 582',
  '63-63-solas-oled-ltd--v--samsung.json': '63 Solas Oled Ltd. V. Samsung',
  '65-65-ticketnetwork-v--ceats.json': '65 Ticketnetwork V. Ceats',
  '67-67-gonzalez-v--new-life.json': '67 Gonzalez V. New Life',
  '68-68-contentguard-holdings--inc--v--google.json': '68 Contentguard Holdings, Inc. V. Google',
  '71-71-hinson-et-al-v--dorel.json': '71 Hinson Et Al V. Dorel',
  '72-72-taylor-v-turner.json': '72 Taylor V Turner',
  '73-73-tq-delta--llc-v--commscope.json': '73 Tq Delta, Llc V. Commscope',
  '75-75-garrett-v-wood-county.json': '75 Garrett V Wood County',
  '83-83-koninklijke.json': '83 Koninklijke',
  '85-85-navico-v--garmin.json': '85 Navico V. Garmin',
  '86-86-ollnova.json': '86 Ollnova',
  '95-95-lake-cherokee.json': '95 Lake Cherokee',
  '101-101-netlist--inc--v--samsung.json': '101 Netlist, Inc. V. Samsung',
  '103-103-smartflash.json': '103 Smartflash',
  '106-106-chrimar-systems-v--aerohive.json': '106 Chrimar Systems V. Aerohive',
};

const sourceDir = path.join(__dirname, '../config/trial-configs');
const targetDir = path.join(__dirname, '../config/trial-configs/custom');

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log('🔄 Renaming trial config files to new convention...\n');

let successCount = 0;
let errorCount = 0;

for (const [oldFileName, shortName] of Object.entries(trialMappings)) {
  const sourcePath = path.join(sourceDir, oldFileName);
  
  if (fs.existsSync(sourcePath)) {
    const newFileName = generateFileToken(shortName) + '.json';
    const targetPath = path.join(targetDir, newFileName);
    
    try {
      // Copy file with new name
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`✅ ${oldFileName} → ${newFileName}`);
      successCount++;
      
      // Delete old file after successful copy
      fs.unlinkSync(sourcePath);
    } catch (error) {
      console.error(`❌ Error processing ${oldFileName}: ${error}`);
      errorCount++;
    }
  } else {
    console.log(`⚠️  File not found: ${oldFileName}`);
  }
}

console.log(`\n📊 Summary:`);
console.log(`  ✅ Successfully renamed: ${successCount} files`);
if (errorCount > 0) {
  console.log(`  ❌ Errors: ${errorCount} files`);
}

// Check for any remaining JSON files in the source directory
const remainingFiles = fs.readdirSync(sourceDir)
  .filter(file => file.endsWith('.json'));

if (remainingFiles.length > 0) {
  console.log(`\n⚠️  Remaining files in source directory:`);
  remainingFiles.forEach(file => console.log(`  - ${file}`));
}

console.log('\n✨ Done!');