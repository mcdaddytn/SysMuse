package com.sysmuse.bulk;

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.ZonedDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Downloads USPTO Patent Grant Bulk Data with CAPTCHA handling
 * Saves CAPTCHA screenshots for manual solving
 */
public class USPTOBulkDownloaderWC {

    private static final String BASE_URL = "https://data.uspto.gov/bulkdata/datasets/ptgrxml";
    private static final String BASE_OUTPUT_DIR = "F:\\data\\uspto\\bulkdata";
    private static final String CAPTCHA_IMAGE = BASE_OUTPUT_DIR + File.separator + "current_captcha.jpg";
    private static final String ANSWER_FILE = BASE_OUTPUT_DIR + File.separator + "answer.txt";

    // CAPTCHA handling modes
    public enum CaptchaMode {
        MANUAL,      // User solves CAPTCHA in browser (DEFAULT)
        TEXT_FILE,   // Screenshot + answer.txt approach
        AUTO         // Checks both manual and text file
    }

    private static final CaptchaMode CAPTCHA_MODE = CaptchaMode.MANUAL;  // Change this to switch modes

    // File organization
    private static final boolean USE_YEAR_SUBDIRECTORIES = true;  // Save to subdirs like 2022/

    // Retry and timing
    private static final boolean RETRY_FAILED_FILES = true;        // Retry files that failed
    private static final int DOWNLOAD_DELAY_SECONDS = 10;          // Wait between downloads

    // CAPTCHA timing
    private static final int CAPTCHA_WAIT_SECONDS = 300; // Max wait for CAPTCHA (5 min)

    private WebDriver driver;
    private WebDriverWait wait;
    private List<String> failedFiles = new ArrayList<>();

    public static void main(String[] args) {
        // Set Chrome driver path
        System.setProperty("webdriver.chrome.driver",
                "F:\\frame\\chromedriver-win64\\chromedriver.exe");

        USPTOBulkDownloaderWC downloader = new USPTOBulkDownloaderWC();

        try {
            // Example: Download all patents for a year

            downloader.downloadPatentGrantsForYear(2004);

            // finished
            //downloader.downloadPatentGrantsForYear(2025);
            //downloader.downloadPatentGrantsForYear(2024);
            //downloader.downloadPatentGrantsForYear(2023);
            //downloader.downloadPatentGrantsForYear(2022);
            //downloader.downloadPatentGrantsForYear(2021);
            //downloader.downloadPatentGrantsForYear(2020);
            //downloader.downloadPatentGrantsForYear(2019);
            downloader.downloadPatentGrantsForYear(2018);
            //downloader.downloadPatentGrantsForYear(2017);
            //downloader.downloadPatentGrantsForYear(2016);
            //downloader.downloadPatentGrantsForYear(2015);
            //downloader.downloadPatentGrantsForYear(2014);
            //downloader.downloadPatentGrantsForYear(2013);
            //downloader.downloadPatentGrantsForYear(2012);
            //downloader.downloadPatentGrantsForYear(2011);
            //downloader.downloadPatentGrantsForYear(2010);
            //downloader.downloadPatentGrantsForYear(2009);
            //downloader.downloadPatentGrantsForYear(2008);
            //downloader.downloadPatentGrantsForYear(2007);
            //downloader.downloadPatentGrantsForYear(2006);
            //downloader.downloadPatentGrantsForYear(2005);
            //downloader.downloadPatentGrantsForYear(2004);
            //downloader.downloadPatentGrantsForYear(2003);
            //downloader.downloadPatentGrantsForYear(2002);

            // Or download specific date range
            // downloader.downloadPatentGrantsByDateRange("2019-01-01", "2019-06-30");

        } catch (Exception e) {
            System.err.println("\n=================================================");
            System.err.println("FATAL ERROR - Program stopped");
            System.err.println("=================================================");
            e.printStackTrace();
        } finally {
            downloader.cleanup();
        }
    }

    public USPTOBulkDownloaderWC() {
        new File(BASE_OUTPUT_DIR).mkdirs();

        ChromeOptions options = new ChromeOptions();
        options.addArguments("--start-maximized");
        options.addArguments("--disable-blink-features=AutomationControlled");

        // Chrome always downloads to BASE_OUTPUT_DIR
        // We'll move files to year subdirectories after download
        options.setExperimentalOption("prefs", java.util.Map.of(
                "download.default_directory", new File(BASE_OUTPUT_DIR).getAbsolutePath(),
                "download.prompt_for_download", false,
                "download.directory_upgrade", true,
                "safebrowsing.enabled", true
        ));

        this.driver = new ChromeDriver(options);
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(30));
    }

    public void downloadPatentGrantsByDateRange(String startDate, String endDate) {
        LocalDate start = LocalDate.parse(startDate);
        LocalDate end = LocalDate.parse(endDate);
        ZonedDateTime now = null;

        System.out.println("=================================================");
        System.out.println("USPTO Patent Grant Bulk Downloader");
        System.out.println("=================================================");
        System.out.println("Date Range: " + startDate + " to " + endDate);
        System.out.println("Output Directory: " + BASE_OUTPUT_DIR);
        System.out.println("Year Subdirectories: " + (USE_YEAR_SUBDIRECTORIES ? "YES" : "NO"));
        System.out.println("CAPTCHA Mode: " + CAPTCHA_MODE);
        System.out.println("Retry Failed: " + (RETRY_FAILED_FILES ? "YES" : "NO"));
        System.out.println("Download Delay: " + DOWNLOAD_DELAY_SECONDS + " seconds");
        System.out.println("=================================================\n");

        List<LocalDate> tuesdays = getTuesdaysInRange(start, end);
        System.out.println("Found " + tuesdays.size() + " publication dates (Tuesdays)\n");

        int successCount = 0;
        int skipCount = 0;
        int errorCount = 0;

        // First pass - attempt all files
        for (int i = 0; i < tuesdays.size(); i++) {
            LocalDate tuesday = tuesdays.get(i);

            try {
                now = ZonedDateTime.now(ZoneId.systemDefault());
                System.out.printf("Current Datetime: %1$tY-%1$tm-%1$td %1$tH:%1$tM:%1$tS%n", now);
                System.out.printf("\n[%d/%d] Processing %s...\n", i + 1, tuesdays.size(), tuesday);

                DownloadResult result = downloadPatentGrantForDate(tuesday);

                switch (result) {
                    case SUCCESS:
                        successCount++;
                        // Brief delay between downloads
                        if (i < tuesdays.size() - 1) {
                            System.out.println("  Waiting " + DOWNLOAD_DELAY_SECONDS + " seconds before next download...");
                            Thread.sleep(DOWNLOAD_DELAY_SECONDS * 1000);
                        }
                        break;
                    case ALREADY_EXISTS:
                        skipCount++;
                        break;
                    case ERROR:
                        errorCount++;
                        failedFiles.add(generateFilename(tuesday));
                        break;
                }

            } catch (Exception e) {
                System.err.println("  ERROR: " + e.getMessage());
                errorCount++;
                failedFiles.add(generateFilename(tuesday));
            }
        }

        // Second pass - retry failed files if enabled
        if (RETRY_FAILED_FILES && !failedFiles.isEmpty()) {
            System.out.println("\n=================================================");
            System.out.println("RETRYING FAILED FILES (" + failedFiles.size() + ")");
            System.out.println("=================================================\n");

            List<String> stillFailed = new ArrayList<>();

            for (int i = 0; i < failedFiles.size(); i++) {
                String filename = failedFiles.get(i);
                LocalDate date = parseFilenameToDate(filename);

                try {
                    System.out.printf("\n[RETRY %d/%d] Processing %s...\n",
                            i + 1, failedFiles.size(), date);

                    DownloadResult result = downloadPatentGrantForDate(date);

                    if (result == DownloadResult.SUCCESS) {
                        successCount++;
                        errorCount--;
                    } else if (result == DownloadResult.ALREADY_EXISTS) {
                        skipCount++;
                        errorCount--;
                    } else {
                        stillFailed.add(filename);
                    }

                    if (i < failedFiles.size() - 1) {
                        System.out.println("  Waiting " + DOWNLOAD_DELAY_SECONDS + " seconds before next retry...");
                        Thread.sleep(DOWNLOAD_DELAY_SECONDS * 1000);
                    }

                } catch (Exception e) {
                    System.err.println("  ERROR: " + e.getMessage());
                    stillFailed.add(filename);
                }
            }

            failedFiles = stillFailed;
        }

        System.out.println("\n=================================================");
        System.out.println("Download Summary:");
        System.out.println("  Downloaded: " + successCount);
        System.out.println("  Skipped: " + skipCount);
        System.out.println("  Errors: " + errorCount);
        System.out.println("  Total: " + tuesdays.size());

        if (!failedFiles.isEmpty()) {
            System.out.println("\n  Failed files:");
            for (String filename : failedFiles) {
                System.out.println("    - " + filename);
            }
        }
        System.out.println("=================================================");
    }

    public void downloadPatentGrantsForYear(int year) {
        String startDate = year + "-01-01";
        String endDate = year + "-12-31";
        downloadPatentGrantsByDateRange(startDate, endDate);
    }

    private DownloadResult downloadPatentGrantForDate(LocalDate date) throws Exception {
        int year = date.getYear();
        String filename = generateFilename(date);

        // Determine final destination path
        String finalDir = BASE_OUTPUT_DIR;
        if (USE_YEAR_SUBDIRECTORIES) {
            finalDir = BASE_OUTPUT_DIR + File.separator + year;
            new File(finalDir).mkdirs();  // Create year subdirectory if needed
        }
        String finalFilePath = finalDir + File.separator + filename;

        // Chrome downloads to base directory
        String tempFilePath = BASE_OUTPUT_DIR + File.separator + filename;

        // Check if file already exists in final location
        File finalFile = new File(finalFilePath);
        if (finalFile.exists() && finalFile.length() > 0) {
            long fileSize = finalFile.length();
            String fileSizeMB = String.format("%.2f MB", fileSize / (1024.0 * 1024.0));
            System.out.println("  SKIPPED: File already exists - " + filename + " (" + fileSizeMB + ")");
            return DownloadResult.ALREADY_EXISTS;
        }

        // Also check if file exists in base directory (left over from previous run)
        File tempFile = new File(tempFilePath);
        if (tempFile.exists() && tempFile.length() > 0 && !tempFilePath.equals(finalFilePath)) {
            // Move it to final location
            long fileSize = tempFile.length();
            String fileSizeMB = String.format("%.2f MB", fileSize / (1024.0 * 1024.0));
            System.out.println("  FOUND: File exists in base directory, moving to year subdirectory - " + filename + " (" + fileSizeMB + ")");
            Files.move(tempFile.toPath(), finalFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            return DownloadResult.ALREADY_EXISTS;
        }

        // Navigate to listing page with date filter
        LocalDate weekBefore = date.minusDays(7);
        LocalDate weekAfter = date.plusDays(7);

        String listingUrl = String.format("%s?fileDataFromDate=%s&fileDataToDate=%s",
                BASE_URL,
                weekBefore.format(DateTimeFormatter.ISO_LOCAL_DATE),
                weekAfter.format(DateTimeFormatter.ISO_LOCAL_DATE));

        System.out.println("  Navigating to listing page...");
        driver.get(listingUrl);
        Thread.sleep(3000);

        // Find the file link
        System.out.println("  Looking for file: " + filename);

        WebElement downloadLink;
        try {
            String xpath = String.format("//a[contains(@href, '%s') or contains(text(), '%s')]",
                    filename, filename);
            downloadLink = driver.findElement(By.xpath(xpath));
        } catch (NoSuchElementException e) {
            System.out.println("  SKIPPED: File not found in listing - " + filename);
            return DownloadResult.ALREADY_EXISTS;
        }

        // Click the download link
        System.out.println("  Clicking download link...");
        downloadLink.click();
        Thread.sleep(2000);

        // Check for CAPTCHA and handle based on mode
        if (isCaptchaPresent()) {
            System.out.println("  CAPTCHA detected...");
            if (!handleCaptcha()) {
                System.err.println("  ERROR: CAPTCHA handling failed");
                return DownloadResult.ERROR;
            }
            System.out.println("  CAPTCHA resolved!");
            Thread.sleep(1000);
        }

        // Wait for download to complete (file will be in BASE_OUTPUT_DIR)
        System.out.println("  Downloading...");
        if (!waitForDownloadToComplete(tempFilePath, 600)) {
            System.err.println("  ERROR: Download did not complete within 10 minutes");
            return DownloadResult.ERROR;
        }

        // Verify download
        tempFile = new File(tempFilePath);
        if (!tempFile.exists() || tempFile.length() == 0) {
            System.err.println("  ERROR: Downloaded file is missing or empty");
            return DownloadResult.ERROR;
        }

        long fileSize = tempFile.length();
        String fileSizeMB = String.format("%.2f MB", fileSize / (1024.0 * 1024.0));

        // Move to year subdirectory if needed
        if (USE_YEAR_SUBDIRECTORIES && !tempFilePath.equals(finalFilePath)) {
            System.out.println("  Moving to year subdirectory...");
            Files.move(tempFile.toPath(), finalFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            System.out.println("  SUCCESS: Downloaded and moved " + filename + " (" + fileSizeMB + ")");
        } else {
            System.out.println("  SUCCESS: Downloaded " + filename + " (" + fileSizeMB + ")");
        }

        return DownloadResult.SUCCESS;
    }

    private boolean isCaptchaPresent() {
        try {
            WebElement captchaDialog = driver.findElement(By.tagName("app-captcha-dialog"));
            return captchaDialog.isDisplayed();
        } catch (NoSuchElementException e) {
            return false;
        }
    }

    /**
     * Handle CAPTCHA based on configured mode
     */
    private boolean handleCaptcha() throws Exception {
        switch (CAPTCHA_MODE) {
            case MANUAL:
                return handleCaptchaManual();
            case TEXT_FILE:
                return handleCaptchaTextFile();
            case AUTO:
                return handleCaptchaAuto();
            default:
                return false;
        }
    }

    /**
     * MANUAL mode: Wait for user to solve CAPTCHA in browser
     */
    private boolean handleCaptchaManual() throws InterruptedException {
        System.out.println("  ╔════════════════════════════════════════════════╗");
        System.out.println("  ║     CAPTCHA - SOLVE IT IN THE BROWSER         ║");
        System.out.println("  ╚════════════════════════════════════════════════╝");
        System.out.println("  Please solve the CAPTCHA manually in the browser window");
        System.out.println("  Waiting for CAPTCHA to disappear (timeout: " + CAPTCHA_WAIT_SECONDS + "s)...");

        int waited = 0;
        int lastReport = 0;

        while (waited < CAPTCHA_WAIT_SECONDS) {
            if (!isCaptchaPresent()) {
                System.out.println("  ✓ CAPTCHA solved!");
                return true;
            }

            Thread.sleep(1000);
            waited++;

            if (waited - lastReport >= 15) {
                System.out.println("  Still waiting... (" + waited + "s / " + CAPTCHA_WAIT_SECONDS + "s)");
                lastReport = waited;
            }
        }

        System.err.println("  ERROR: Timeout waiting for CAPTCHA to be solved");
        return false;
    }

    /**
     * TEXT_FILE mode: Screenshot + answer.txt approach
     */
    private boolean handleCaptchaTextFile() throws Exception {
        // Delete old files
        new File(ANSWER_FILE).delete();

        // Take screenshot
        File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
        Files.copy(screenshot.toPath(), Paths.get(CAPTCHA_IMAGE),
                StandardCopyOption.REPLACE_EXISTING);

        System.out.println("  ╔════════════════════════════════════════════════╗");
        System.out.println("  ║  CAPTCHA - USE ANSWER.TXT FILE                 ║");
        System.out.println("  ╚════════════════════════════════════════════════╝");
        System.out.println("  Screenshot: " + CAPTCHA_IMAGE);
        System.out.println("  Answer file: " + ANSWER_FILE);
        System.out.println();
        System.out.println("  INSTRUCTIONS:");
        System.out.println("  1. Open screenshot to see the math problem");
        System.out.println("  2. Create " + ANSWER_FILE);
        System.out.println("  3. Put just the number (e.g., '6')");
        System.out.println();
        System.out.println("  Waiting for answer (timeout: " + CAPTCHA_WAIT_SECONDS + "s)...");

        String answer = waitForAnswerFile(ANSWER_FILE, CAPTCHA_WAIT_SECONDS);
        if (answer == null) {
            System.err.println("  ERROR: Timeout waiting for answer");
            return false;
        }

        System.out.println("  Answer received: " + answer);

        // Write "0" to confirm we read it
        Files.writeString(Paths.get(ANSWER_FILE), "0");
        System.out.println("  (Wrote '0' to answer.txt to confirm)");

        // Submit answer
        return submitCaptchaAnswer(answer);
    }

    /**
     * AUTO mode: Check both manual solving and text file
     */
    private boolean handleCaptchaAuto() throws Exception {
        // Delete old answer file
        new File(ANSWER_FILE).delete();

        // Take screenshot
        File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
        Files.copy(screenshot.toPath(), Paths.get(CAPTCHA_IMAGE),
                StandardCopyOption.REPLACE_EXISTING);

        System.out.println("  ╔════════════════════════════════════════════════╗");
        System.out.println("  ║  CAPTCHA - AUTO MODE                           ║");
        System.out.println("  ╚════════════════════════════════════════════════╝");
        System.out.println("  Option 1: Solve manually in browser");
        System.out.println("  Option 2: Use answer.txt file");
        System.out.println("  Screenshot: " + CAPTCHA_IMAGE);
        System.out.println("  Answer file: " + ANSWER_FILE);
        System.out.println();
        System.out.println("  Waiting (timeout: " + CAPTCHA_WAIT_SECONDS + "s)...");

        int waited = 0;
        int lastReport = 0;

        while (waited < CAPTCHA_WAIT_SECONDS) {
            // Check if manually solved
            if (!isCaptchaPresent()) {
                System.out.println("  ✓ CAPTCHA solved manually!");
                new File(CAPTCHA_IMAGE).delete();
                return true;
            }

            // Check if answer file provided
            File ansFile = new File(ANSWER_FILE);
            if (ansFile.exists() && ansFile.length() > 0) {
                try {
                    String answer = Files.readString(ansFile.toPath()).trim();
                    if (!answer.isEmpty() && !answer.equals("0")) {
                        System.out.println("  Answer file detected: " + answer);

                        // Write "0" to confirm
                        Files.writeString(ansFile.toPath(), "0");
                        System.out.println("  (Wrote '0' to answer.txt to confirm)");

                        boolean success = submitCaptchaAnswer(answer);
                        new File(CAPTCHA_IMAGE).delete();
                        return success;
                    }
                } catch (IOException e) {
                    // File still being written
                }
            }

            Thread.sleep(1000);
            waited++;

            if (waited - lastReport >= 15) {
                System.out.println("  Still waiting... (" + waited + "s / " + CAPTCHA_WAIT_SECONDS + "s)");
                lastReport = waited;
            }
        }

        System.err.println("  ERROR: Timeout");
        return false;
    }

    /**
     * Submit CAPTCHA answer to the form
     */
    private boolean submitCaptchaAnswer(String answer) throws InterruptedException {
        System.out.println("  Submitting answer...");

        WebElement input = driver.findElement(By.id("jCaptcha"));
        input.clear();
        input.sendKeys(answer);

        WebElement continueButton = driver.findElement(
                By.cssSelector("button.btn-primary.btn-sm"));
        continueButton.click();

        // Wait for dialog to close
        try {
            wait.until(ExpectedConditions.invisibilityOfElementLocated(
                    By.tagName("app-captcha-dialog")));
            System.out.println("  ✓ CAPTCHA solved successfully!");
            return true;
        } catch (TimeoutException e) {
            System.err.println("  ERROR: CAPTCHA dialog did not close - wrong answer?");
            return false;
        }
    }

    /**
     * Wait for answer.txt file and read it
     */
    private String waitForAnswerFile(String answerFilePath, int timeoutSeconds)
            throws InterruptedException {
        File answerFile = new File(answerFilePath);
        int waited = 0;
        int lastReport = 0;

        while (waited < timeoutSeconds) {
            if (answerFile.exists() && answerFile.length() > 0) {
                try {
                    String answer = Files.readString(answerFile.toPath()).trim();
                    if (!answer.isEmpty() && !answer.equals("0")) {
                        return answer;
                    }
                } catch (IOException e) {
                    // Still being written
                }
            }

            Thread.sleep(1000);
            waited++;

            if (waited - lastReport >= 15) {
                System.out.println("  Still waiting for answer file... (" + waited + "s / " + timeoutSeconds + "s)");
                lastReport = waited;
            }
        }

        return null;
    }

    /**
     * Wait for download to complete
     * Simplified - just waits for file to exist and stabilize
     */
    private boolean waitForDownloadToComplete(String filepath, int timeoutSeconds)
            throws InterruptedException {
        File file = new File(filepath);
        long previousSize = -1;
        int stableCount = 0;
        int waited = 0;
        long lastReportSize = 0;
        int lastReportTime = 0;

        // First, wait for file to appear (may take a few seconds after CAPTCHA)
        while (waited < 30 && !file.exists()) {
            Thread.sleep(1000);
            waited++;
        }

        if (!file.exists()) {
            System.err.println("  ERROR: Download file not appearing");
            return false;
        }

        System.out.println("  Download started!");

        // Now wait for download to complete (file size stops changing)
        while (waited < timeoutSeconds) {
            long currentSize = file.length();

            if (currentSize == previousSize && currentSize > 0) {
                stableCount++;
                if (stableCount >= 3) {
                    System.out.println("  Download complete!");
                    return true;
                }
            } else {
                stableCount = 0;
            }

            previousSize = currentSize;
            Thread.sleep(1000);
            waited++;

            // Progress reporting every 10 seconds or 10MB
            if ((waited - lastReportTime >= 10) || (currentSize - lastReportSize > 10 * 1024 * 1024)) {
                if (currentSize > 0) {
                    String sizeMB = String.format("%.2f MB", currentSize / (1024.0 * 1024.0));
                    System.out.println("  Downloaded: " + sizeMB);
                    lastReportSize = currentSize;
                    lastReportTime = waited;
                }
            }
        }

        return false;
    }

    private String generateFilename(LocalDate date) {
        String yy = String.format("%02d", date.getYear() % 100);
        String mm = String.format("%02d", date.getMonthValue());
        String dd = String.format("%02d", date.getDayOfMonth());

        if (date.getYear() >= 2005) {
            return "ipg" + yy + mm + dd + ".zip";
        } else if (date.getYear() >= 2002) {
            return "pg" + yy + mm + dd + ".zip";
        } else {
            throw new IllegalArgumentException("Pre-2002 not supported");
        }
    }

    private LocalDate parseFilenameToDate(String filename) {
        // Parse ipg221220.zip -> 2022-12-20
        //String dateStr = filename.substring(3, 9); // "221220"
        //gm: 2004 and back, different convention pg040803.zip
        String dateStr = filename.startsWith("ipg") ? filename.substring(3, 9) : filename.substring(2, 8);
        System.out.println("  Parsing filename to date: " + filename + " dateStr: " + dateStr );
        int yy = Integer.parseInt(dateStr.substring(0, 2));
        int mm = Integer.parseInt(dateStr.substring(2, 4));
        int dd = Integer.parseInt(dateStr.substring(4, 6));

        int year = (yy >= 76) ? (1900 + yy) : (2000 + yy);
        return LocalDate.of(year, mm, dd);
    }

    private List<LocalDate> getTuesdaysInRange(LocalDate start, LocalDate end) {
        List<LocalDate> tuesdays = new ArrayList<>();

        LocalDate current = start;
        while (current.getDayOfWeek() != DayOfWeek.TUESDAY) {
            current = current.plusDays(1);
        }

        while (!current.isAfter(end)) {
            tuesdays.add(current);
            current = current.plusDays(7);
        }

        return tuesdays;
    }

    public void cleanup() {
        if (driver != null) {
            driver.quit();
        }
    }

    private enum DownloadResult {
        SUCCESS,
        ALREADY_EXISTS,
        ERROR
    }
}