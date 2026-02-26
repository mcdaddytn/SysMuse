package com.sysmuse.bulk;

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.*;

/**
 * Patent Center Direct Downloader
 * Uses application numbers to go directly to Patent Center documents
 * Bypasses search by using direct URLs
 */
public class PatentCenterDirectDownloader {

    private static final String INPUT_CSV = "C:\\docs\\rj\\Patents\\broadcom\\high-priority-patents.csv";
    private static final String OUTPUT_DIR = "C:\\data\\uspto\\file-wrappers";
    private static final String DOWNLOAD_DIR = "C:\\data\\uspto\\file-wrappers\\downloads";

    // Patent Center direct URLs
    private static final String PATENT_CENTER_BASE = "https://patentcenter.uspto.gov/#!/applications/";

    private static final int PATENTS_PER_HOUR = 10;
    private static final int DELAY_BETWEEN_PATENTS_MS = (3600 * 1000) / PATENTS_PER_HOUR;
    private static final int DELAY_BETWEEN_DOWNLOADS_MS = 5000;
    private static final int PAGE_LOAD_DELAY_MS = 8000;  // Longer for Angular

    private static final boolean DOWNLOAD_ALL_DOCUMENTS = false;
    private static final boolean DEBUG_MODE = true;
    private static final boolean TAKE_SCREENSHOTS = true;

    private WebDriver driver;
    private WebDriverWait wait;
    private Map<String, String> patentToAppNumber = new HashMap<>();
    private int successCount = 0;
    private int errorCount = 0;

    public static void main(String[] args) {
        System.setProperty("webdriver.chrome.driver",
                "C:\\frame\\chromedriver-win64\\chromedriver.exe");

        PatentCenterDirectDownloader downloader = new PatentCenterDirectDownloader();

        try {
            System.out.println("=================================================");
            System.out.println("Patent Center Direct Document Downloader");
            System.out.println("=================================================");
            System.out.println("Strategy: Direct URL access using app numbers");
            System.out.println("Output:   " + OUTPUT_DIR);
            System.out.println("=================================================\n");

            downloader.initializeBrowser();
            downloader.loadPatentsFromCSV();
            downloader.downloadFileWrappers();
            downloader.printSummary();

        } catch (Exception e) {
            System.err.println("\nFATAL ERROR:");
            e.printStackTrace();
        } finally {
            downloader.cleanup();
        }
    }

    private void initializeBrowser() {
        System.out.println("Initializing browser...\n");

        new File(OUTPUT_DIR).mkdirs();
        new File(DOWNLOAD_DIR).mkdirs();
        if (TAKE_SCREENSHOTS) {
            new File(OUTPUT_DIR + File.separator + "screenshots").mkdirs();
        }

        ChromeOptions options = new ChromeOptions();
        options.addArguments("--start-maximized");
        options.addArguments("--disable-blink-features=AutomationControlled");

        Map<String, Object> prefs = new HashMap<>();
        prefs.put("download.default_directory", new File(DOWNLOAD_DIR).getAbsolutePath());
        prefs.put("download.prompt_for_download", false);
        prefs.put("plugins.always_open_pdf_externally", true);
        options.setExperimentalOption("prefs", prefs);

        this.driver = new ChromeDriver(options);
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(30));
    }

    private void loadPatentsFromCSV() throws IOException {
        System.out.println("Loading patents from CSV...");

        try (BufferedReader reader = new BufferedReader(new FileReader(INPUT_CSV))) {
            String line = reader.readLine(); // Skip header

            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                String[] parts = line.split(",");
                String patentNum = parts[0].trim();

                // If CSV has 2 columns: patent,appNum
                if (parts.length > 1) {
                    String appNum = parts[1].trim().replaceAll("[^0-9]", "");
                    patentToAppNumber.put(patentNum, appNum);
                } else {
                    // Just patent number - we'll try to find app number
                    patentToAppNumber.put(patentNum, null);
                }
            }
        }

        System.out.println("  Loaded " + patentToAppNumber.size() + " patents\n");
    }

    private void downloadFileWrappers() throws Exception {
        System.out.println("Downloading file wrappers...\n");

        int i = 0;
        for (Map.Entry<String, String> entry : patentToAppNumber.entrySet()) {
            i++;
            String patentNum = entry.getKey();
            String appNum = entry.getValue();

            System.out.println("[" + i + "/" + patentToAppNumber.size() + "] Patent: " + patentNum);

            try {
                // If no app number, try to get it first
                if (appNum == null || appNum.isEmpty()) {
                    System.out.println("  Finding application number...");
                    appNum = findApplicationNumber(patentNum);
                    if (appNum == null) {
                        System.err.println("  ERROR: Could not find application number");
                        errorCount++;
                        continue;
                    }
                    System.out.println("  Found: " + appNum);
                }

                boolean success = downloadFromPatentCenter(patentNum, appNum);

                if (success) {
                    successCount++;
                } else {
                    errorCount++;
                }

                if (i < patentToAppNumber.size()) {
                    System.out.println("  Waiting " + (DELAY_BETWEEN_PATENTS_MS / 1000) + " seconds...");
                    Thread.sleep(DELAY_BETWEEN_PATENTS_MS);
                }

            } catch (Exception e) {
                System.err.println("  ERROR: " + e.getMessage());
                if (DEBUG_MODE) {
                    e.printStackTrace();
                }
                errorCount++;
            }

            System.out.println();
        }
    }

    private String findApplicationNumber(String patentNum) throws Exception {
        // Use Open Data Portal API to get app number
        String apiUrl = "https://data.uspto.gov/api/1/datastore/sql?query=" +
                "SELECT%20application_number_text%20FROM%20patent_file_wrapper" +
                "%20WHERE%20patent_number=%27" + patentNum + "%27";

        // This would require HTTP request - for now return null
        // In production, use HttpURLConnection or similar
        return null;
    }

    private boolean downloadFromPatentCenter(String patentNum, String appNum) throws Exception {
        // Clean application number (remove slashes, keep digits only)
        String cleanAppNum = appNum.replaceAll("[^0-9]", "");

        // Go directly to application page
        String url = PATENT_CENTER_BASE + cleanAppNum;
        System.out.println("  URL: " + url);

        driver.get(url);
        Thread.sleep(PAGE_LOAD_DELAY_MS);

        if (TAKE_SCREENSHOTS) {
            takeScreenshot("app_page_" + patentNum + "_1");
        }

        // Look for Documents tab
        WebElement docsTab = findDocumentsTab();
        if (docsTab == null) {
            System.err.println("  ERROR: Could not find Documents tab");
            return false;
        }

        System.out.println("  Found Documents tab, clicking...");

        // Use JavaScript click (more reliable for Angular)
        ((JavascriptExecutor) driver).executeScript("arguments[0].click();", docsTab);
        Thread.sleep(PAGE_LOAD_DELAY_MS);

        if (TAKE_SCREENSHOTS) {
            takeScreenshot("docs_tab_" + patentNum + "_2");
        }

        // Download documents
        int count = downloadDocumentsFromPage(patentNum);
        System.out.println("  Downloaded " + count + " documents");

        return count > 0;
    }

    private WebElement findDocumentsTab() {
        // Try multiple selectors for Documents tab
        String[] selectors = {
                "//a[contains(text(), 'Documents')]",
                "//button[contains(text(), 'Documents')]",
                "//span[contains(text(), 'Documents')]/../..",
                "a[href*='documents']",
                "#documents-tab",
                ".documents-tab"
        };

        for (String selector : selectors) {
            try {
                if (selector.startsWith("//")) {
                    List<WebElement> elements = driver.findElements(By.xpath(selector));
                    if (!elements.isEmpty()) {
                        return elements.get(0);
                    }
                } else {
                    List<WebElement> elements = driver.findElements(By.cssSelector(selector));
                    if (!elements.isEmpty()) {
                        return elements.get(0);
                    }
                }
            } catch (Exception e) {
                // Try next
            }
        }

        return null;
    }

    private int downloadDocumentsFromPage(String patentNum) throws Exception {
        int count = 0;

        // Wait for document table to load
        Thread.sleep(3000);

        // Look for document rows
        List<WebElement> rows = driver.findElements(By.cssSelector("tr"));
        System.out.println("  Found " + rows.size() + " table rows");

        for (WebElement row : rows) {
            try {
                String rowText = row.getText().toUpperCase();

                if (shouldDownloadDocument(rowText)) {
                    System.out.println("    Downloading: " + rowText.substring(0, Math.min(60, rowText.length())));

                    // Look for download button/link in this row
                    WebElement downloadBtn = findDownloadButton(row);

                    if (downloadBtn != null) {
                        // JavaScript click
                        ((JavascriptExecutor) driver).executeScript("arguments[0].click();", downloadBtn);
                        Thread.sleep(DELAY_BETWEEN_DOWNLOADS_MS);

                        if (waitForDownloadToComplete()) {
                            String filename = patentNum + "_doc_" + count + ".pdf";
                            moveDownloadedFile(filename, patentNum);
                            count++;
                        }
                    }
                }
            } catch (Exception e) {
                if (DEBUG_MODE) {
                    System.err.println("    Error with row: " + e.getMessage());
                }
            }
        }

        return count;
    }

    private WebElement findDownloadButton(WebElement row) {
        String[] selectors = {
                "button[aria-label*='Download']",
                "a[aria-label*='Download']",
                "button.download",
                "a.download",
                "button[download]",
                "a[download]",
                "i.fa-download/../..",
                "*[class*='download']"
        };

        for (String selector : selectors) {
            try {
                List<WebElement> buttons = row.findElements(By.cssSelector(selector));
                if (!buttons.isEmpty()) {
                    return buttons.get(0);
                }
            } catch (Exception e) {
                // Try next
            }
        }

        return null;
    }

    private boolean shouldDownloadDocument(String rowText) {
        if (DOWNLOAD_ALL_DOCUMENTS) return true;

        // Look for key document codes
        String[] relevantCodes = {
                "PRESP", "RCEX",  // Applicant responses
                "AMND", "AFCP",   // Amendments
                "CTFR", "CTNF"    // Office actions
        };

        for (String code : relevantCodes) {
            if (rowText.contains(code)) {
                return true;
            }
        }

        return false;
    }

    private boolean waitForDownloadToComplete() throws InterruptedException {
        int waited = 0;
        int maxWait = 60;

        while (waited < maxWait) {
            File downloadDir = new File(DOWNLOAD_DIR);
            File[] files = downloadDir.listFiles((dir, name) ->
                    name.endsWith(".pdf") && !name.endsWith(".crdownload"));

            if (files != null && files.length > 0) {
                File latestFile = files[0];
                for (File f : files) {
                    if (f.lastModified() > latestFile.lastModified()) {
                        latestFile = f;
                    }
                }

                long size1 = latestFile.length();
                Thread.sleep(1000);
                long size2 = latestFile.length();

                if (size1 == size2 && size1 > 0) {
                    return true;
                }
            }

            Thread.sleep(1000);
            waited++;
        }

        return false;
    }

    private void moveDownloadedFile(String newFilename, String patentNum) throws IOException {
        File downloadDir = new File(DOWNLOAD_DIR);
        File[] files = downloadDir.listFiles((dir, name) -> name.endsWith(".pdf"));

        if (files != null && files.length > 0) {
            File latestFile = files[0];
            for (File f : files) {
                if (f.lastModified() > latestFile.lastModified()) {
                    latestFile = f;
                }
            }

            String patentDir = patentNum.replace("/", "-");
            File destDir = new File(OUTPUT_DIR + File.separator + patentDir);
            destDir.mkdirs();

            File destFile = new File(destDir, newFilename);
            Files.move(latestFile.toPath(), destFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void takeScreenshot(String name) {
        try {
            File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
            File destFile = new File(OUTPUT_DIR + File.separator + "screenshots" +
                    File.separator + name + ".png");
            Files.copy(screenshot.toPath(), destFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            if (DEBUG_MODE) {
                System.err.println("  Screenshot error: " + e.getMessage());
            }
        }
    }

    private void printSummary() {
        System.out.println("\n=================================================");
        System.out.println("Download Summary:");
        System.out.println("=================================================");
        System.out.println("Total patents:     " + patentToAppNumber.size());
        System.out.println("Success:           " + successCount);
        System.out.println("Errors:            " + errorCount);
        System.out.println("Output directory:  " + OUTPUT_DIR);
        System.out.println("=================================================");
    }

    private void cleanup() {
        if (driver != null) {
            if (!DEBUG_MODE) {
                driver.quit();
            } else {
                System.out.println("\nDEBUG: Browser left open");
            }
        }
    }
}
