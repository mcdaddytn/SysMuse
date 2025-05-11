package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * CsvConverter - Handles importing from and exporting to CSV format.
 * Updated to support multiple file overlay functionality and
 * exclusive subsets processing.
 */
public class CsvConverter {

    private SystemConfig systemConfig;
    private int maxTextLength;

    /**
     * Constructor with SystemConfig
     */
    public CsvConverter(SystemConfig config) {
        this.systemConfig = config;
        this.maxTextLength = config.getMaxTextLength();
    }

    /**
     * Parse only the CSV header
     */
    public String[] parseCSVHeader(String csvFilePath) throws IOException {
        LoggingUtil.debug("Parsing CSV header from: " + csvFilePath);
        BufferedReader reader = new BufferedReader(new FileReader(csvFilePath));
        String headerLine = reader.readLine();
        reader.close();

        if (headerLine == null) {
            LoggingUtil.warn("Empty CSV file: " + csvFilePath);
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

        LoggingUtil.debug("Found " + headers.length + " headers in CSV file");
        return headers;
    }

    /**
     * Parse only the first data row after the header
     */
    public String[] parseFirstDataRow(String csvFilePath) throws IOException {
        LoggingUtil.debug("Parsing first data row from: " + csvFilePath);
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
                    LoggingUtil.debug("Read first data row with " + rowData.length() + " characters");
                    return parseCSVRow(rowData);
                }
            }
        }

        reader.close();

        // If we reached here, there's only one row or the file is empty
        if (firstRowBuilder.length() > 0) {
            LoggingUtil.debug("File has only header and one data row");
            return parseCSVRow(firstRowBuilder.toString());
        }

        LoggingUtil.warn("No data rows found in CSV file");
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
        LoggingUtil.info("Importing data from CSV file: " + csvFilePath);

        // First read the entire file
        LoggingUtil.debug("Reading file: " + csvFilePath);
        String fileContent = new String(Files.readAllBytes(Paths.get(csvFilePath)));
        LoggingUtil.debug("File size: " + fileContent.length() + " characters");

        // Split the content by newlines, but respect quotes
        boolean inQuotes = false;
        int rowStartIndex = 0;
        List<String> rowStrings = new ArrayList<>();

        // Skip the header
        LoggingUtil.debug("Skipping header row...");
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
                LoggingUtil.info("Will import at most " + maxRows + " rows as specified in configuration");
            }
        } else {
            // Check if maxImportRows is set in config
            int configMaxRows = systemConfig.getMaxImportRows();
            if (configMaxRows > 0) {
                maxRows = configMaxRows;
                LoggingUtil.info("Will import at most " + maxRows + " rows as specified in system config");
            }
        }

        // Parse remaining rows
        int rowCount = 0;
        LoggingUtil.debug("Parsing data rows...");
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
                    LoggingUtil.debug("Processed " + rowCount + " rows so far");
                }

                // Check if we've reached the maximum number of rows to import
                if (maxRows != null && rowCount >= maxRows) {
                    LoggingUtil.info("Reached maximum number of rows to import (" + maxRows + "). Stopping.");
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

        LoggingUtil.info("Found " + rowCount + " data rows. Processing...");

        // Get the headers from the repository
        String[] headers = repository.getHeaders();

        // Parse each row string and add to repository
        int processedRows = 0;
        for (String rowString : rowStrings) {
            String[] values = parseCSVRow(rowString);

            // Create a map for the current row's values
            Map<String, Object> rowValues = processRow(headers, values, repository);

            // Process the direct column mappings
            /*
            Map<String, Object> rowValues = new LinkedHashMap<>();
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
            */

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
                LoggingUtil.debug("Processed details for " + processedRows + " rows");
            }
        }

        LoggingUtil.info("Finished importing CSV data. Total data rows: " + repository.getDataRows().size());
    }

    /**
     * Import data from multiple CSV files into the repository with overlay functionality
     */
    public void importMultipleFilesToRepository(String csvFilePathsInput, String inputDirectory,
                                                ConversionRepository repository) throws IOException {
        // Check if csvFilePathsInput contains multiple files (comma-separated)
        String[] filePaths;

        if (repository.getUniqueKeyField() == null) {
            // Try to get unique key from configuration or system config
            String uniqueKey = repository.getConfigParameters().containsKey("uniqueKeyField")
                    ? repository.getConfigParameters().get("uniqueKeyField").toString()
                    : null;
                    /*
            String uniqueKey = repository.getConfigParameters().containsKey("uniqueKeyField")
                    ? repository.getConfigParameters().get("uniqueKeyField").toString()
                    : systemConfig.getParameters().get("uniqueKeyField");
                     */

            if (uniqueKey != null) {
                repository.setUniqueKeyField(uniqueKey);
                LoggingUtil.info("Set unique key field to: " + uniqueKey);
            } else {
                throw new IllegalStateException("No unique key field defined for multi-file processing");
            }
        }

        if (csvFilePathsInput.contains(",")) {
            // Multiple files specified directly in the input
            filePaths = csvFilePathsInput.split(",");
            for (int i = 0; i < filePaths.length; i++) {
                filePaths[i] = filePaths[i].trim();

                // Check if path is absolute, if not prepend the input directory
                if (!new File(filePaths[i]).isAbsolute()) {
                    filePaths[i] = Paths.get(inputDirectory, filePaths[i]).toString();
                }
            }
        } else {
            // Check if it's a file containing a list of files
            File potentialListFile = new File(Paths.get(inputDirectory, csvFilePathsInput).toString());
            if (potentialListFile.exists() && potentialListFile.isFile() &&
                    potentialListFile.getName().endsWith(".list")) {

                // Read file list from the list file
                List<String> fileList = Files.readAllLines(potentialListFile.toPath());
                filePaths = new String[fileList.size()];

                for (int i = 0; i < fileList.size(); i++) {
                    String filePath = fileList.get(i).trim();
                    if (!new File(filePath).isAbsolute()) {
                        filePaths[i] = Paths.get(inputDirectory, filePath).toString();
                    } else {
                        filePaths[i] = filePath;
                    }
                }
            } else {
                // Single file, make into array for uniform processing
                filePaths = new String[1];
                filePaths[0] = Paths.get(inputDirectory, csvFilePathsInput).toString();
            }
        }

        LoggingUtil.info("Processing " + filePaths.length + " CSV files for import");

        // Get the unique key field from the repository
        String uniqueKeyField = repository.getUniqueKeyField();
        if (uniqueKeyField == null && filePaths.length > 1) {
            throw new IllegalStateException("Multiple input files specified but no uniqueKey field defined in configuration");
        }

        // Import the first file normally, but don't process derived fields yet
        if (filePaths.length > 0) {
            LoggingUtil.info("Importing base file: " + filePaths[0]);
            importToRepositoryWithoutProcessing(filePaths[0], repository);
        }

        // Process overlay files if there are more than one
        for (int i = 1; i < filePaths.length; i++) {
            LoggingUtil.info("Importing overlay file " + (i+1) + ": " + filePaths[i]);
            importOverlayFileWithoutProcessing(filePaths[i], repository, uniqueKeyField);
        }

        // Now that all data is imported, process derived fields, aggregation, and suppression
        LoggingUtil.info("Processing derived fields and transformations on complete dataset...");
        processRepositoryRows(repository);
    }

    /**
     * Import data from a CSV file into the repository without processing derived fields
     */
    private void importToRepositoryWithoutProcessing(String csvFilePath, ConversionRepository repository) throws IOException {
        LoggingUtil.info("Importing data from CSV file (without processing): " + csvFilePath);

        // First read the entire file
        LoggingUtil.debug("Reading file: " + csvFilePath);
        String fileContent = new String(Files.readAllBytes(Paths.get(csvFilePath)));
        LoggingUtil.debug("File size: " + fileContent.length() + " characters");

        // Split the content by newlines, but respect quotes
        boolean inQuotes = false;
        int rowStartIndex = 0;
        List<String> rowStrings = new ArrayList<>();

        // Skip the header
        LoggingUtil.debug("Skipping header row...");
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
                LoggingUtil.info("Will import at most " + maxRows + " rows as specified in configuration");
            }
        } else {
            // Check if maxImportRows is set in config
            int configMaxRows = systemConfig.getMaxImportRows();
            if (configMaxRows > 0) {
                maxRows = configMaxRows;
                LoggingUtil.info("Will import at most " + maxRows + " rows as specified in system config");
            }
        }

        // Parse remaining rows
        int rowCount = 0;
        LoggingUtil.debug("Parsing data rows...");
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
                    LoggingUtil.debug("Processed " + rowCount + " rows so far");
                }

                // Check if we've reached the maximum number of rows to import
                if (maxRows != null && rowCount >= maxRows) {
                    LoggingUtil.info("Reached maximum number of rows to import (" + maxRows + "). Stopping.");
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

        LoggingUtil.info("Found " + rowCount + " data rows. Processing...");

        // Get the headers from the repository
        String[] headers = repository.getHeaders();

        // Parse each row string and add to repository
        int processedRows = 0;
        for (String rowString : rowStrings) {
            String[] values = parseCSVRow(rowString);
            Map<String, Object> rowValues = processRow(headers, values, repository);

/*
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
 */

            // Add the processed row to the repository without processing derived fields
            repository.addDataRow(rowValues);

            processedRows++;
            if (processedRows % 100 == 0) {
                LoggingUtil.debug("Processed details for " + processedRows + " rows");
            }
        }

        LoggingUtil.info("Finished importing CSV data. Total data rows: " + repository.getDataRows().size());
    }

    private Map<String, Object> processRow(String[] headers, String[] values, ConversionRepository repository) {
        Map<String, Object> rowValues = new LinkedHashMap<>();
        for (int colIndex = 0; colIndex < headers.length && colIndex < values.length; colIndex++) {
            String columnName = headers[colIndex];

            // Skip empty column names
            if (columnName == null || columnName.trim().isEmpty()) {
                continue;
            }

            String value = colIndex < values.length ? values[colIndex] : "";

            // Get the data type from repository
            ConversionRepository.DataType type = repository.getColumnTypes().getOrDefault(
                    columnName, ConversionRepository.DataType.STRING);

            // Convert value based on column type - ensure proper conversion to the right type
            Object convertedValue = null;
            switch (type) {
                case INTEGER:
                    try {
                        convertedValue = Integer.parseInt(value.trim());
                    } catch (NumberFormatException e) {
                        LoggingUtil.debug("Could not convert '" + value + "' to INTEGER for field '" +
                                columnName + "', defaulting to 0");
                        convertedValue = 0;
                    }
                    break;
                case FLOAT:
                    try {
                        convertedValue = Double.parseDouble(value.trim());
                    } catch (NumberFormatException e) {
                        LoggingUtil.debug("Could not convert '" + value + "' to FLOAT for field '" +
                                columnName + "', defaulting to 0.0");
                        convertedValue = 0.0;
                    }
                    break;
                case BOOLEAN:
                    convertedValue = Boolean.parseBoolean(value.trim());
                    break;
                case STRING:
                default:
                    // Apply text truncation if needed
                    if (maxTextLength > 0) {
                        convertedValue = truncateText(value, maxTextLength);
                    } else {
                        convertedValue = value;
                    }
            }
            rowValues.put(columnName, convertedValue);
        }
        return rowValues;
    }

    /**
     * Import an overlay file and merge with existing repository data based on the unique key,
     * without processing derived fields
     */
    private void importOverlayFileWithoutProcessing(String overlayFilePath, ConversionRepository repository,
                                                    String uniqueKeyField) throws IOException {
        LoggingUtil.info("Importing overlay file (without processing): " + overlayFilePath);

        // Read file content
        String fileContent = new String(Files.readAllBytes(Paths.get(overlayFilePath)));

        // Parse the header to identify column mapping
        String[] overlayHeaders = parseCSVHeader(overlayFilePath);

        // Create a map to quickly find column indices
        Map<String, Integer> overlayColumnMap = new HashMap<>();
        for (int i = 0; i < overlayHeaders.length; i++) {
            if (overlayHeaders[i] != null && !overlayHeaders[i].trim().isEmpty()) {
                overlayColumnMap.put(overlayHeaders[i], i);
            }
        }

        // Check if the unique key field exists in the overlay file
        if (!overlayColumnMap.containsKey(uniqueKeyField)) {
            throw new IllegalStateException("Unique key field '" + uniqueKeyField +
                    "' not found in overlay file: " + overlayFilePath);
        }

        // Parse rest of the file into rows, similar to importToRepository method
        boolean inQuotes = false;
        int rowStartIndex = 0;
        List<String> rowStrings = new ArrayList<>();

        // Skip the header row
        for (int i = 0; i < fileContent.length(); i++) {
            if (fileContent.charAt(i) == '\n' && !inQuotes) {
                rowStartIndex = i + 1;
                break;
            } else if (fileContent.charAt(i) == '"') {
                inQuotes = !inQuotes;
            }
        }

        // Parse remaining rows
        for (int i = rowStartIndex; i < fileContent.length(); i++) {
            char c = fileContent.charAt(i);

            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == '\n' && !inQuotes) {
                // End of row
                String rowData = fileContent.substring(rowStartIndex, i);
                rowStrings.add(rowData);
                rowStartIndex = i + 1;
            }
        }

        // Add the last row if there is one
        if (rowStartIndex < fileContent.length()) {
            String rowData = fileContent.substring(rowStartIndex);
            rowStrings.add(rowData);
        }

        // Get config parameters for type conversion
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();
        List<String> configFieldNames = repository.getAllFieldNames();

        // Get the list of existing rows from the repository
        List<Map<String, Object>> existingRows = repository.getDataRows();

        // Create a map for quick lookups by unique key
        Map<Object, Map<String, Object>> keyToRowMap = new HashMap<>();
        for (Map<String, Object> existingRow : existingRows) {
            if (existingRow.containsKey(uniqueKeyField)) {
                Object keyValue = existingRow.get(uniqueKeyField);
                if (keyValue != null) {
                    keyToRowMap.put(keyValue, existingRow);
                }
            }
        }

        // Process each overlay row
        int updatedCount = 0;
        for (String rowString : rowStrings) {
            String[] values = parseCSVRow(rowString);

            // Get the unique key value from this row
            int keyIndex = overlayColumnMap.get(uniqueKeyField);
            if (keyIndex >= values.length) {
                continue; // Skip rows where the key index is out of bounds
            }

            String keyValue = keyIndex < values.length ? values[keyIndex] : "";
            if (keyValue.isEmpty()) {
                continue; // Skip rows with empty key values
            }

            // Convert key value to appropriate type
            ConversionRepository.DataType keyType = columnTypes.getOrDefault(uniqueKeyField,
                    ConversionRepository.DataType.STRING);
            Object convertedKeyValue = repository.convertValue(keyValue, keyType);

            // Find existing row with this key
            Map<String, Object> existingRow = keyToRowMap.get(convertedKeyValue);
            if (existingRow == null) {
                // No matching row found, skip this overlay row
                continue;
            }

            // Update the existing row with values from the overlay row
            for (String fieldName : overlayColumnMap.keySet()) {
                int columnIndex = overlayColumnMap.get(fieldName);
                if (columnIndex < values.length) {
                    String value = values[columnIndex];
                    if (value != null && !value.isEmpty()) {
                        // Convert value based on column type
                        ConversionRepository.DataType type = columnTypes.getOrDefault(fieldName,
                                ConversionRepository.DataType.STRING);
                        Object convertedValue = repository.convertValue(value, type);

                        // Update the existing row with the new value
                        existingRow.put(fieldName, convertedValue);
                    }
                }
            }

            updatedCount++;
        }

        LoggingUtil.info("Updated " + updatedCount + " rows from overlay file");
    }

    /**
     * Process all rows in the repository to apply derived fields and transformations
     */
    public void processRepositoryRows(ConversionRepository repository) {
        List<Map<String, Object>> rows = repository.getDataRows();

        LoggingUtil.info("Processing derived fields, aggregation, and suppression for " + rows.size() + " rows");
        int processedCount = 0;

        for (Map<String, Object> row : rows) {
            // Apply derived boolean fields
            repository.processDerivedFields(row);

            // Apply aggregate text fields
            repository.processAggregateFields(row);

            // Apply field suppression
            repository.applySuppression(row);

            processedCount++;
            if (processedCount % 100 == 0) {
                LoggingUtil.debug("Processed transformations for " + processedCount + " rows");
            }
        }

        LoggingUtil.info("Completed processing of transformations for all rows");
    }

    /**
     * Export data from the repository to a CSV file
     */
    public void exportFromRepository(ConversionRepository repository, String csvFilePath) throws IOException {
        LoggingUtil.info("Exporting data to CSV file: " + csvFilePath);

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

        LoggingUtil.info("Exported " + repository.getDataRows().size() +
                " rows to CSV file: " + csvFilePath);
    }

    /**
     * Export filtered subsets of data from the repository to multiple CSV files
     * using the SubsetProcessor to handle subset filtering and configuration
     */
    public void exportSubsetsFromRepository(ConversionRepository repository, String baseCsvFilePath) throws IOException {
        // Create the subset processor
        SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);

        if (!subsetProcessor.hasSubsets()) {
            System.out.println("No subsets configured for export.");
            return;
        }

        System.out.println("Exporting filtered subsets to CSV files");

        // For tracking unfiltered records
        Set<Map<String, Object>> unfilteredRows = new HashSet<>(repository.getDataRows());
        // For tracking exported keys (for exclusive subsets)
        Set<String> exportedKeys = new HashSet<>();

        // Get visible fields in order
        List<String> visibleFields;
        try {
            visibleFields = repository.getVisibleFieldNames();
        } catch (NullPointerException e) {
            System.out.println("Warning: Unable to get visible field names. Using all fields from first row.");
            // Fallback to the fields from the first data row if available
            visibleFields = new ArrayList<>();
            if (!repository.getDataRows().isEmpty()) {
                visibleFields.addAll(repository.getDataRows().get(0).keySet());
            }
        }

        // Check if we have fields to export
        if (visibleFields.isEmpty()) {
            System.out.println("No fields to export. Checking if data rows exist to extract field names.");
            if (!repository.getDataRows().isEmpty()) {
                visibleFields.addAll(repository.getDataRows().get(0).keySet());
            } else {
                System.out.println("Error: No data to export and no field names available.");
                return;
            }
        }

        // Process each filter
        Map<String, String> filterToSuffix = subsetProcessor.getFilterToSuffix();
        for (Map.Entry<String, String> entry : filterToSuffix.entrySet()) {
            String filterField = entry.getKey();
            String suffix = entry.getValue();

            // Enhanced debug about filter field existence
            int rowsWithField = 0;
            int rowsWithTrueValue = 0;
            boolean filterExists = false;

            for (Map<String, Object> row : repository.getDataRows()) {
                if (row.containsKey(filterField)) {
                    filterExists = true;
                    rowsWithField++;

                    // Check if this field would evaluate to true
                    if (subsetProcessor.rowMatchesFilter(row, filterField)) {
                        rowsWithTrueValue++;
                    }
                }
            }

            if (!filterExists) {
                System.out.println("Warning: Filter field '" + filterField + "' not found in repository, skipping subset");
                continue;
            }

            System.out.println("Debug: Filter field '" + filterField + "' exists in " + rowsWithField +
                    " rows out of " + repository.getDataRows().size() +
                    ". " + rowsWithTrueValue + " rows have 'true' values.");

            // Create output file path with suffix
            String outputPath = subsetProcessor.getOutputPathWithSuffix(baseCsvFilePath, suffix, ".csv");

            System.out.println("Exporting subset for filter '" + filterField + "' to: " + outputPath);

            // Open the CSV file for writing
            try (BufferedWriter writer = new BufferedWriter(new FileWriter(outputPath))) {
                // Write the header row
                writer.write(String.join(",", escapeColumns(visibleFields)));
                writer.newLine();

                int matchCount = 0;

                // Filter rows based on the filter field
                for (Map<String, Object> row : repository.getDataRows()) {
                    boolean matches = subsetProcessor.rowMatchesFilter(row, filterField);
                    boolean keyAlreadyExported = subsetProcessor.isRowKeyInExportedSet(row, exportedKeys);

                    if (matches && !keyAlreadyExported) {
                        List<String> rowValues = new ArrayList<>();

                        // Extract values in the order specified by visibleFields
                        for (String field : visibleFields) {
                            Object value = row.get(field);
                            rowValues.add(escapeValue(value));
                        }

                        writer.write(String.join(",", rowValues));
                        writer.newLine();
                        matchCount++;

                        // Remove from unfiltered set
                        unfilteredRows.remove(row);
                        // Add to exported keys set if exclusive subsets are enabled
                        subsetProcessor.addRowKeyToExportedSet(row, exportedKeys);
                    }
                }

                System.out.println("Exported " + matchCount + " rows to subset file: " + outputPath);
            }
        }

        // If we need to output remaining unfiltered rows
        if (!unfilteredRows.isEmpty()) {
            String defaultSuffix = systemConfig.getOutputSuffix();
            String unfilteredPath = subsetProcessor.getOutputPathWithSuffix(baseCsvFilePath, defaultSuffix, ".csv");

            System.out.println("Exporting " + unfilteredRows.size() + " unfiltered rows to: " + unfilteredPath);

            // Open the CSV file for writing
            try (BufferedWriter writer = new BufferedWriter(new FileWriter(unfilteredPath))) {
                // Write the header row
                writer.write(String.join(",", escapeColumns(visibleFields)));
                writer.newLine();

                // Write each unfiltered row
                for (Map<String, Object> row : unfilteredRows) {
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
        }
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
