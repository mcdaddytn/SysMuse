package com.sysmuse.bulk;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Extracts individual patent XML files from USPTO bulk data ZIP files
 * based on a CSV list of patent numbers and grant dates.
 *
 * V2: Better debugging, restart handling, and extractAll mode
 */
public class USPTOPatentExtractor {

    // ==================== CONFIGURATION ====================
    private static final String BULK_DATA_DIR = "F:\\data\\uspto\\bulkdata";
    //private static final String INPUT_CSV = "F:\\docs\\rj\\Patents\\broadcom\\patent-export-2026-02-03-grant.csv";
    //private static final String INPUT_CSV = "F:\\docs\\rj\\Patents\\broadcom\\missing-xml-patents-video.csv";
    // F:\\docs\\GrassLabel Dropbox\\Grass Label Home\\docs\\docsxfer\\uspto\\missing-claims
    //private static final String INPUT_CSV = "F:\\docs\\rj\\Patents\\broadcom\\all-needs-xml.csv";
    private static final String INPUT_CSV = "F:\\docs\\rj\\Patents\\broadcom\\previously-missing-dates.csv";
    // missing-xml-patents-video.csv
    //private static final String INPUT_CSV = "F:\\docs\\rj\\Patents\\broadcom\\patent-export-2026-02-03-grant-exc.csv";
    //private static final String OUTPUT_DIR = "F:\\data\\uspto\\bulkdata\\export";
    //private static final String OUTPUT_DIR = "F:\\data\\uspto\\bulkdata\\export2";
    //private static final String OUTPUT_DIR = "F:\\data\\uspto\\bulkdata\\export3";
    private static final String OUTPUT_DIR = "F:\\data\\uspto\\bulkdata\\export4";

    // If true, extract ALL patents from each weekly file to the weekly directory
    // If false, only extract the patents we're looking for to OUTPUT_DIR
    private static final boolean EXTRACT_ALL = false;

    // Enable detailed debug output
    private static final boolean DEBUG_MODE = true;

    // ==================== INSTANCE VARIABLES ====================
    private Map<String, String> patentToDate = new HashMap<>();  // patent# -> grant date
    private Map<String, List<String>> weekToPatents = new TreeMap<>();  // week filename -> list of patents
    private Set<String> extractedPatents = new HashSet<>();
    private int totalPatents = 0;
    private int extractedCount = 0;
    private int notFoundCount = 0;

    public static void main(String[] args) {
        USPTOPatentExtractor extractor = new USPTOPatentExtractor();

        try {
            System.out.println("=================================================");
            System.out.println("USPTO Patent Extractor v2");
            System.out.println("=================================================");
            System.out.println("Input CSV:    " + INPUT_CSV);
            System.out.println("Bulk Data:    " + BULK_DATA_DIR);
            System.out.println("Output Dir:   " + OUTPUT_DIR);
            System.out.println("Extract All:  " + EXTRACT_ALL);
            System.out.println("Debug Mode:   " + DEBUG_MODE);
            System.out.println("=================================================\n");

            // Step 1: Read CSV and organize patents by week
            extractor.loadPatentsFromCSV();

            // Step 2: Process each week's ZIP file
            extractor.extractPatentsByWeek();

            // Step 3: Summary
            extractor.printSummary();

        } catch (Exception e) {
            System.err.println("\n=================================================");
            System.err.println("FATAL ERROR");
            System.err.println("=================================================");
            e.printStackTrace();
        }
    }

    /**
     * Load patents from CSV and organize by publication week
     */
    private void loadPatentsFromCSV() throws IOException {
        System.out.println("Loading patents from CSV...");

        File csvFile = new File(INPUT_CSV);
        if (!csvFile.exists()) {
            throw new FileNotFoundException("CSV file not found: " + INPUT_CSV);
        }

        try (BufferedReader reader = new BufferedReader(new FileReader(csvFile))) {
            String line = reader.readLine(); // Skip header
            if (line == null) {
                throw new IOException("CSV file is empty");
            }

            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                String[] parts = line.split(",");
                if (parts.length < 2) {
                    System.err.println("  WARNING: Invalid line (skipping): " + line);
                    continue;
                }

                String patentNum = parts[0].trim();
                String grantDateStr = parts[1].trim();

                try {
                    LocalDate grantDate = parseGrantDate(grantDateStr);
                    LocalDate publicationTuesday = findPublicationTuesday(grantDate);
                    String weekFilename = generateWeekFilename(publicationTuesday);

                    patentToDate.put(patentNum, grantDateStr);
                    weekToPatents.computeIfAbsent(weekFilename, k -> new ArrayList<>()).add(patentNum);
                    totalPatents++;

                } catch (IllegalArgumentException e) {
                    // Pre-2002 patents - skip silently
                    if (!e.getMessage().contains("before 2002")) {
                        System.err.println("  WARNING: Error processing patent " + patentNum +
                                " with date " + grantDateStr + ": " + e.getMessage());
                    }
                } catch (Exception e) {
                    System.err.println("  WARNING: Error processing patent " + patentNum +
                            " with date " + grantDateStr + ": " + e.getMessage());
                }
            }
        }

        System.out.println("  Loaded " + totalPatents + " patents (ignoring pre-2002)");
        System.out.println("  Organized into " + weekToPatents.size() + " weekly files");
        System.out.println();
    }

    /**
     * Parse grant date in various formats (M/d/yyyy, MM/dd/yyyy, etc.)
     */
    private LocalDate parseGrantDate(String dateStr) throws DateTimeParseException {
        // Try common formats
        String[] formats = {
                "M/d/yyyy",
                "MM/dd/yyyy",
                "M/dd/yyyy",
                "MM/d/yyyy",
                "yyyy-MM-dd",
                "M-d-yyyy"
        };

        for (String format : formats) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return LocalDate.parse(dateStr, formatter);
            } catch (DateTimeParseException e) {
                // Try next format
            }
        }

        throw new DateTimeParseException("Unable to parse date: " + dateStr, dateStr, 0);
    }

    /**
     * Find the Tuesday of the week when this patent was published
     * Patents are published on Tuesdays
     */
    private LocalDate findPublicationTuesday(LocalDate grantDate) {
        // If already Tuesday, return as-is
        if (grantDate.getDayOfWeek() == DayOfWeek.TUESDAY) {
            return grantDate;
        }

        // Otherwise, find the Tuesday of this week (go backwards to Monday, then forward to Tuesday)
        LocalDate current = grantDate;
        while (current.getDayOfWeek() != DayOfWeek.MONDAY) {
            current = current.minusDays(1);
        }
        return current.plusDays(1); // Tuesday
    }

    /**
     * Generate the ZIP filename for a given publication date
     */
    private String generateWeekFilename(LocalDate tuesday) {
        if (tuesday.getYear() < 2005) {
            throw new IllegalArgumentException("Patents before 2005 use different XML format (not supported)");
        }

        String yy = String.format("%02d", tuesday.getYear() % 100);
        String mm = String.format("%02d", tuesday.getMonthValue());
        String dd = String.format("%02d", tuesday.getDayOfMonth());

        return "ipg" + yy + mm + dd + ".zip";
    }

    /**
     * Generate the ZIP filename for a given publication date
     */
    private String generateWeekFilename_old(LocalDate tuesday) {
        String yy = String.format("%02d", tuesday.getYear() % 100);
        String mm = String.format("%02d", tuesday.getMonthValue());
        String dd = String.format("%02d", tuesday.getDayOfMonth());

        if (tuesday.getYear() >= 2005) {
            return "ipg" + yy + mm + dd + ".zip";
        } else if (tuesday.getYear() >= 2002) {
            return "pg" + yy + mm + dd + ".zip";
        } else {
            throw new IllegalArgumentException("Patents before 2002 not supported in this format");
        }
    }

    /**
     * Process each week's ZIP file
     */
    private void extractPatentsByWeek() throws IOException {
        System.out.println("Processing weekly ZIP files...\n");

        int weekNum = 0;
        for (Map.Entry<String, List<String>> entry : weekToPatents.entrySet()) {
            weekNum++;
            String weekFilename = entry.getKey();
            List<String> patents = entry.getValue();

            System.out.printf("[%d/%d] Processing %s (%d patents)...\n",
                    weekNum, weekToPatents.size(), weekFilename, patents.size());

            if (DEBUG_MODE) {
                System.out.println("  Target patents: " + patents);
            }

            try {
                // Find the ZIP file (check all year subdirectories)
                File zipFile = findZipFile(weekFilename);

                if (zipFile == null) {
                    System.err.println("  ERROR: ZIP file not found: " + weekFilename);
                    System.err.println("  Searched in: " + getSearchPaths(weekFilename));
                    notFoundCount += patents.size();
                    continue;
                }

                System.out.println("  Found ZIP: " + zipFile.getAbsolutePath());

                // Check if XML already extracted
                File xmlFile = getExtractedXmlFile(zipFile);

                if (xmlFile.exists() && xmlFile.length() > 0) {
                    System.out.println("  Using existing XML: " + xmlFile.getName() +
                            " (" + String.format("%.2f MB", xmlFile.length() / (1024.0 * 1024.0)) + ")");
                } else {
                    // Extract the large XML from ZIP
                    xmlFile = extractXmlFromZip(zipFile);
                }

                // Parse the large XML and extract individual patents
                int extracted = extractIndividualPatents(xmlFile, patents);
                extractedCount += extracted;

                System.out.println("  Extracted: " + extracted + "/" + patents.size() + " patents");

                if (extracted < patents.size()) {
                    System.out.println("  WARNING: " + (patents.size() - extracted) + " patents not found in this file");
                    for (String patent : patents) {
                        String normalized = normalizeDocNumber(patent);
                        if (!extractedPatents.contains(patent) && !extractedPatents.contains(normalized)) {
                            System.out.println("    Missing: " + patent);
                        }
                    }
                }

            } catch (Exception e) {
                System.err.println("  ERROR processing " + weekFilename + ": " + e.getMessage());
                notFoundCount += patents.size();
                if (DEBUG_MODE) {
                    e.printStackTrace();
                }
            }

            System.out.println();
        }
    }

    /**
     * Get the paths that were searched for a ZIP file
     */
    private String getSearchPaths(String filename) {
        String yearStr = filename.substring(filename.startsWith("ipg") ? 3 : 2,
                filename.startsWith("ipg") ? 5 : 4);
        int yy = Integer.parseInt(yearStr);
        int year = (yy >= 76) ? (1900 + yy) : (2000 + yy);

        return BULK_DATA_DIR + File.separator + year + File.separator + filename + " OR " +
                BULK_DATA_DIR + File.separator + filename;
    }

    /**
     * Find ZIP file in year subdirectories
     */
    private File findZipFile(String filename) {
        // Extract year from filename (e.g., ipg190514.zip -> 2019, pg040727.zip -> 2004)
        String yearStr;
        if (filename.startsWith("ipg")) {
            yearStr = filename.substring(3, 5); // "19" from "ipg190514.zip"
        } else if (filename.startsWith("pg")) {
            yearStr = filename.substring(2, 4); // "04" from "pg040727.zip"
        } else {
            return null;
        }

        int yy = Integer.parseInt(yearStr);
        int year = (yy >= 76) ? (1900 + yy) : (2000 + yy);

        if (DEBUG_MODE) {
            System.out.println("  Looking for year: " + year + " from filename: " + filename);
        }

        // Check in year subdirectory first
        File zipFile = new File(BULK_DATA_DIR + File.separator + year + File.separator + filename);
        if (DEBUG_MODE) {
            System.out.println("  Checking: " + zipFile.getAbsolutePath() + " -> " + zipFile.exists());
        }
        if (zipFile.exists()) {
            return zipFile;
        }

        // Check in base directory
        zipFile = new File(BULK_DATA_DIR + File.separator + filename);
        if (DEBUG_MODE) {
            System.out.println("  Checking: " + zipFile.getAbsolutePath() + " -> " + zipFile.exists());
        }
        if (zipFile.exists()) {
            return zipFile;
        }

        return null;
    }

    /**
     * Get the expected extracted XML file location
     */
    private File getExtractedXmlFile(File zipFile) {
        String zipName = zipFile.getName(); // e.g., "ipg190514.zip"
        String baseName = zipName.substring(0, zipName.length() - 4); // "ipg190514"
        String xmlName = baseName + ".xml";

        // Extraction directory is next to ZIP file
        File extractDir = new File(zipFile.getParentFile(), baseName);
        return new File(extractDir, xmlName);
    }

    /**
     * Extract the large XML file from ZIP
     * Returns the extracted XML file (creates a directory with the same name as ZIP)
     */
    private File extractXmlFromZip(File zipFile) throws IOException {
        String zipName = zipFile.getName(); // e.g., "ipg190514.zip"
        String baseName = zipName.substring(0, zipName.length() - 4); // "ipg190514"

        // Create extraction directory next to ZIP file
        File extractDir = new File(zipFile.getParentFile(), baseName);
        extractDir.mkdirs();

        System.out.println("  Extracting XML from ZIP...");

        try (ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName().endsWith(".xml")) {
                    File outputFile = new File(extractDir, entry.getName());

                    try (FileOutputStream fos = new FileOutputStream(outputFile)) {
                        byte[] buffer = new byte[8192];
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }

                    System.out.println("  Extracted: " + entry.getName() +
                            " (" + String.format("%.2f MB", outputFile.length() / (1024.0 * 1024.0)) + ")");
                    return outputFile;
                }
            }
        }

        throw new IOException("No XML file found in ZIP: " + zipFile.getName());
    }

    /**
     * Parse the large XML file and extract individual patents
     * Uses text-based splitting since file contains multiple XML declarations
     */
    private int extractIndividualPatents(File xmlFile, List<String> targetPatents) throws Exception {
        System.out.println("  Parsing XML for individual patents...");

        // Create set for faster lookup (with multiple variations)
        Set<String> targetSet = new HashSet<>();
        for (String patent : targetPatents) {
            targetSet.add(patent);
            targetSet.add(normalizeDocNumber(patent));
        }

        Set<String> foundInThisFile = new HashSet<>();

        // Read entire file as text
        String xmlContent = Files.readString(xmlFile.toPath());

        // Split by XML declaration - each segment is one patent
        String[] patents = xmlContent.split("(?=<\\?xml version=\"1\\.0\" encoding=\"UTF-8\"\\?>)");

        System.out.println("  Found " + patents.length + " total patents in file");

        int patentNum = 0;
        for (String patentXml : patents) {
            patentNum++;
            if (patentXml.trim().isEmpty()) continue;

            // Ensure it starts with XML declaration
            if (!patentXml.trim().startsWith("<?xml")) {
                // This is the pre-XML header junk, skip it
                continue;
            }

            // Extract doc-number from this patent
            String docNumber = extractDocNumber(patentXml);

            if (docNumber == null) {
                if (DEBUG_MODE && patentNum <= 5) {
                    System.out.println("  DEBUG: Could not extract doc-number from patent #" + patentNum);
                    System.out.println("  First 500 chars: " + patentXml.substring(0, Math.min(500, patentXml.length())));
                }
                continue;
            }

            // Normalize doc number
            String normalizedDoc = normalizeDocNumber(docNumber);

            if (DEBUG_MODE && patentNum <= 5) {
                System.out.println("  DEBUG: Found doc-number: " + docNumber + " -> normalized: " + normalizedDoc);
            }

            // Check if this is one we want OR if we're extracting all
            boolean isTarget = targetSet.contains(normalizedDoc) || targetSet.contains(docNumber);

            if (EXTRACT_ALL) {
                // Extract to weekly directory
                savePatentXml(docNumber, patentXml, xmlFile.getParentFile());
                if (isTarget) {
                    // Also copy to output directory
                    copyToOutputDir(docNumber, patentXml);
                    foundInThisFile.add(normalizedDoc);
                    extractedPatents.add(normalizedDoc);
                }
            } else if (isTarget) {
                // Only extract targets to output directory
                savePatentXml(docNumber, patentXml, new File(OUTPUT_DIR));
                foundInThisFile.add(normalizedDoc);
                extractedPatents.add(normalizedDoc);
            }
        }

        if (DEBUG_MODE) {
            List<String> missingPatents = null;
            missingPatents = targetPatents.stream()
                    .filter(p -> !foundInThisFile.contains(p) && !foundInThisFile.contains(normalizeDocNumber(p)))
                    .toList();

            System.out.println("  Target patents: " + targetSet);
            System.out.println("  Found in file: " + foundInThisFile);
            System.out.println("  Missing: " + missingPatents);
        }

        return foundInThisFile.size();
    }

    /**
     * Extract doc-number from patent XML using text search
     * Looks for <doc-number> within <publication-reference> (the granted patent number)
     */
    private String extractDocNumber(String patentXml) {
        // Look for publication-reference section FIRST (this has the granted patent number)
        int pubRefStart = patentXml.indexOf("<publication-reference");

        if (pubRefStart == -1) {
            // Pre-2005 format or malformed - skip
            return null;
        }

        // Find the doc-number within the next 1000 characters
        String section = patentXml.substring(pubRefStart, Math.min(pubRefStart + 1000, patentXml.length()));

        // Extract doc-number value
        int docNumStart = section.indexOf("<doc-number>");
        if (docNumStart == -1) {
            return null;
        }

        int docNumEnd = section.indexOf("</doc-number>", docNumStart);
        if (docNumEnd == -1) {
            return null;
        }

        String docNumber = section.substring(docNumStart + 12, docNumEnd).trim();
        return docNumber;
    }

    /**
     * Extract application-number from patent XML using text search
     * Looks for <doc-number> within <application-reference>
     */
    private String extractApplicationNumber(String patentXml) {
        // Look for application-reference section first
        int appRefStart = patentXml.indexOf("<application-reference");
        if (appRefStart == -1) {
            // Try publication-reference as fallback
            appRefStart = patentXml.indexOf("<publication-reference");
        }

        if (appRefStart == -1) {
            return null;
        }

        // Find the doc-number within the next 1000 characters
        String section = patentXml.substring(appRefStart, Math.min(appRefStart + 1000, patentXml.length()));

        // Extract doc-number value
        int docNumStart = section.indexOf("<doc-number>");
        if (docNumStart == -1) {
            return null;
        }

        int docNumEnd = section.indexOf("</doc-number>", docNumStart);
        if (docNumEnd == -1) {
            return null;
        }

        String docNumber = section.substring(docNumStart + 12, docNumEnd).trim();
        return docNumber;
    }

    /**
     * Normalize doc number by removing prefix and leading zeros
     * D0973298 -> 973298
     * 09093979 -> 9093979
     */
    private String normalizeDocNumber(String docNumber) {
        if (docNumber == null) return null;

        // Remove common prefixes
        String normalized = docNumber.replaceAll("^[A-Z]+0*", "");
        // Remove leading zeros
        normalized = normalized.replaceAll("^0+", "");
        return normalized;
    }

    /**
     * Save individual patent XML to specified directory
     */
    private void savePatentXml(String docNumber, String xmlContent, File outputDir) throws IOException {
        // Create output directory if needed
        outputDir.mkdirs();

        // Create filename (US + doc number)
        String filename = "US" + docNumber + ".xml";
        File outputFile = new File(outputDir, filename);

        // Write XML content
        try (FileWriter writer = new FileWriter(outputFile)) {
            writer.write(xmlContent);
        }

        if (DEBUG_MODE || !EXTRACT_ALL) {
            System.out.println("    Saved: " + filename + " to " + outputDir.getName());
        }
    }

    /**
     * Copy patent to output directory
     */
    private void copyToOutputDir(String docNumber, String xmlContent) throws IOException {
        File outputDir = new File(OUTPUT_DIR);
        outputDir.mkdirs();

        String filename = "US" + docNumber + ".xml";
        File outputFile = new File(outputDir, filename);

        try (FileWriter writer = new FileWriter(outputFile)) {
            writer.write(xmlContent);
        }

        System.out.println("    Copied to output: " + filename);
    }

    /**
     * Print summary statistics
     */
    private void printSummary() {
        System.out.println("\n=================================================");
        System.out.println("Extraction Summary:");
        System.out.println("=================================================");
        System.out.println("Total patents requested: " + totalPatents);
        System.out.println("Successfully extracted:  " + extractedCount);
        System.out.println("Not found:               " + (totalPatents - extractedCount));
        System.out.println("Extract All Mode:        " + EXTRACT_ALL);
        System.out.println("Output directory:        " + OUTPUT_DIR);
        System.out.println("=================================================");

        if (extractedCount < totalPatents) {
            System.out.println("\nNOTE: Some patents were not found. Possible reasons:");
            System.out.println("  - ZIP file missing for that week");
            System.out.println("  - Grant date in CSV doesn't match actual publication date");
            System.out.println("  - Patent number format mismatch");
            System.out.println("\nTry enabling DEBUG_MODE to see detailed matching info.");
        }
    }
}