package com.sysmuse.bulk;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Downloads USPTO Patent Grant Bulk Data XML files
 * Patent grants are published every Tuesday
 * URL pattern: https://bulkdata.uspto.gov/data/patent/grant/redbook/fulltext/{YEAR}/ipg{YYMMDD}.zip
 */
public class USPTOBulkDownloader {

    private static final String BASE_URL = "https://bulkdata.uspto.gov/data/patent/grant/redbook/fulltext";
    //private static final String OUTPUT_DIR = "./uspto-bulk-data"; // Customize this path
    private static final String OUTPUT_DIR = "F:\\data\\uspto\\bulkdata"; // Customize this path

    public static void main(String[] args) {
        // Example: Download all patent grants from Jan 1, 2023 to Dec 31, 2023
        //downloadPatentGrantsByDateRange("2023-01-01", "2023-12-31");
        downloadPatentGrantsByDateRange("2023-12-01", "2023-12-31");

        // Example: Download specific year
        // downloadPatentGrantsForYear(2023);

        // Example: Download last 6 months
        // downloadRecentPatentGrants(6);
    }

    /**
     * Download patent grants for a date range
     * @param startDate Format: YYYY-MM-DD
     * @param endDate Format: YYYY-MM-DD
     */
    public static void downloadPatentGrantsByDateRange(String startDate, String endDate) {
        LocalDate start = LocalDate.parse(startDate);
        LocalDate end = LocalDate.parse(endDate);

        System.out.println("=================================================");
        System.out.println("USPTO Patent Grant Bulk Downloader");
        System.out.println("=================================================");
        System.out.println("Date Range: " + startDate + " to " + endDate);
        System.out.println("Output Directory: " + OUTPUT_DIR);
        System.out.println("=================================================\n");

        // Create output directory
        new File(OUTPUT_DIR).mkdirs();

        // Get all Tuesdays in the range (patents are published on Tuesdays)
        List<LocalDate> tuesdays = getTuesdaysInRange(start, end);

        System.out.println("Found " + tuesdays.size() + " publication dates (Tuesdays) in range\n");

        int successCount = 0;
        int skipCount = 0;
        int errorCount = 0;

        for (int i = 0; i < tuesdays.size(); i++) {
            LocalDate tuesday = tuesdays.get(i);

            try {
                System.out.printf("[%d/%d] Processing %s...\n", i + 1, tuesdays.size(), tuesday);

                DownloadResult result = downloadPatentGrantForDate(tuesday);

                switch (result) {
                    case SUCCESS:
                        successCount++;
                        break;
                    case ALREADY_EXISTS:
                        skipCount++;
                        break;
                    case ERROR:
                        errorCount++;
                        break;
                }

            } catch (Exception e) {
                System.err.println("  ERROR: " + e.getMessage());
                errorCount++;
            }
        }

        System.out.println("\n=================================================");
        System.out.println("Download Summary:");
        System.out.println("  Downloaded: " + successCount);
        System.out.println("  Skipped (already exists): " + skipCount);
        System.out.println("  Errors: " + errorCount);
        System.out.println("  Total: " + tuesdays.size());
        System.out.println("=================================================");
    }

    /**
     * Download all patent grants for a specific year
     */
    public static void downloadPatentGrantsForYear(int year) {
        String startDate = year + "-01-01";
        String endDate = year + "-12-31";
        downloadPatentGrantsByDateRange(startDate, endDate);
    }

    /**
     * Download patent grants for the last N months
     */
    public static void downloadRecentPatentGrants(int months) {
        LocalDate end = LocalDate.now();
        LocalDate start = end.minusMonths(months);

        downloadPatentGrantsByDateRange(
                start.format(DateTimeFormatter.ISO_LOCAL_DATE),
                end.format(DateTimeFormatter.ISO_LOCAL_DATE)
        );
    }

    /**
     * Download patent grant file for a specific date
     */
    private static DownloadResult downloadPatentGrantForDate(LocalDate date) {
        int year = date.getYear();
        String filename = generateFilename(date);
        String url = String.format("%s/%d/%s", BASE_URL, year, filename);
        String outputPath = OUTPUT_DIR + File.separator + filename;

        // Check if file already exists
        File outputFile = new File(outputPath);
        if (outputFile.exists()) {
            System.out.println("  SKIPPED: File already exists - " + filename);
            return DownloadResult.ALREADY_EXISTS;
        }

        try {
            // Check if file exists on server (404 means no patents published that week)
            if (!urlExists(url)) {
                System.out.println("  SKIPPED: No file published for this date - " + filename);
                return DownloadResult.ALREADY_EXISTS;
            }

            // Download the file
            downloadFile(url, outputPath);

            long fileSize = outputFile.length();
            String fileSizeMB = String.format("%.2f MB", fileSize / (1024.0 * 1024.0));
            System.out.println("  SUCCESS: Downloaded " + filename + " (" + fileSizeMB + ")");

            return DownloadResult.SUCCESS;

        } catch (IOException e) {
            System.err.println("  ERROR downloading " + filename + ": " + e.getMessage());
            // Delete partial file if it exists
            if (outputFile.exists()) {
                outputFile.delete();
            }
            return DownloadResult.ERROR;
        }
    }

    /**
     * Generate filename based on date
     * Format: ipg{YY}{MM}{DD}.zip for 2005+
     * Format: pg{YY}{MM}{DD}.zip for 2002-2004
     */
    private static String generateFilename(LocalDate date) {
        String yy = String.format("%02d", date.getYear() % 100);
        String mm = String.format("%02d", date.getMonthValue());
        String dd = String.format("%02d", date.getDayOfMonth());

        // Different naming convention based on year
        if (date.getYear() >= 2005) {
            return "ipg" + yy + mm + dd + ".zip";
        } else if (date.getYear() >= 2002) {
            return "pg" + yy + mm + dd + ".zip";
        } else {
            // For 1976-2001, the format is different (APS text format)
            // You would need to handle this separately if needed
            throw new IllegalArgumentException("Pre-2002 downloads not supported in this version");
        }
    }

    /**
     * Get all Tuesdays within a date range (patents are published on Tuesdays)
     */
    private static List<LocalDate> getTuesdaysInRange(LocalDate start, LocalDate end) {
        List<LocalDate> tuesdays = new ArrayList<>();

        // Find the first Tuesday on or after start date
        LocalDate current = start;
        while (current.getDayOfWeek() != DayOfWeek.TUESDAY) {
            current = current.plusDays(1);
        }

        // Collect all Tuesdays until end date
        while (!current.isAfter(end)) {
            tuesdays.add(current);
            current = current.plusDays(7); // Next Tuesday
        }

        return tuesdays;
    }

    /**
     * Check if URL exists (returns 200 OK)
     */
    private static boolean urlExists(String urlString) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("HEAD");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);

            int responseCode = connection.getResponseCode();
            return responseCode == HttpURLConnection.HTTP_OK;

        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /**
     * Download file from URL with progress indicator
     */
    private static void downloadFile(String fileUrl, String outputPath) throws IOException {
        URL url = new URL(fileUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(30000);

        long fileSize = connection.getContentLengthLong();

        try (BufferedInputStream in = new BufferedInputStream(connection.getInputStream());
             FileOutputStream fileOutputStream = new FileOutputStream(outputPath)) {

            byte[] dataBuffer = new byte[8192]; // Larger buffer for better performance
            int bytesRead;
            long totalBytesRead = 0;
            long lastProgressUpdate = 0;

            while ((bytesRead = in.read(dataBuffer, 0, dataBuffer.length)) != -1) {
                fileOutputStream.write(dataBuffer, 0, bytesRead);
                totalBytesRead += bytesRead;

                // Update progress every 5MB
                if (fileSize > 0 && totalBytesRead - lastProgressUpdate > 5 * 1024 * 1024) {
                    int progress = (int) ((totalBytesRead * 100) / fileSize);
                    System.out.printf("  Progress: %d%% (%.2f MB / %.2f MB)\n",
                            progress,
                            totalBytesRead / (1024.0 * 1024.0),
                            fileSize / (1024.0 * 1024.0));
                    lastProgressUpdate = totalBytesRead;
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    /**
     * Download result enum
     */
    private enum DownloadResult {
        SUCCESS,
        ALREADY_EXISTS,
        ERROR
    }
}