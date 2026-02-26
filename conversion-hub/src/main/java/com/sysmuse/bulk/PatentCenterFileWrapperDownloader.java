package com.sysmuse.bulk;

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Downloads prosecution history documents from USPTO Patent Center
 *
 * RATE LIMITED: Maximum 10 patents per hour to respect USPTO resources
 * Focuses on applicant responses for estoppel analysis
 */
public class PatentCenterFileWrapperDownloader {

    // ==================== CONFIGURATION ====================
    private static final String PATENT_CENTER_URL = "https://patentcenter.uspto.gov/";

    // Input: CSV with patent numbers or application numbers
    private static final String INPUT_CSV = "C:\\docs\\rj\\Patents\\broadcom\\high-priority-patents.csv";

    // Output directory for downloaded PDFs
    private static final String OUTPUT_DIR = "C:\\data\\uspto\\file-wrappers";

    // Download directory (Chrome will download here first, then we organize)
    private static final String DOWNLOAD_DIR = "C:\\data\\uspto\\file-wrappers\\downloads";

    // Rate limiting: patents per hour (USPTO recommendation: 10-20 max)
    private static final int PATENTS_PER_HOUR = 10;
    private static final int DELAY_BETWEEN_PATENTS_MS = (3600 * 1000) / PATENTS_PER_HOUR; // ~6 minutes

    // Additional delays for politeness
    private static final int DELAY_BETWEEN_DOWNLOADS_MS = 5000;  // 5 seconds between documents
    private static final int PAGE_LOAD_DELAY_MS = 3000;           // Wait for pages to load

    // Document types to download (for estoppel analysis)
    private static final boolean DOWNLOAD_APPLICANT_RESPONSES = true;  // PRESP, RCEX, etc.
    private static final boolean DOWNLOAD_AMENDMENTS = true;            // AMND, AFCP, etc.
    private static final boolean DOWNLOAD_OFFICE_ACTIONS = true;        // CTFR, CTNF, etc.
    private static final boolean DOWNLOAD_ALL_DOCUMENTS = false;        // Override to get everything

    // Resume capability: skip already downloaded patents
    private static final boolean SKIP_EXISTING = true;

    // ==================== INSTANCE VARIABLES ====================
    private WebDriver driver;
    private WebDriverWait wait;
    private Map<String, String> patentToAppNum = new HashMap<>();  // patent# -> application#
    private List<String> patents = new ArrayList<>();
    private Set<String> processedPatents = new HashSet<>();
    private int successCount = 0;
    private int errorCount = 0;
    private int skipCount = 0;

    public static void main(String[] args) {
        //System.setProperty("webdriver.chrome.driver", "F:\\frame\\chromedriver-win64\\chromedriver.exe");
        System.setProperty("webdriver.chrome.driver", "C:\\frame\\chromedriver-win64\\chromedriver.exe");

        PatentCenterFileWrapperDownloader downloader = new PatentCenterFileWrapperDownloader();

        try {
            System.out.println("=================================================");
            System.out.println("Patent Center File Wrapper Downloader");
            System.out.println("=================================================");
            System.out.println("Input CSV:         " + INPUT_CSV);
            System.out.println("Output Directory:  " + OUTPUT_DIR);
            System.out.println("Rate Limit:        " + PATENTS_PER_HOUR + " patents/hour");
            System.out.println("Delay per Patent:  " + (DELAY_BETWEEN_PATENTS_MS / 1000) + " seconds");
            System.out.println("=================================================");
            System.out.println("Document Types:");
            System.out.println("  Applicant Responses: " + DOWNLOAD_APPLICANT_RESPONSES);
            System.out.println("  Amendments:          " + DOWNLOAD_AMENDMENTS);
            System.out.println("  Office Actions:      " + DOWNLOAD_OFFICE_ACTIONS);
            System.out.println("  All Documents:       " + DOWNLOAD_ALL_DOCUMENTS);
            System.out.println("=================================================\n");

            // Initialize browser
            downloader.initializeBrowser();

            // Load patents from CSV
            downloader.loadPatentsFromCSV();

            // Download file wrappers
            downloader.downloadFileWrappers();

            // Summary
            downloader.printSummary();

        } catch (Exception e) {
            System.err.println("\n=================================================");
            System.err.println("FATAL ERROR");
            System.err.println("=================================================");
            e.printStackTrace();
        } finally {
            downloader.cleanup();
        }
    }

    /**
     * Initialize Chrome browser with download settings
     */
    private void initializeBrowser() {
        System.out.println("Initializing browser...\n");

        // Create directories
        new File(OUTPUT_DIR).mkdirs();
        new File(DOWNLOAD_DIR).mkdirs();

        ChromeOptions options = new ChromeOptions();
        options.addArguments("--start-maximized");
        options.addArguments("--disable-blink-features=AutomationControlled");

        // Set download directory
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("download.default_directory", new File(DOWNLOAD_DIR).getAbsolutePath());
        prefs.put("download.prompt_for_download", false);
        prefs.put("download.directory_upgrade", true);
        prefs.put("safebrowsing.enabled", true);
        prefs.put("plugins.always_open_pdf_externally", true);  // Download PDFs instead of viewing
        options.setExperimentalOption("prefs", prefs);

        this.driver = new ChromeDriver(options);
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(30));
    }

    /**
     * Load patents from CSV
     * Expected format: Patent Number or Application Number
     */
    private void loadPatentsFromCSV() throws IOException {
        System.out.println("Loading patents from CSV...");

        File csvFile = new File(INPUT_CSV);
        if (!csvFile.exists()) {
            throw new FileNotFoundException("CSV file not found: " + INPUT_CSV);
        }

        try (BufferedReader reader = new BufferedReader(new FileReader(csvFile))) {
            String line = reader.readLine(); // Skip header

            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                // Could be patent number (9093979) or app number (16/123456)
                String patentOrApp = line.split(",")[0].trim();
                patents.add(patentOrApp);
            }
        }

        System.out.println("  Loaded " + patents.size() + " patents/applications");
        System.out.println();
    }

    /**
     * Download file wrappers for all patents
     */
    private void downloadFileWrappers() throws Exception {
        System.out.println("Downloading file wrappers...\n");
        System.out.println("NOTE: This will take approximately " +
                formatDuration(patents.size() * DELAY_BETWEEN_PATENTS_MS) + " to complete");
        System.out.println("USPTO rate limits enforced: " + PATENTS_PER_HOUR + " patents per hour\n");

        int patentNum = 0;
        for (String patent : patents) {
            patentNum++;

            System.out.println("[" + patentNum + "/" + patents.size() + "] Processing " + patent + "...");

            // Check if already processed
            if (SKIP_EXISTING && isAlreadyProcessed(patent)) {
                System.out.println("  SKIPPED: Already downloaded");
                skipCount++;
                continue;
            }

            try {
                // Download documents for this patent
                boolean success = downloadPatentDocuments(patent);

                if (success) {
                    successCount++;
                    processedPatents.add(patent);
                    markAsProcessed(patent);
                } else {
                    errorCount++;
                }

                // Rate limiting delay (except for last patent)
                if (patentNum < patents.size()) {
                    System.out.println("  Waiting " + (DELAY_BETWEEN_PATENTS_MS / 1000) +
                            " seconds before next patent (rate limiting)...");
                    Thread.sleep(DELAY_BETWEEN_PATENTS_MS);
                }

            } catch (Exception e) {
                System.err.println("  ERROR: " + e.getMessage());
                errorCount++;
                e.printStackTrace();
            }

            System.out.println();
        }
    }

    /**
     * Download documents for a single patent
     */
    private boolean downloadPatentDocuments(String patentOrApp) throws Exception {
        // Navigate to Patent Center
        driver.get(PATENT_CENTER_URL);
        Thread.sleep(PAGE_LOAD_DELAY_MS);

        // Find search box and enter patent/app number
        try {
            // Click on search box
            WebElement searchBox = wait.until(ExpectedConditions.elementToBeClickable(
                    By.cssSelector("input[placeholder*='Application'], input[placeholder*='Patent']")));
            searchBox.clear();
            searchBox.sendKeys(patentOrApp);
            searchBox.sendKeys(Keys.RETURN);

            System.out.println("  Searching for: " + patentOrApp);
            Thread.sleep(PAGE_LOAD_DELAY_MS);

        } catch (Exception e) {
            System.err.println("  ERROR: Could not search for patent");
            return false;
        }

        // Check if we got results
        try {
            // Look for "No results" message
            List<WebElement> noResults = driver.findElements(By.xpath("//*[contains(text(), 'No results')]"));
            if (!noResults.isEmpty()) {
                System.err.println("  ERROR: Patent not found in Patent Center");
                return false;
            }

            // Click on first result (if search returned multiple)
            WebElement firstResult = wait.until(ExpectedConditions.elementToBeClickable(
                    By.cssSelector("a[href*='/applications/'], a[href*='/patents/']")));
            firstResult.click();

            System.out.println("  Found patent, loading details...");
            Thread.sleep(PAGE_LOAD_DELAY_MS);

        } catch (Exception e) {
            System.err.println("  ERROR: Could not navigate to patent details");
            return false;
        }

        // Navigate to Documents & Transactions tab
        try {
            WebElement docsTab = wait.until(ExpectedConditions.elementToBeClickable(
                    By.xpath("//a[contains(text(), 'Documents')] | //button[contains(text(), 'Documents')]")));
            docsTab.click();

            System.out.println("  Navigating to Documents tab...");
            Thread.sleep(PAGE_LOAD_DELAY_MS);

        } catch (Exception e) {
            System.err.println("  ERROR: Could not find Documents tab");
            return false;
        }

        // Find and download documents
        int downloadedCount = downloadDocumentsFromTable(patentOrApp);

        System.out.println("  Downloaded " + downloadedCount + " documents");

        return downloadedCount > 0;
    }

    /**
     * Download documents from the documents table
     */
    private int downloadDocumentsFromTable(String patentOrApp) throws Exception {
        int downloadCount = 0;

        try {
            // Wait for table to load
            WebElement table = wait.until(ExpectedConditions.presenceOfElementLocated(
                    By.cssSelector("table, .document-list, .transaction-history")));

            // Find all document rows
            List<WebElement> rows = driver.findElements(
                    By.cssSelector("tr, .document-row"));

            System.out.println("  Found " + rows.size() + " potential documents");

            for (int i = 0; i < rows.size(); i++) {
                try {
                    WebElement row = rows.get(i);
                    String rowText = row.getText().toUpperCase();

                    // Check if this is a document we want to download
                    if (!shouldDownloadDocument(rowText)) {
                        continue;
                    }

                    // Find download link/button in this row
                    List<WebElement> downloadLinks = row.findElements(
                            By.cssSelector("a[href*='download'], button[contains(text(), 'Download')], " +
                                    "a[href$='.pdf'], i.fa-download"));

                    if (downloadLinks.isEmpty()) {
                        continue;
                    }

                    // Extract document info for filename
                    String docCode = extractDocumentCode(rowText);
                    String docDate = extractDocumentDate(rowText);
                    String docDesc = extractDocumentDescription(rowText);

                    System.out.println("    Downloading: " + docCode + " - " + docDesc + " (" + docDate + ")");

                    // Click download
                    downloadLinks.get(0).click();
                    Thread.sleep(DELAY_BETWEEN_DOWNLOADS_MS);

                    // Wait for download to complete
                    if (waitForDownloadToComplete()) {
                        // Move and rename downloaded file
                        String newFilename = patentOrApp.replace("/", "-") + "_" +
                                docDate + "_" + docCode + "_" + cleanFilename(docDesc) + ".pdf";
                        moveDownloadedFile(newFilename, patentOrApp);
                        downloadCount++;
                    }

                } catch (Exception e) {
                    System.err.println("    WARNING: Failed to download document: " + e.getMessage());
                }
            }

        } catch (Exception e) {
            System.err.println("  ERROR: Could not access documents table: " + e.getMessage());
        }

        return downloadCount;
    }

    /**
     * Determine if we should download this document based on type
     */
    private boolean shouldDownloadDocument(String rowText) {
        if (DOWNLOAD_ALL_DOCUMENTS) {
            return true;
        }

        // Applicant responses (most important for estoppel)
        if (DOWNLOAD_APPLICANT_RESPONSES) {
            if (rowText.contains("RESPONSE") || rowText.contains("PRESP") ||
                    rowText.contains("RCEX") || rowText.contains("AMENDMENT") ||
                    rowText.contains("REPLY") || rowText.contains("APPLICANT ARGUMENTS")) {
                return true;
            }
        }

        // Amendments
        if (DOWNLOAD_AMENDMENTS) {
            if (rowText.contains("AMND") || rowText.contains("AMENDMENT") ||
                    rowText.contains("AFCP") || rowText.contains("CLAIMS")) {
                return true;
            }
        }

        // Office actions
        if (DOWNLOAD_OFFICE_ACTIONS) {
            if (rowText.contains("CTFR") || rowText.contains("CTNF") ||
                    rowText.contains("OFFICE ACTION") || rowText.contains("NON-FINAL") ||
                    rowText.contains("FINAL REJECTION")) {
                return true;
            }
        }

        return false;
    }

    /**
     * Extract document code from row text
     */
    private String extractDocumentCode(String rowText) {
        // Look for common document codes
        String[] codes = {"PRESP", "RCEX", "CTFR", "CTNF", "AMND", "AFCP", "IDS", "WFEE"};
        for (String code : codes) {
            if (rowText.contains(code)) {
                return code;
            }
        }

        // Try to extract 3-5 letter code
        String[] words = rowText.split("\\s+");
        for (String word : words) {
            if (word.matches("[A-Z]{3,5}")) {
                return word;
            }
        }

        return "DOC";
    }

    /**
     * Extract date from row text (various formats)
     */
    private String extractDocumentDate(String rowText) {
        // Try to find date in format MM/DD/YYYY or YYYY-MM-DD
        String[] parts = rowText.split("\\s+");
        for (String part : parts) {
            if (part.matches("\\d{1,2}/\\d{1,2}/\\d{4}")) {
                return part.replace("/", "-");
            }
            if (part.matches("\\d{4}-\\d{2}-\\d{2}")) {
                return part;
            }
        }

        // Default to current date
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
    }

    /**
     * Extract document description
     */
    private String extractDocumentDescription(String rowText) {
        String desc = rowText.toLowerCase();

        // Truncate to reasonable length
        if (desc.length() > 50) {
            desc = desc.substring(0, 50);
        }

        // Remove special characters
        desc = desc.replaceAll("[^a-z0-9\\s-]", "");
        desc = desc.trim().replaceAll("\\s+", "_");

        return desc;
    }

    /**
     * Clean filename for Windows compatibility
     */
    private String cleanFilename(String filename) {
        return filename.replaceAll("[<>:\"/\\\\|?*]", "_")
                .replaceAll("_{2,}", "_")
                .substring(0, Math.min(filename.length(), 50));
    }

    /**
     * Wait for download to complete in download directory
     */
    private boolean waitForDownloadToComplete() throws InterruptedException {
        int waited = 0;
        int maxWait = 60; // 60 seconds max

        while (waited < maxWait) {
            // Check for new files in download directory
            File downloadDir = new File(DOWNLOAD_DIR);
            File[] files = downloadDir.listFiles((dir, name) ->
                    name.endsWith(".pdf") && !name.endsWith(".crdownload"));

            if (files != null && files.length > 0) {
                // Check if file is still growing
                File latestFile = files[files.length - 1];
                long size1 = latestFile.length();
                Thread.sleep(1000);
                long size2 = latestFile.length();

                if (size1 == size2 && size1 > 0) {
                    return true; // Download complete
                }
            }

            Thread.sleep(1000);
            waited++;
        }

        return false;
    }

    /**
     * Move downloaded file from download directory to organized location
     */
    private void moveDownloadedFile(String newFilename, String patentOrApp) throws IOException {
        File downloadDir = new File(DOWNLOAD_DIR);
        File[] files = downloadDir.listFiles((dir, name) -> name.endsWith(".pdf"));

        if (files != null && files.length > 0) {
            // Get most recent file
            File latestFile = files[0];
            for (File f : files) {
                if (f.lastModified() > latestFile.lastModified()) {
                    latestFile = f;
                }
            }

            // Create patent-specific subdirectory
            String patentDir = patentOrApp.replace("/", "-");
            File destDir = new File(OUTPUT_DIR + File.separator + patentDir);
            destDir.mkdirs();

            File destFile = new File(destDir, newFilename);
            Files.move(latestFile.toPath(), destFile.toPath(), StandardCopyOption.REPLACE_EXISTING);

            System.out.println("      Saved: " + destFile.getAbsolutePath());
        }
    }

    /**
     * Check if patent already processed
     */
    private boolean isAlreadyProcessed(String patent) {
        String patentDir = patent.replace("/", "-");
        File dir = new File(OUTPUT_DIR + File.separator + patentDir);

        // Check if directory exists and has files
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles((d, name) -> name.endsWith(".pdf"));
            return files != null && files.length > 0;
        }

        return false;
    }

    /**
     * Mark patent as processed
     */
    private void markAsProcessed(String patent) throws IOException {
        // Create a marker file
        String patentDir = patent.replace("/", "-");
        File dir = new File(OUTPUT_DIR + File.separator + patentDir);
        dir.mkdirs();

        File marker = new File(dir, ".processed");
        marker.createNewFile();
    }

    /**
     * Format duration for display
     */
    private String formatDuration(long milliseconds) {
        long hours = milliseconds / (1000 * 60 * 60);
        long minutes = (milliseconds % (1000 * 60 * 60)) / (1000 * 60);

        if (hours > 0) {
            return hours + " hours " + minutes + " minutes";
        } else {
            return minutes + " minutes";
        }
    }

    /**
     * Print summary statistics
     */
    private void printSummary() {
        System.out.println("\n=================================================");
        System.out.println("Download Summary:");
        System.out.println("=================================================");
        System.out.println("Total patents:         " + patents.size());
        System.out.println("Successfully processed: " + successCount);
        System.out.println("Skipped (existing):    " + skipCount);
        System.out.println("Errors:                " + errorCount);
        System.out.println("Output directory:      " + OUTPUT_DIR);
        System.out.println("=================================================");
    }

    /**
     * Cleanup resources
     */
    private void cleanup() {
        if (driver != null) {
            driver.quit();
        }
    }
}
