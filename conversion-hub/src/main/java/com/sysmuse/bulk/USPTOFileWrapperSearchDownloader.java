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
 * USPTO File Wrapper Search Downloader
 * Uses the actual interface from user's HTML: https://data.uspto.gov/patent-file-wrapper/search
 */
public class USPTOFileWrapperSearchDownloader {

    // ==================== CONFIGURATION ====================
    private static final String INPUT_CSV = "C:\\docs\\rj\\Patents\\broadcom\\high-priority-patents.csv";
    private static final String OUTPUT_DIR = "C:\\data\\uspto\\file-wrappers";
    private static final String DOWNLOAD_DIR = "C:\\data\\uspto\\file-wrappers\\downloads";

    // USPTO File Wrapper Search (NOT Patent Center)
    private static final String SEARCH_URL = "https://data.uspto.gov/patent-file-wrapper/search";

    private static final int PATENTS_PER_HOUR = 10;
    private static final int DELAY_BETWEEN_PATENTS_MS = (3600 * 1000) / PATENTS_PER_HOUR;
    private static final int DELAY_BETWEEN_DOWNLOADS_MS = 5000;
    private static final int PAGE_LOAD_DELAY_MS = 3000;

    private static final boolean DOWNLOAD_APPLICANT_RESPONSES = true;
    private static final boolean DOWNLOAD_AMENDMENTS = true;
    private static final boolean DOWNLOAD_OFFICE_ACTIONS = true;
    private static final boolean DOWNLOAD_ALL_DOCUMENTS = false;

    private static final boolean DEBUG_MODE = true;
    private static final boolean TAKE_SCREENSHOTS = true;

    private WebDriver driver;
    private WebDriverWait wait;
    private List<String> patents = new ArrayList<>();
    private int successCount = 0;
    private int errorCount = 0;
    private int skipCount = 0;

    public static void main(String[] args) {
        System.setProperty("webdriver.chrome.driver",
                "C:\\frame\\chromedriver-win64\\chromedriver.exe");

        USPTOFileWrapperSearchDownloader downloader = new USPTOFileWrapperSearchDownloader();

        try {
            System.out.println("=================================================");
            System.out.println("USPTO File Wrapper Search Downloader");
            System.out.println("=================================================");
            System.out.println("Search URL:        " + SEARCH_URL);
            System.out.println("Input CSV:         " + INPUT_CSV);
            System.out.println("Output Directory:  " + OUTPUT_DIR);
            System.out.println("Rate Limit:        " + PATENTS_PER_HOUR + " patents/hour");
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
        prefs.put("download.directory_upgrade", true);
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
                String patentOrApp = line.split(",")[0].trim();
                patents.add(patentOrApp);
            }
        }

        System.out.println("  Loaded " + patents.size() + " patents/applications\n");
    }

    private void downloadFileWrappers() throws Exception {
        System.out.println("Downloading file wrappers...\n");

        for (int i = 0; i < patents.size(); i++) {
            String patent = patents.get(i);

            System.out.println("[" + (i+1) + "/" + patents.size() + "] Processing " + patent + "...");

            if (isAlreadyProcessed(patent)) {
                System.out.println("  SKIPPED: Already downloaded");
                skipCount++;
                continue;
            }

            try {
                boolean success = downloadPatentDocuments(patent);

                if (success) {
                    successCount++;
                    markAsProcessed(patent);
                } else {
                    errorCount++;
                }

                if (i < patents.size() - 1) {
                    System.out.println("  Waiting " + (DELAY_BETWEEN_PATENTS_MS / 1000) +
                            " seconds before next patent...");
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

    private boolean downloadPatentDocuments(String patentNum) throws Exception {
        // Navigate to search page
        driver.get(SEARCH_URL);
        Thread.sleep(PAGE_LOAD_DELAY_MS);

        if (TAKE_SCREENSHOTS) {
            takeScreenshot("search_page_" + patentNum + "_1");
        }

        // Find search box using EXACT selector from user's HTML
        WebElement searchBox = null;

        try {
            // Primary selector from user's HTML: id="search-box"
            searchBox = wait.until(ExpectedConditions.presenceOfElementLocated(
                    By.id("search-box")));
            System.out.println("  Found search box by id='search-box'");

        } catch (Exception e) {
            // Fallback: try by formcontrolname attribute
            try {
                searchBox = driver.findElement(
                        By.cssSelector("input[formcontrolname='q']"));
                System.out.println("  Found search box by formcontrolname='q'");
            } catch (Exception e2) {
                System.err.println("  ERROR: Could not find search box");
                if (DEBUG_MODE) {
                    System.err.println("  Available input elements:");
                    List<WebElement> inputs = driver.findElements(By.tagName("input"));
                    for (WebElement input : inputs) {
                        try {
                            System.err.println("    - id: " + input.getAttribute("id") +
                                    " | placeholder: " + input.getAttribute("placeholder"));
                        } catch (Exception ex) {
                            // skip
                        }
                    }
                }
                return false;
            }
        }

        // Clear and enter patent number
        searchBox.clear();
        searchBox.sendKeys(patentNum);
        System.out.println("  Entered: " + patentNum);

        Thread.sleep(2000);
        if (TAKE_SCREENSHOTS) {
            takeScreenshot("search_page_" + patentNum + "_2_entered");
        }

        // Submit search (press Enter)
        searchBox.sendKeys(Keys.RETURN);
        System.out.println("  Submitted search");

        Thread.sleep(PAGE_LOAD_DELAY_MS);
        if (TAKE_SCREENSHOTS) {
            takeScreenshot("search_results_" + patentNum + "_3");
        }

        // Look for results - try clicking first result
        try {
            // Common result selectors
            WebElement firstResult = null;
            String[] resultSelectors = {
                    "a.search-result-link",
                    "tr.search-result a",
                    "div.search-result a",
                    ".result-row a",
                    "a[href*='patent']",
                    "table tbody tr:first-child a"
            };

            for (String selector : resultSelectors) {
                try {
                    List<WebElement> results = driver.findElements(By.cssSelector(selector));
                    if (!results.isEmpty()) {
                        firstResult = results.get(0);
                        System.out.println("  Found result with selector: " + selector);
                        break;
                    }
                } catch (Exception e) {
                    // Try next
                }
            }

            if (firstResult == null) {
                System.err.println("  ERROR: No search results found");
                if (DEBUG_MODE) {
                    System.err.println("  Page source contains 'no results': " +
                            driver.getPageSource().toLowerCase().contains("no results"));
                }
                return false;
            }

            // Click result
            System.out.println("  Clicking first result...");
            firstResult.click();
            Thread.sleep(PAGE_LOAD_DELAY_MS);

            if (TAKE_SCREENSHOTS) {
                takeScreenshot("result_page_" + patentNum + "_4");
            }

        } catch (Exception e) {
            System.err.println("  ERROR: Could not navigate to result");
            if (DEBUG_MODE) {
                e.printStackTrace();
            }
            return false;
        }

        // Now we should be on the patent/application page
        // Look for Documents section or download links
        return downloadDocumentsFromPage(patentNum);
    }

    private boolean downloadDocumentsFromPage(String patentNum) throws Exception {
        System.out.println("  Looking for documents...");

        // Look for document links/table
        List<WebElement> documentLinks = new ArrayList<>();

        // Try various selectors for document download links
        String[] docLinkSelectors = {
                "a[href$='.pdf']",
                "a[download]",
                "a.download-link",
                "a.document-link",
                "button.download",
                "a[aria-label*='Download']"
        };

        for (String selector : docLinkSelectors) {
            try {
                List<WebElement> links = driver.findElements(By.cssSelector(selector));
                if (!links.isEmpty()) {
                    documentLinks.addAll(links);
                    System.out.println("  Found " + links.size() + " links with: " + selector);
                }
            } catch (Exception e) {
                // Continue
            }
        }

        if (documentLinks.isEmpty()) {
            System.err.println("  ERROR: No document links found");
            return false;
        }

        // Filter and download documents
        int downloadCount = 0;

        for (WebElement link : documentLinks) {
            try {
                String linkText = link.getText().toUpperCase();
                String linkHref = link.getAttribute("href");

                if (DEBUG_MODE) {
                    System.out.println("    Link: " + linkText + " -> " + linkHref);
                }

                if (shouldDownloadDocument(linkText)) {
                    System.out.println("    Downloading: " + linkText);

                    // Click link
                    link.click();
                    Thread.sleep(DELAY_BETWEEN_DOWNLOADS_MS);

                    if (waitForDownloadToComplete()) {
                        String filename = patentNum + "_doc_" + downloadCount + ".pdf";
                        moveDownloadedFile(filename, patentNum);
                        downloadCount++;
                    }
                }

            } catch (Exception e) {
                if (DEBUG_MODE) {
                    System.err.println("    Error with link: " + e.getMessage());
                }
            }
        }

        System.out.println("  Downloaded " + downloadCount + " documents");
        return downloadCount > 0;
    }

    private boolean shouldDownloadDocument(String text) {
        if (DOWNLOAD_ALL_DOCUMENTS) return true;

        if (DOWNLOAD_APPLICANT_RESPONSES &&
                (text.contains("RESPONSE") || text.contains("PRESP") || text.contains("RCEX"))) {
            return true;
        }

        if (DOWNLOAD_AMENDMENTS &&
                (text.contains("AMND") || text.contains("AMENDMENT"))) {
            return true;
        }

        if (DOWNLOAD_OFFICE_ACTIONS &&
                (text.contains("CTFR") || text.contains("CTNF") || text.contains("OFFICE ACTION"))) {
            return true;
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
            destFile.getParentFile().mkdirs();
            Files.copy(screenshot.toPath(), destFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
            if (DEBUG_MODE) {
                System.out.println("  Screenshot: " + name + ".png");
            }
        } catch (Exception e) {
            if (DEBUG_MODE) {
                System.err.println("  Could not take screenshot: " + e.getMessage());
            }
        }
    }

    private boolean isAlreadyProcessed(String patent) {
        String patentDir = patent.replace("/", "-");
        File markerFile = new File(OUTPUT_DIR + File.separator + patentDir + File.separator + ".processed");
        return markerFile.exists();
    }

    private void markAsProcessed(String patent) throws IOException {
        String patentDir = patent.replace("/", "-");
        File dir = new File(OUTPUT_DIR + File.separator + patentDir);
        dir.mkdirs();
        File marker = new File(dir, ".processed");
        marker.createNewFile();
    }

    private void printSummary() {
        System.out.println("\n=================================================");
        System.out.println("Download Summary:");
        System.out.println("=================================================");
        System.out.println("Total patents:         " + patents.size());
        System.out.println("Successfully processed: " + successCount);
        System.out.println("Skipped (existing):    " + skipCount);
        System.out.println("Errors:                " + errorCount);
        System.out.println("Output directory:      " + OUTPUT_DIR);
        if (TAKE_SCREENSHOTS) {
            System.out.println("Screenshots:           " + OUTPUT_DIR + "\\screenshots");
        }
        System.out.println("=================================================");
    }

    private void cleanup() {
        if (driver != null) {
            if (!DEBUG_MODE) {
                driver.quit();
            } else {
                System.out.println("\nDEBUG MODE: Browser left open. Close manually when done.");
            }
        }
    }
}
