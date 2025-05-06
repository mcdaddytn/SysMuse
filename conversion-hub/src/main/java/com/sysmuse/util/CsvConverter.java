package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * CsvConverter - Handles importing from and exporting to CSV format.
 */
public class CsvConverter {

    private Properties properties;
    private int maxTextLength;

    /**
     * Constructor
     */
    public CsvConverter(Properties properties) {
        this.properties = properties;

        // Get maxTextLength from properties
        String maxTextLengthStr = properties.getProperty("maxTextLength", "0");
        try {
            this.maxTextLength = Integer.parseInt(maxTextLengthStr);
        } catch (NumberFormatException e) {
            this.maxTextLength = 0; // Default is no truncation
        }
    }

    /**
     * Parse only the CSV header
     */
    public String[] parseCSVHeader(String csvFilePath) throws IOException {
        BufferedReader reader = new BufferedReader(new FileReader(csvFilePath));
        String headerLine = reader.readLine();
        reader.close();

        if (headerLine == null) {
            return new String[0];
        }

        // Split the header by commas
        String[] headers = headerLine.split(",");
        // Trim whitespace and quotes
        for (int i = 0; i < headers.length; i++) {
            headers[i] = headers[i].trim();
            if (headers[i].startsWith("\"") && headers[i].endsWith("\"")) {
                headers[i] = headers[i].substring(1, headers[i].length() - 1);
            }
        }

        return headers;
    }

    /**
     * Parse only the first data row after the header
     */
    public String[] parseFirstDataRow(String csvFilePath) throws IOException {
        BufferedReader reader = new BufferedReader(new FileReader(csvFilePath));

        // Skip the header
        reader.readLine();

        // Parse the first data row
        StringBuilder firstRowBuilder = new StringBuilder();
        boolean inQuotes = false;
        char[] buffer = new char[4096]; // Buffer for reading
        int charsRead;

        while ((charsRead = reader.read(buffer)) != -1) {
            for (int i = 0; i < charsRead; i++) {
                char c = buffer[i];
                firstRowBuilder.append(c);

                if (c == '"') {
                    inQuotes = !inQuotes;
                } else if (c == '\n' && !inQuotes) {
                    // End of the first data row
                    reader.close();
                    String rowData = firstRowBuilder.toString();
                    return parseCSVRow(rowData);
                }
            }
        }

        reader.close();

        // If we reached here, there's only one row or the file is empty
        if (firstRowBuilder.length() > 0) {
            return parseCSVRow(firstRowBuilder.toString());
        }

        return null;
    }

    /**
     * Parse a CSV row considering quoted fields
     */
    private String[] parseCSVRow(String rowData) {
        List<String> values = new ArrayList<>();
        StringBuilder currentValue = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < rowData.length(); i++) {
            char c = rowData.charAt(i);

            if (c == '"') {
                inQuotes = !inQuotes;
                // Don't add the quotes to the value
                continue;
            }

            if (c == ',' && !inQuotes) {
                // End of current value
                String value = currentValue.toString().trim();
                // Apply text truncation if needed
                if (maxTextLength > 0) {
                    value = truncateText(value, maxTextLength);
                }
                values.add(value);
                currentValue = new StringBuilder();
                continue;
            }

            currentValue.append(c);
        }

        // Add the last value
        if (currentValue.length() > 0) {
            String value = currentValue.toString().trim();
            // Apply text truncation if needed
            if (maxTextLength > 0) {
                value = truncateText(value, maxTextLength);
            }
            values.add(value);
        }

        return values.toArray(new String[0]);
    }

    /**
     * Truncate text to a maximum length
     */
    private String truncateText(String text, int maxLength) {
        if (text == null || text.length() <= maxLength) {
            return text;
        }

        return text.substring(0, maxLength);
    }

    /**
     * Import data from a CSV file into the repository
     */
    public void importToRepository(String csvFilePath, ConversionRepository repository) throws IOException {
        System.out.println("Importing data from CSV file: " + csvFilePath);

        // First read the entire file
        System.out.println("Reading file: " + csvFilePath);
        String fileContent = new String(Files.readAllBytes(Paths.get(csvFilePath)));
        System.out.println("File size: " + fileContent.length() + " characters");

        // Split the content by newlines, but respect quotes
        boolean inQuotes = false;
        int rowStartIndex = 0;
        List<String> rowStrings = new ArrayList<>();

        // Skip the header
        System.out.println("Skipping header row...");
        for (int i = 0; i < fileContent.length(); i++) {
            if (fileContent.charAt(i) == '\n' && !inQuotes) {
                rowStartIndex = i + 1;
                break;
            } else if (fileContent.charAt(i) == '"') {
                inQuotes = !inQuotes;
            }
        }

        // Check if maxImportRows is set in the configuration
        Integer maxRows = null;
        Map<String, Object> configParams = repository.getConfigParameters();
        if (configParams.containsKey("maxImportRows")) {
            Object maxRowsObj = configParams.get("maxImportRows");
            if (maxRowsObj instanceof Long) {
                maxRows = ((Long) maxRowsObj).intValue();
            } else if (maxRowsObj instanceof Integer) {
                maxRows = (Integer) maxRowsObj;
            }

            if (maxRows != null) {
                System.out.println("Will import at most " + maxRows + " rows as specified in configuration");
            }
        } else {
            // Check if maxImportRows is set in properties
            String maxRowsStr = properties.getProperty("maxImportRows");
            if (maxRowsStr != null && !maxRowsStr.equals("0")) {
                try {
                    maxRows = Integer.parseInt(maxRowsStr);
                    System.out.println("Will import at most " + maxRows + " rows as specified in properties");
                } catch (NumberFormatException e) {
                    System.out.println("Invalid maxImportRows property value: " + maxRowsStr);
                }
            }
        }

        // Parse remaining rows
        int rowCount = 0;
        System.out.println("Parsing data rows...");
        for (int i = rowStartIndex; i < fileContent.length(); i++) {
            char c = fileContent.charAt(i);

            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == '\n' && !inQuotes) {
                // End of row
                String rowData = fileContent.substring(rowStartIndex, i);
                rowStrings.add(rowData);
                rowStartIndex = i + 1;

                rowCount++;
                if (rowCount % 100 == 0) {
                    System.out.println("Processed " + rowCount + " rows so far");
                }

                // Check if we've reached the maximum number of rows to import
                if (maxRows != null && rowCount >= maxRows) {
                    System.out.println("Reached maximum number of rows to import (" + maxRows + "). Stopping.");
                    break;
                }
            }
        }

        // Add the last row if there is one and we haven't reached maxRows
        if (rowStartIndex < fileContent.length() && (maxRows == null || rowCount < maxRows)) {
            String rowData = fileContent.substring(rowStartIndex);
            rowStrings.add(rowData);
            rowCount++;
        }

        System.out.println("Found " + rowCount + " data rows. Processing...");

        // Get the headers from the repository
        String[] headers = repository.getHeaders();
        
        // Parse each row string and add to repository
        int processedRows = 0;
        for (String rowString : rowStrings) {
            String[] values = parseCSVRow(rowString);
            
            // Create a map for the current row's values
            Map<String, Object> rowValues = new LinkedHashMap<>();

            // Process the direct column mappings
            for (int colIndex = 0; colIndex < headers.length && colIndex < values.length; colIndex++) {
                String columnName = headers[colIndex];

                // Skip empty column names
                if (columnName == null || columnName.trim().isEmpty()) {
                    continue;
                }

                String value = colIndex < values.length ? values[colIndex] : "";

                // Convert value based on column type
                ConversionRepository.DataType type = repository.getColumnTypes().getOrDefault(columnName, 
                                                    ConversionRepository.DataType.STRING);
                Object convertedValue = repository.convertValue(value, type);

                rowValues.put(columnName, convertedValue);
            }
            
            // Process derived boolean fields
            repository.processDerivedFields(rowValues);
            
            // Process aggregate text fields
            repository.processAggregateFields(rowValues);
            
            // Apply field suppression
            repository.applySuppression(rowValues);
            
            // Add the processed row to the repository
            repository.addDataRow(rowValues);

            processedRows++;
            if (processedRows % 100 == 0) {
                System.out.println("Processed details for " + processedRows + " rows");
            }
        }

        System.out.println("Finished importing CSV data. Total data rows: " + repository.getDataRows().size());
    }

    /**
     * Export data from the repository to a CSV file
     */
    public void exportFromRepository(ConversionRepository repository, String csvFilePath) throws IOException {
        System.out.println("Exporting data to CSV file: " + csvFilePath);
        
        // Get visible fields in order
        List<String> visibleFields = repository.getVisibleFieldNames();
        
        // Open the CSV file for writing
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(csvFilePath))) {
            // Write the header row
            writer.write(String.join(",", escapeColumns(visibleFields)));
            writer.newLine();

            // Write each data row
            List<Map<String, Object>> dataRows = repository.getDataRows();
            for (Map<String, Object> row : dataRows) {
                List<String> rowValues = new ArrayList<>();

                // Extract values in the order specified by visibleFields
                for (String field : visibleFields) {
                    Object value = row.get(field);
                    rowValues.add(escapeValue(value));
                }

                writer.write(String.join(",", rowValues));
                writer.newLine();
            }
        }

        System.out.println("Exported " + repository.getDataRows().size() + 
                          " rows to CSV file: " + csvFilePath);
    }

    /**
     * Escape a list of column names for CSV format
     */
    private List<String> escapeColumns(List<String> columns) {
        List<String> escaped = new ArrayList<>();
        for (String column : columns) {
            escaped.add(escapeValue(column));
        }
        return escaped;
    }

    /**
     * Escape a value for CSV format
     */
    private String escapeValue(Object value) {
        if (value == null) {
            return "";
        }

        String stringValue = value.toString();

        // Check if the value needs to be quoted
        boolean needsQuoting = stringValue.contains(",") ||
                stringValue.contains("\"") ||
                stringValue.contains("\n") ||
                stringValue.contains("\r");

        if (needsQuoting) {
            // Escape quotes by doubling them
            stringValue = stringValue.replace("\"", "\"\"");
            // Wrap in quotes
            return "\"" + stringValue + "\"";
        } else {
            return stringValue;
        }
    }
}
