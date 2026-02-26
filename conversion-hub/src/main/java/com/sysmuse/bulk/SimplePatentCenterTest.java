package com.sysmuse.bulk;

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.io.*;
import java.nio.file.Files;
import java.util.*;

/**
 * Simple Patent Center Test - No CSV Required
 * Hardcoded values to test if Patent Center navigation works
 */
public class SimplePatentCenterTest {

    private static final String OUTPUT_DIR = "C:\\data\\uspto\\file-wrappers-test";

    // TEST DATA - from your Open Data Portal JSON
    private static final String TEST_PATENT = "10148907";
    private static final String TEST_APP_NUMBER = "15796445";  // From your JSON

    private static final String PATENT_CENTER_BASE = "https://patentcenter.uspto.gov/#!/applications/";

    public static void main(String[] args) {
        System.setProperty("webdriver.chrome.driver",
                "C:\\frame\\chromedriver-win64\\chromedriver.exe");

        System.out.println("=================================================");
        System.out.println("Simple Patent Center Test - NO CSV NEEDED");
        System.out.println("=================================================");
        System.out.println("Patent:      " + TEST_PATENT);
        System.out.println("Application: " + TEST_APP_NUMBER);
        System.out.println("=================================================\n");

        ChromeDriver driver = null;

        try {
            // Setup
            new File(OUTPUT_DIR).mkdirs();
            new File(OUTPUT_DIR + "\\screenshots").mkdirs();

            // Configure Chrome
            ChromeOptions options = new ChromeOptions();
            options.addArguments("--start-maximized");

            driver = new ChromeDriver(options);

            // Step 1: Navigate to Patent Center
            String url = PATENT_CENTER_BASE + TEST_APP_NUMBER;
            System.out.println("Step 1: Navigating to Patent Center");
            System.out.println("  URL: " + url);

            driver.get(url);
            System.out.println("  Waiting 10 seconds for page load...");
            Thread.sleep(10000);

            takeScreenshot(driver, OUTPUT_DIR + "\\screenshots\\1_application_page.png");

            String currentUrl = driver.getCurrentUrl();
            String title = driver.getTitle();

            System.out.println("  Current URL: " + currentUrl);
            System.out.println("  Page title:  " + title);

            // Check if we got to the right place
            if (currentUrl.contains(TEST_APP_NUMBER) || currentUrl.contains("applications")) {
                System.out.println("  ✓ Successfully navigated to application page\n");
            } else {
                System.err.println("  ✗ URL doesn't look right - might need login?\n");
            }

            // Step 2: Look for Documents tab
            System.out.println("Step 2: Looking for Documents tab");

            WebElement docsTab = findDocumentsTab(driver);

            if (docsTab != null) {
                System.out.println("  ✓ Found Documents tab");
                System.out.println("  Tab text: '" + docsTab.getText() + "'");

                // Step 3: Click Documents tab
                System.out.println("\nStep 3: Clicking Documents tab");

                try {
                    // Try JavaScript click (more reliable for Angular)
                    ((JavascriptExecutor) driver).executeScript("arguments[0].click();", docsTab);
                    System.out.println("  ✓ Clicked with JavaScript");
                } catch (Exception e) {
                    docsTab.click();
                    System.out.println("  ✓ Clicked normally");
                }

                System.out.println("  Waiting 10 seconds for documents to load...");
                Thread.sleep(10000);

                takeScreenshot(driver, OUTPUT_DIR + "\\screenshots\\2_documents_tab.png");

                // Step 4: Look for document table
                System.out.println("\nStep 4: Looking for document table");

                List<WebElement> rows = driver.findElements(By.cssSelector("tr"));
                System.out.println("  Found " + rows.size() + " table rows total");

                int docCount = 0;
                System.out.println("\n  Relevant documents found:");
                for (WebElement row : rows) {
                    try {
                        String text = row.getText().toUpperCase();
                        if (text.contains("PRESP") || text.contains("AMND") ||
                                text.contains("CTFR") || text.contains("CTNF") ||
                                text.contains("RESPONSE") || text.contains("OFFICE ACTION")) {
                            docCount++;
                            System.out.println("    " + docCount + ". " +
                                    text.substring(0, Math.min(100, text.length())));
                        }
                    } catch (Exception e) {
                        // Skip empty rows
                    }
                }

                if (docCount > 0) {
                    System.out.println("\n  ✓✓✓ SUCCESS! Found " + docCount + " relevant documents");
                    System.out.println("\n  Next step: Add download logic to PatentCenterDirectDownloader");
                    System.out.println("  Screenshots saved to: " + OUTPUT_DIR + "\\screenshots\\");
                } else {
                    System.err.println("\n  ✗ No relevant documents found");
                    System.err.println("  Check screenshots to see what's on the page");
                }

            } else {
                System.err.println("  ✗ Could not find Documents tab");
                System.err.println("\n  Trying to find ANY tabs/links:");

                List<WebElement> allLinks = driver.findElements(By.tagName("a"));
                for (WebElement link : allLinks) {
                    try {
                        String text = link.getText();
                        if (!text.isEmpty() && text.length() < 50) {
                            System.err.println("    - " + text);
                        }
                    } catch (Exception e) {
                        // Skip
                    }
                }
            }

            System.out.println("\n=================================================");
            System.out.println("Browser left open for inspection");
            System.out.println("Screenshots: " + OUTPUT_DIR + "\\screenshots\\");
            System.out.println("=================================================");

        } catch (Exception e) {
            System.err.println("\nERROR:");
            e.printStackTrace();
        }

        // Leave browser open for debugging
        System.out.println("\nClose browser window manually when done.");
    }

    private static WebElement findDocumentsTab(WebDriver driver) {
        // Try multiple selectors for Documents tab
        String[] selectors = {
                "//a[contains(text(), 'Documents')]",
                "//button[contains(text(), 'Documents')]",
                "//span[contains(text(), 'Documents')]",
                "//li[contains(text(), 'Documents')]",
                "a[href*='documents']",
                "button[aria-label*='Documents']",
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
                // Try next selector
            }
        }

        return null;
    }

    private static void takeScreenshot(WebDriver driver, String filepath) {
        try {
            File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
            Files.copy(screenshot.toPath(), new File(filepath).toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            System.out.println("    Screenshot saved: " + filepath);
        } catch (Exception e) {
            System.err.println("    Could not take screenshot: " + e.getMessage());
        }
    }
}
