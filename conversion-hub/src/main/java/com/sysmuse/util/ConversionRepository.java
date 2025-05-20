package com.sysmuse.util;

import java.util.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * ConversionRepository - Core data storage class that maintains data in memory
 * with type information and configuration settings.
 * Updated to support unique key field for multi-file overlay functionality.
 */
public class ConversionRepository {

    // Supported data types
    public enum DataType {
        STRING, INTEGER, FLOAT, BOOLEAN, DATE, DATETIME
    }

    // Core data storage
    private List<Map<String, Object>> dataRows = new ArrayList<>();

    // Original column headers in order
    private String[] headers;

    // Map of column names to their indices (preserving order)
    private LinkedHashMap<String, Integer> columnMap = new LinkedHashMap<>();

    // Map of column names to their data types (from config or inferred)
    private Map<String, DataType> columnTypes = new HashMap<>();

    // Map of column names to their date/datetime formats
    private Map<String, String> columnFormats = new HashMap<>();

    // Map for derived boolean fields (name -> expression)
    private Map<String, JsonNode> derivedBooleanFields = new LinkedHashMap<>();

    // Map for text aggregation fields (name -> configuration)
    private Map<String, JsonNode> aggregateTextFields = new LinkedHashMap<>();

    // Map for conditional text suppression (field to suppress -> condition field)
    private Map<String, String> suppressedFields = new LinkedHashMap<>();

    // Map of column names to their visibility settings
    private Map<String, Boolean> columnVisibility = new HashMap<>();

    // Configuration parameters
    private Map<String, Object> configParameters = new HashMap<>();

    // Store the first data row for reuse
    private String[] firstDataRow;

    // Maximum text length (0 for unlimited)
    private int maxTextLength = 0;

    // Helper variable to track current column during inference
    private String currentColumnName = null;

    // Unique key field for multi-file overlay
    private String uniqueKeyField = null;

    // Configuration instance
    private SystemConfig systemConfig;

    // Map for derived text fields (name -> configuration)
    private Map<String, JsonNode> derivedTextFields = new LinkedHashMap<>();


    /**
     * Constructor
     */
    public ConversionRepository() {
        this.systemConfig = new SystemConfig();
    }

    /**
     * Constructor with SystemConfig
     */
    public ConversionRepository(SystemConfig config) {
        this.systemConfig = config;
        this.maxTextLength = config.getMaxTextLength();
    }

    /**
     * Set the headers array and create the column map
     */
    public void setHeaders(String[] headers) {
        this.headers = headers;

        // Create column map (name to index)
        for (int i = 0; i < headers.length; i++) {
            if (headers[i] != null && !headers[i].trim().isEmpty()) {
                columnMap.put(headers[i], i);
            }
        }
        LoggingUtil.info("Column map created with " + columnMap.size() + " entries");
    }

    /**
     * Get column formats map
     */
    public Map<String, String> getColumnFormats() {
        return columnFormats;
    }

    /**
     * Get the headers array
     */
    public String[] getHeaders() {
        return headers;
    }

    private String getCurrentColumnName() {
        return currentColumnName;
    }

    /**
     * Store first data row
     */
    public void setFirstDataRow(String[] firstDataRow) {
        this.firstDataRow = firstDataRow;
    }

    /**
     * Get first data row
     */
    public String[] getFirstDataRow() {
        return firstDataRow;
    }

    /**
     * Get the column map
     */
    public Map<String, Integer> getColumnMap() {
        return columnMap;
    }

    /**
     * Add a data row to the repository
     */
    public void addDataRow(Map<String, Object> row) {
        dataRows.add(row);
    }

    /**
     * Get all data rows
     */
    public List<Map<String, Object>> getDataRows() {
        return dataRows;
    }

    /**
     * Set maximum text length
     */
    public void setMaxTextLength(int maxLength) {
        this.maxTextLength = maxLength;
    }

    /**
     * Get maximum text length
     */
    public int getMaxTextLength() {
        return maxTextLength;
    }

    /**
     * Get column types
     */
    public Map<String, DataType> getColumnTypes() {
        return columnTypes;
    }

    /**
     * Get derived boolean fields
     */
    public Map<String, JsonNode> getDerivedBooleanFields() {
        return derivedBooleanFields;
    }

    /**
     * Get aggregate text fields
     */
    public Map<String, JsonNode> getAggregateTextFields() {
        return aggregateTextFields;
    }

    /**
     * Get suppressed fields
     */
    public Map<String, String> getSuppressedFields() {
        return suppressedFields;
    }

    /**
     * Get column visibility
     */
    public Map<String, Boolean> getColumnVisibility() {
        return columnVisibility;
    }

    /**
     * Get configuration parameters
     */
    public Map<String, Object> getConfigParameters() {
        return configParameters;
    }

    /**
     * Get the unique key field
     */
    public String getUniqueKeyField() {
        return uniqueKeyField;
    }

    /**
     * Set the unique key field
     */
    public void setUniqueKeyField(String uniqueKeyField) {
        this.uniqueKeyField = uniqueKeyField;
    }

    /**
     * Get SystemConfig instance
     */
    public SystemConfig getSystemConfig() {
        return systemConfig;
    }

    /**
     * Set SystemConfig instance
     */
    public void setSystemConfig(SystemConfig config) {
        this.systemConfig = config;
        this.maxTextLength = config.getMaxTextLength();
    }

    /**
     * Enhanced type inference that properly detects DATE and DATETIME with format discovery
     */
    public void inferTypes(String[] headers, String[] firstDataRow) {
        LoggingUtil.info("Performing enhanced type inference on " + headers.length + " columns");

        for (int i = 0; i < headers.length && i < firstDataRow.length; i++) {
            String value = firstDataRow[i];
            String columnName = headers[i];

            // Skip empty column names
            if (columnName == null || columnName.trim().isEmpty()) {
                continue;
            }

            // Set current column for format detection
            this.currentColumnName = columnName;

            // Perform comprehensive type inference
            DataType detectedType = inferTypeFromValue(value);
            columnTypes.put(columnName, detectedType);

            LoggingUtil.debug("Column '" + columnName + "' inferred as " + detectedType +
                    (value != null ? " (sample: '" + value + "')" : " (null sample)"));
        }

        LoggingUtil.info("Type inference complete. Detected types: " + getTypeSummary());
    }

    /**
     * Comprehensive type inference with prioritized detection order
     */
    private DataType inferTypeFromValue(String value) {
        if (value == null || value.trim().isEmpty()) {
            LoggingUtil.debug("Empty value, defaulting to STRING for column: " + getCurrentColumnName());
            return DataType.STRING;
        }

        value = value.trim();

        // gm, removed 0, 1 passing as boolean, that should be INTEGER, or need to change order
        // 1. Check for boolean first (most specific)
        if (isBooleanValue(value)) {
            LoggingUtil.debug("Detected BOOLEAN for column '" + getCurrentColumnName() + "': " + value);
            return DataType.BOOLEAN;
        }

        // 2. Try DATETIME formats first (more specific than DATE)
        if (systemConfig != null) {
            List<String> dateTimeFormats = systemConfig.getDateTimeFormats();
            for (String format : dateTimeFormats) {
                if (tryParseDateTime(value, format)) {
                    columnFormats.put(getCurrentColumnName(), format);
                    LoggingUtil.info("Detected DATETIME for column '" + getCurrentColumnName() +
                            "' with format '" + format + "': " + value);
                    return DataType.DATETIME;
                }
            }

            // 3. Try DATE formats
            List<String> dateFormats = systemConfig.getDateFormats();
            for (String format : dateFormats) {
                if (tryParseDate(value, format)) {
                    columnFormats.put(getCurrentColumnName(), format);
                    LoggingUtil.info("Detected DATE for column '" + getCurrentColumnName() +
                            "' with format '" + format + "': " + value);
                    return DataType.DATE;
                }
            }
        }

        // 4. Check for numeric types
        // Try INTEGER first (more specific than FLOAT)
        if (isIntegerValue(value)) {
            LoggingUtil.debug("Detected INTEGER for column '" + getCurrentColumnName() + "': " + value);
            return DataType.INTEGER;
        }

        // Try FLOAT
        if (isFloatValue(value)) {
            LoggingUtil.debug("Detected FLOAT for column '" + getCurrentColumnName() + "': " + value);
            return DataType.FLOAT;
        }

        // 5. Default to STRING
        LoggingUtil.debug("Defaulting to STRING for column '" + getCurrentColumnName() + "': " + value);
        return DataType.STRING;
    }

    /**
     * Check if value represents a boolean
     */
    private boolean isBooleanValue(String value) {
        if (value == null) return false;
        String lowerValue = value.toLowerCase().trim();
        return lowerValue.equals("true") || lowerValue.equals("false");
/*
        return lowerValue.equals("true") || lowerValue.equals("false") ||
                lowerValue.equals("yes") || lowerValue.equals("no") ||
                lowerValue.equals("1") || lowerValue.equals("0") ||
                lowerValue.equals("y") || lowerValue.equals("n");
 */
    }

    /**
     * Check if value represents an integer
     */
    private boolean isIntegerValue(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            // Also handle values with commas (e.g., "1,000")
            String cleanValue = value.replace(",", "");
            Long.parseLong(cleanValue);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * Check if value represents a float/double
     */
    private boolean isFloatValue(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            // Also handle values with commas (e.g., "1,000.50")
            String cleanValue = value.replace(",", "");
            Double.parseDouble(cleanValue);
            // Make sure it's actually a decimal number, not just an integer
            return cleanValue.contains(".") || cleanValue.toLowerCase().contains("e");
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * Get a summary of detected types for logging
     */
    private String getTypeSummary() {
        Map<DataType, Integer> counts = new HashMap<>();
        for (DataType type : columnTypes.values()) {
            counts.put(type, counts.getOrDefault(type, 0) + 1);
        }

        StringBuilder summary = new StringBuilder();
        for (Map.Entry<DataType, Integer> entry : counts.entrySet()) {
            if (summary.length() > 0) summary.append(", ");
            summary.append(entry.getKey()).append(":").append(entry.getValue());
        }
        return summary.toString();
    }

    /**
     * Try to parse a value as a DateTime with the given format
     */
    private boolean tryParseDateTime(String value, String format) {
        try {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
            LocalDateTime.parse(value, formatter);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    /**
     * Try to parse a value as a Date with the given format
     */
    private boolean tryParseDate(String value, String format) {
        try {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
            LocalDate.parse(value, formatter);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    /**
     * Convert a string value to the appropriate type (backward compatibility)
     */
    public Object convertValue(String value, DataType type) {
        return convertValue(value, type, null);
    }

    /**
     * Convert value to Date using configured format for specific column
     */
    private Object convertToDate(String value, String columnName) {
        // First try to get the specific format for this column
        String format = columnFormats.get(columnName);

        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return LocalDate.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse date '" + value + "' with configured format '" + format + "' for column '" + columnName + "'");
            }
        }

        // If no specific format or parsing failed, try all configured DATE formats
        String foundFormat = findFormatForColumn(DataType.DATE, value);
        if (foundFormat != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(foundFormat);
                return LocalDate.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse date '" + value + "' with format '" + foundFormat + "'");
            }
        }

        // If parsing fails, return as string
        return value;
    }

    /**
     * Convert value to DateTime using configured format for specific column
     */
    private Object convertToDateTime(String value, String columnName) {
        // First try to get the specific format for this column
        String format = columnFormats.get(columnName);

        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return LocalDateTime.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse datetime '" + value + "' with configured format '" + format + "' for column '" + columnName + "'");
            }
        }

        // If no specific format or parsing failed, try all configured DATETIME formats
        String foundFormat = findFormatForColumn(DataType.DATETIME, value);
        if (foundFormat != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(foundFormat);
                return LocalDateTime.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse datetime '" + value + "' with format '" + foundFormat + "'");
            }
        }

        // If parsing fails, return as string
        return value;
    }

    /**
     * Convert a string value to the appropriate type with column context
     */
    public Object convertValue(String value, DataType type, String columnName) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }

        value = value.trim();

        switch (type) {
            case INTEGER:
                try {
                    return Integer.parseInt(value);
                } catch (NumberFormatException e) {
                    return 0; // Default value for parsing error
                }
            case FLOAT:
                try {
                    return Double.parseDouble(value);
                } catch (NumberFormatException e) {
                    return 0.0; // Default value for parsing error
                }
            case BOOLEAN:
                return Boolean.parseBoolean(value);
            case DATE:
                return convertToDate(value, columnName);
            case DATETIME:
                return convertToDateTime(value, columnName);
            case STRING:
            default:
                // Apply text truncation if needed
                if (maxTextLength > 0) {
                    return truncateText(value, maxTextLength);
                }
                return value;
        }
    }

    /**
     * Find the appropriate format for a column of the given type
     */
    private String findFormatForColumn(DataType type, String value) {
        // First, check if we have a stored format for a specific column
        // This requires knowing which column we're processing
        // For now, try all configured formats

        if (systemConfig == null) {
            return null;
        }

        List<String> formats = type == DataType.DATE ?
                systemConfig.getDateFormats() : systemConfig.getDateTimeFormats();

        for (String format : formats) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                if (type == DataType.DATE) {
                    LocalDate.parse(value, formatter);
                } else {
                    LocalDateTime.parse(value, formatter);
                }
                return format;
            } catch (DateTimeParseException e) {
                // Try next format
            }
        }
        return null;
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

    public void extractConfigFromJSON(JsonNode config) {
        // Logging setup
        LoggingUtil.info("Starting comprehensive configuration extraction");

        // Clear existing configurations to prevent duplicate entries
        configParameters.clear();
        derivedBooleanFields.clear();
        aggregateTextFields.clear();
        suppressedFields.clear();
        columnVisibility.clear();
        columnTypes.clear();
        uniqueKeyField = null;
        derivedTextFields.clear();

        // 1. Parameters Extraction
        if (config.has("parameters")) {
            JsonNode params = config.get("parameters");
            Iterator<String> paramNames = params.fieldNames();

            LoggingUtil.info("Processing configuration parameters");
            while (paramNames.hasNext()) {
                String paramName = paramNames.next();
                JsonNode paramValue = params.get(paramName);

                // Special handling for unique key field
                if (paramName.equals("uniqueKeyField")) {
                    uniqueKeyField = paramValue.asText();
                    LoggingUtil.debug("Set unique key field: " + uniqueKeyField);
                }

                // Generic parameter parsing
                Object processedValue = processParameterValue(paramValue);
                if (processedValue != null) {
                    configParameters.put(paramName, processedValue);
                    LoggingUtil.debug("Processed parameter: " + paramName + " = " + processedValue);
                }
            }
        }

        // 2. Columns Configuration
        if (config.has("columns")) {
            JsonNode columns = config.get("columns");
            Iterator<String> columnNames = columns.fieldNames();

            LoggingUtil.info("Processing column configurations");
            while (columnNames.hasNext()) {
                String columnName = columnNames.next();
                JsonNode columnConfig = columns.get(columnName);

                // Process column type
                if (columnConfig.has("type")) {
                    String typeStr = columnConfig.get("type").asText().toUpperCase();
                    try {
                        DataType type = DataType.valueOf(typeStr);
                        columnTypes.put(columnName, type);
                    } catch (IllegalArgumentException e) {
                        LoggingUtil.warn("Unknown data type for column " + columnName + ": " + typeStr);
                    }
                }

                // Process column visibility
                boolean isVisible = columnConfig.has("visible") ?
                        columnConfig.get("visible").asBoolean() : true;
                columnVisibility.put(columnName, isVisible);

                // Check for unique key
                if (columnConfig.has("uniqueKey") && columnConfig.get("uniqueKey").asBoolean()) {
                    uniqueKeyField = columnName;
                    LoggingUtil.info("Unique key set to column: " + columnName);
                }

                LoggingUtil.debug("Configured column: " + columnName +
                        ", Type: " + columnTypes.get(columnName) +
                        ", Visible: " + isVisible);
            }
        }

        // 3. Derived Boolean Fields
        if (config.has("derivedBooleanFields")) {
            JsonNode derivedFields = config.get("derivedBooleanFields");
            Iterator<String> fieldNames = derivedFields.fieldNames();

            LoggingUtil.info("Processing derived boolean fields");
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode fieldConfig = derivedFields.get(fieldName);

                // Store the entire field configuration
                derivedBooleanFields.put(fieldName, fieldConfig);

                // Ensure it's registered as a boolean type
                columnTypes.put(fieldName, DataType.BOOLEAN);

                // Process visibility (default to true)
                boolean isVisible = fieldConfig.has("visible") ?
                        fieldConfig.get("visible").asBoolean() : true;
                columnVisibility.put(fieldName, isVisible);

                LoggingUtil.info("Added derived boolean field: " + fieldName +
                        ", Visible: " + isVisible);
            }
        }

        // 3.5 Derived Text Fields
        if (config.has("derivedTextFields")) {
            JsonNode derivedTextFieldsNode = config.get("derivedTextFields");
            Iterator<String> fieldNames = derivedTextFieldsNode.fieldNames();

            LoggingUtil.info("Processing derived text fields");
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode fieldConfig = derivedTextFieldsNode.get(fieldName);

                // Store the entire field configuration
                derivedTextFields.put(fieldName, fieldConfig);

                // Ensure it's registered as a string type
                columnTypes.put(fieldName, DataType.STRING);

                // Process visibility (default to true)
                boolean isVisible = fieldConfig.has("visible") ?
                        fieldConfig.get("visible").asBoolean() : true;
                columnVisibility.put(fieldName, isVisible);

                LoggingUtil.info("Added derived text field: " + fieldName +
                        ", Visible: " + isVisible);
            }
        }

        // 4. Aggregate Text Fields
        if (config.has("aggregateTextFields")) {
            JsonNode aggregateFields = config.get("aggregateTextFields");
            Iterator<String> fieldNames = aggregateFields.fieldNames();

            LoggingUtil.info("Processing aggregate text fields");
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode fieldConfig = aggregateFields.get(fieldName);

                // Store the entire field configuration
                aggregateTextFields.put(fieldName, fieldConfig);

                // Ensure it's registered as a string type
                columnTypes.put(fieldName, DataType.STRING);

                // Process visibility (default to true)
                boolean isVisible = fieldConfig.has("visible") ?
                        fieldConfig.get("visible").asBoolean() : true;
                columnVisibility.put(fieldName, isVisible);

                LoggingUtil.info("Added aggregate text field: " + fieldName +
                        ", Visible: " + isVisible);
            }
        }

        // 5. Suppressed Fields
        if (config.has("suppressedFields")) {
            JsonNode suppressedFieldsNode = config.get("suppressedFields");
            Iterator<String> fieldNames = suppressedFieldsNode.fieldNames();

            LoggingUtil.info("Processing suppressed fields");
            while (fieldNames.hasNext()) {
                String fieldToSuppress = fieldNames.next();
                String conditionField = suppressedFieldsNode.get(fieldToSuppress).asText();

                suppressedFields.put(fieldToSuppress, conditionField);
                LoggingUtil.info("Added suppressed field: " + fieldToSuppress +
                        " with condition: " + conditionField);
            }
        }

        // Final configuration summary logging
        LoggingUtil.info("Configuration extraction complete");
        LoggingUtil.info("- Unique Key Field: " + uniqueKeyField);
        LoggingUtil.info("- Total Columns: " + columnTypes.size());
        LoggingUtil.info("- Derived Boolean Fields: " + derivedBooleanFields.size());
        LoggingUtil.info("- Aggregate Text Fields: " + aggregateTextFields.size());
        LoggingUtil.info("- Suppressed Fields: " + suppressedFields.size());
    }

    /**
     * Helper method to process parameter values safely
     *
     * @param paramValue JsonNode containing the parameter value
     * @return Processed parameter value or null if unable to process
     */
    private Object processParameterValue(JsonNode paramValue) {
        if (paramValue.isNull()) {
            return null;
        } else if (paramValue.isInt()) {
            return paramValue.asInt();
        } else if (paramValue.isLong()) {
            return paramValue.asLong();
        } else if (paramValue.isDouble()) {
            return paramValue.asDouble();
        } else if (paramValue.isBoolean()) {
            return paramValue.asBoolean();
        } else if (paramValue.isTextual()) {
            return paramValue.asText();
        } else if (paramValue.isArray()) {
            // Convert array to list if needed
            List<Object> arrayValues = new ArrayList<>();
            for (JsonNode element : paramValue) {
                Object processedElement = processParameterValue(element);
                if (processedElement != null) {
                    arrayValues.add(processedElement);
                }
            }
            return arrayValues;
        }

        // Fallback for complex or unhandled types
        LoggingUtil.warn("Unhandled parameter type: " + paramValue.getNodeType());
        return paramValue.toString();
    }

    public void processDerivedFields(Map<String, Object> rowValues) {
        LoggingUtil.debug("Processing derived fields. Available row fields: " + rowValues.keySet());
        LoggingUtil.debug("Derived boolean fields to process: " + derivedBooleanFields.keySet());

        if (derivedBooleanFields.isEmpty()) {
            LoggingUtil.debug("No derived boolean fields configured to process");
            return;
        }

        for (Map.Entry<String, JsonNode> entry : derivedBooleanFields.entrySet()) {
            String fieldName = entry.getKey();
            JsonNode expression = entry.getValue();

            try {
                // Log the specific expression being evaluated
                LoggingUtil.debug("Evaluating derived field: " + fieldName);
                LoggingUtil.debug("Expression details: " + expression.toString());

                // Evaluate the boolean expression using the current row values
                Boolean result = BooleanExpressionEvaluator.evaluate(expression, rowValues);

                // Add the result to the row values
                rowValues.put(fieldName, result);

                LoggingUtil.debug("Derived field '" + fieldName + "' = " + result);
            } catch (Exception e) {
                LoggingUtil.error("Error evaluating derived field '" + fieldName + "': " + e.getMessage(), e);
                // Set default value to false if evaluation fails
                rowValues.put(fieldName, false);
            }
        }
    }

    /**
     * Process the aggregate text fields for a row
     */
    public void processAggregateFields(Map<String, Object> rowValues) {
        for (Map.Entry<String, JsonNode> entry : aggregateTextFields.entrySet()) {
            String fieldName = entry.getKey();
            JsonNode config = entry.getValue();

            try {
                // Process the aggregate field configuration
                String aggregatedText = TextFieldProcessor.processAggregateField(config, rowValues);
                rowValues.put(fieldName, aggregatedText);
            } catch (Exception e) {
                LoggingUtil.error("Error processing aggregate field '" + fieldName + "': " + e.getMessage(), e);
                // Set empty string if processing fails
                rowValues.put(fieldName, "");
            }
        }
    }

    /**
     * Apply field suppression rules to a row
     */
    public void applySuppression(Map<String, Object> rowValues) {
        for (String fieldName : new ArrayList<>(rowValues.keySet())) {
            try {
                if (TextFieldProcessor.shouldSuppressField(fieldName, suppressedFields, rowValues)) {
                    // Condition is false, suppress the field by setting to null
                    rowValues.put(fieldName, null);
                }
            } catch (Exception e) {
                LoggingUtil.error("Error checking field suppression for '" + fieldName + "': " + e.getMessage(), e);
                // Don't modify the field if suppression check fails
            }
        }
    }

    /**
     * Get a list of all field names in the repository, including derived and aggregated fields
     */
    public List<String> getAllFieldNames() {
        // Start with original headers, handling null case
        List<String> allFields = new ArrayList<>();

        // Add headers if not null
        if (headers != null) {
            allFields.addAll(Arrays.asList(headers));
        } else {
            // If headers are null, use column map keys as a fallback
            allFields.addAll(columnMap.keySet());
        }

        // Add derived fields
        for (String field : derivedBooleanFields.keySet()) {
            if (!allFields.contains(field)) {
                allFields.add(field);
            }
        }

        // Add aggregate fields
        for (String field : aggregateTextFields.keySet()) {
            if (!allFields.contains(field)) {
                allFields.add(field);
            }
        }

        // Add any fields that exist in the data but not in headers
        // This handles overlay columns that might have been added
        if (!dataRows.isEmpty()) {
            Set<String> dataFields = dataRows.get(0).keySet();
            for (String field : dataFields) {
                if (field != null && !allFields.contains(field)) {
                    allFields.add(field);
                    LoggingUtil.debug("Found data field not in headers: " + field);
                }
            }
        }

        return allFields;
    }

    /**
     * Get a list of visible field names in the repository
     */
    public List<String> getVisibleFieldNames() {
        List<String> visibleFields = new ArrayList<>();

        for (String field : getAllFieldNames()) {
            if (columnVisibility.getOrDefault(field, true)) {
                visibleFields.add(field);
            }
        }

        return visibleFields;
    }
}