package com.sysmuse.util;

import java.util.*;
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
        STRING, INTEGER, FLOAT, BOOLEAN
    }

    // Core data storage
    private List<Map<String, Object>> dataRows = new ArrayList<>();

    // Original column headers in order
    private String[] headers;

    // Map of column names to their indices (preserving order)
    private LinkedHashMap<String, Integer> columnMap = new LinkedHashMap<>();

    // Map of column names to their data types (from config or inferred)
    private Map<String, DataType> columnTypes = new HashMap<>();

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

    // Unique key field for multi-file overlay
    private String uniqueKeyField = null;

    // Configuration instance
    private SystemConfig systemConfig;

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
     * Get the headers array
     */
    public String[] getHeaders() {
        return headers;
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
     * Infer column types from first data row
     */
    public void inferTypes(String[] headers, String[] firstDataRow) {
        for (int i = 0; i < headers.length && i < firstDataRow.length; i++) {
            String value = firstDataRow[i];
            String columnName = headers[i];

            // Skip empty column names
            if (columnName == null || columnName.trim().isEmpty()) {
                continue;
            }

            // Check if it's a boolean
            if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("false")) {
                columnTypes.put(columnName, DataType.BOOLEAN);
                continue;
            }

            // Check if it's a number
            try {
                if (value.contains(".")) {
                    Double.parseDouble(value);
                    columnTypes.put(columnName, DataType.FLOAT);
                } else {
                    Integer.parseInt(value);
                    columnTypes.put(columnName, DataType.INTEGER);
                }
            } catch (NumberFormatException e) {
                // Default to string if parsing fails
                columnTypes.put(columnName, DataType.STRING);
            }
        }
        LoggingUtil.info("Inferred types for " + columnTypes.size() + " columns");
    }

    /**
     * Convert a string value to the appropriate type
     */
    public Object convertValue(String value, DataType type) {
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