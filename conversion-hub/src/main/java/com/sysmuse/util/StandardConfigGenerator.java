package com.sysmuse.util;

import java.util.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types.
 * Updated to use SystemConfig exclusively and proper logging.
 */
public class StandardConfigGenerator implements ConfigGenerator {

    private SystemConfig systemConfig;
    private ObjectMapper mapper;

    /**
     * Default constructor
     */
    public StandardConfigGenerator() {
        this.mapper = new ObjectMapper();
        this.systemConfig = new SystemConfig(); // Initialize with defaults
    }

    /**
     * Constructor with SystemConfig
     */
    public StandardConfigGenerator(SystemConfig systemConfig) {
        this.systemConfig = systemConfig;
        this.mapper = new ObjectMapper();
    }

    /**
     * Set system configuration
     */
    @Override
    public void setSystemConfig(SystemConfig systemConfig) {
        this.systemConfig = systemConfig;
    }

    /**
     * Generate a standard configuration based on CSV header and first data row
     */
    //@Override
    public JsonNode generateConfig_Old(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters node
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows from system config if available
        int maxImportRows = systemConfig.getMaxImportRows();
        if (maxImportRows > 0) {
            parameters.put("maxImportRows", maxImportRows);
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Add column configurations (preserving original order)
        ObjectNode columns = mapper.createObjectNode();

        // Check if a uniqueKey field is specified in system config
        String uniqueKeyField = null;

        // Auto-detect if not explicitly set
        boolean uniqueKeyFound = false;
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();
            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ?
                    columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);

            // Add format for DATE and DATETIME types
            if ("DATE".equals(type) || "DATETIME".equals(type)) {
                // Try to find the format that was used during type inference
                String format = findFormatForColumn(header, firstDataRow, headers, type);
                if (format != null) {
                    columnConfig.put("format", format);
                }
            }

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            // Check if this should be the unique key field
            if (!uniqueKeyFound &&
                    (header.toLowerCase().contains("id") ||
                            header.toLowerCase().endsWith("key") ||
                            header.toLowerCase().equals("identifier"))) {
                // Auto-detect a likely candidate for uniqueKey
                columnConfig.put("uniqueKey", true);
                uniqueKeyFound = true;
                uniqueKeyField = header;
                LoggingUtil.info("Auto-detected " + header + " as a potential uniqueKey field");
            }

            columns.set(header, columnConfig);
        }

        // If no key was detected automatically, use the first column
        if (!uniqueKeyFound && headers.length > 0) {
            String firstHeader = headers[0];
            if (firstHeader != null && !firstHeader.trim().isEmpty()) {
                ObjectNode columnConfig = columns.has(firstHeader) ?
                        (ObjectNode) columns.get(firstHeader) : mapper.createObjectNode();

                columnConfig.put("uniqueKey", true);
                columns.set(firstHeader, columnConfig);
                LoggingUtil.info("Setting first column '" + firstHeader + "' as uniqueKey since no ID field was detected");
            }
        }

        config.set("columns", columns);

        return config;
    }

    /**
     * Enhanced configuration generation with proper type inference and format detection
     */
    @Override
    public JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters node
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows from system config if available
        int maxImportRows = systemConfig.getMaxImportRows();
        if (maxImportRows > 0) {
            parameters.put("maxImportRows", maxImportRows);
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Enhanced column configuration with type inference and format detection
        ObjectNode columns = mapper.createObjectNode();

        // Create a temporary repository for type inference if needed
        ConversionRepository tempRepository = new ConversionRepository(systemConfig);
        tempRepository.setHeaders(headers);
        tempRepository.setFirstDataRow(firstDataRow);

        // Perform type inference on the sample data - this will populate column formats
        tempRepository.inferTypes(headers, firstDataRow);

        // Get the inferred types and formats
        Map<String, ConversionRepository.DataType> inferredTypes = tempRepository.getColumnTypes();
        Map<String, String> detectedFormats = tempRepository.getColumnFormats();

        // Check if a uniqueKey field is specified in system config
        String uniqueKeyField = null;
        boolean uniqueKeyFound = false;

        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();

            // Get the inferred type (this now includes proper DATE/DATETIME detection)
            ConversionRepository.DataType inferredType = inferredTypes.getOrDefault(header,
                    ConversionRepository.DataType.STRING);
            columnConfig.put("type", inferredType.toString());

            // Add format information for DATE and DATETIME types
            if ((inferredType == ConversionRepository.DataType.DATE ||
                    inferredType == ConversionRepository.DataType.DATETIME) &&
                    detectedFormats.containsKey(header)) {
                String detectedFormat = detectedFormats.get(header);
                columnConfig.put("format", detectedFormat);
                LoggingUtil.info("Detected " + inferredType + " format for column '" + header + "': " + detectedFormat);
            }

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            // Check if this should be the unique key field
            if (!uniqueKeyFound &&
                    (header.toLowerCase().contains("id") ||
                            header.toLowerCase().endsWith("key") ||
                            header.toLowerCase().equals("identifier"))) {
                // Auto-detect a likely candidate for uniqueKey
                columnConfig.put("uniqueKey", true);
                uniqueKeyFound = true;
                uniqueKeyField = header;
                LoggingUtil.info("Auto-detected " + header + " as a potential uniqueKey field");
            }

            columns.set(header, columnConfig);

            // Log the type inference result
            LoggingUtil.debug("Column '" + header + "': Type=" + inferredType +
                    (detectedFormats.containsKey(header) ? ", Format=" + detectedFormats.get(header) : ""));
        }

        // If no key was detected automatically, use the first column
        if (!uniqueKeyFound && headers.length > 0) {
            String firstHeader = headers[0];
            if (firstHeader != null && !firstHeader.trim().isEmpty()) {
                ObjectNode columnConfig = columns.has(firstHeader) ?
                        (ObjectNode) columns.get(firstHeader) : mapper.createObjectNode();

                columnConfig.put("uniqueKey", true);
                columns.set(firstHeader, columnConfig);
                LoggingUtil.info("Setting first column '" + firstHeader + "' as uniqueKey since no ID field was detected");
            }
        }

        config.set("columns", columns);

        // Log summary of type inference
        logTypeInferenceSummary(inferredTypes, detectedFormats);

        return config;
    }

    /**
     * Log a summary of type inference results
     */
    private void logTypeInferenceSummary(Map<String, ConversionRepository.DataType> inferredTypes,
                                         Map<String, String> detectedFormats) {
        LoggingUtil.info("=== Type Inference Summary ===");

        Map<ConversionRepository.DataType, Integer> typeCounts = new HashMap<>();
        for (ConversionRepository.DataType type : inferredTypes.values()) {
            typeCounts.put(type, typeCounts.getOrDefault(type, 0) + 1);
        }

        for (Map.Entry<ConversionRepository.DataType, Integer> entry : typeCounts.entrySet()) {
            LoggingUtil.info(entry.getKey() + ": " + entry.getValue() + " columns");
        }

        if (!detectedFormats.isEmpty()) {
            LoggingUtil.info("Date/DateTime formats detected:");
            for (Map.Entry<String, String> entry : detectedFormats.entrySet()) {
                LoggingUtil.info("  " + entry.getKey() + ": " + entry.getValue());
            }
        }

        LoggingUtil.info("=============================");
    }



    /**
     * Find the format that was used for a DATE or DATETIME column during type inference
     * Move these to a base class
     */
    private String findFormatForColumn(String header, String[] firstDataRow, String[] headers, String type) {
        // Find the value for this header in the first data row
        for (int i = 0; i < headers.length && i < firstDataRow.length; i++) {
            if (header.equals(headers[i])) {
                String value = firstDataRow[i];
                return findMatchingFormat(value, type);
            }
        }
        return null;
    }

    /**
     * Find the matching format for a value of the given type
     */
    private String findMatchingFormat(String value, String type) {
        if (systemConfig == null) {
            return null;
        }

        List<String> formats = "DATE".equals(type) ?
                systemConfig.getDateFormats() : systemConfig.getDateTimeFormats();

        for (String format : formats) {
            if (tryParseWithFormat(value, format, type)) {
                return format;
            }
        }
        return null;
    }

    /**
     * Try to parse a value with the given format and type
     */
    private boolean tryParseWithFormat(String value, String format, String type) {
        try {
            java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter.ofPattern(format);
            if ("DATE".equals(type)) {
                java.time.LocalDate.parse(value, formatter);
            } else {
                java.time.LocalDateTime.parse(value, formatter);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
