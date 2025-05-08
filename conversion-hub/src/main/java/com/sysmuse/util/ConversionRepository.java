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

    /**
     * Extract all configuration sections from a JSON node
     */
    public void extractConfigFromJSON(JsonNode config) {
        // Clear existing maps to avoid duplicate entries
        configParameters.clear();
        derivedBooleanFields.clear();
        aggregateTextFields.clear();
        suppressedFields.clear();
        columnVisibility.clear();
        uniqueKeyField = null;

        // Parse parameters section
        if (config.has("parameters")) {
            JsonNode params = config.get("parameters");
            Iterator<String> fieldNames = params.fieldNames();
            while (fieldNames.hasNext()) {
                String paramName = fieldNames.next();
                JsonNode paramValue = params.get(paramName);

                if (paramValue.isInt()) {
                    configParameters.put(paramName, paramValue.asInt());
                } else if (paramValue.isLong()) {
                    configParameters.put(paramName, paramValue.asLong());
                } else if (paramValue.isDouble()) {
                    configParameters.put(paramName, paramValue.asDouble());
                } else if (paramValue.isBoolean()) {
                    configParameters.put(paramName, paramValue.asBoolean());
                } else if (paramValue.isTextual()) {
                    configParameters.put(paramName, paramValue.asText());
                } else if (paramValue.isNull()) {
                    configParameters.put(paramName, null);
                }
                LoggingUtil.debug("Found parameter: " + paramName + " = " +
                        configParameters.get(paramName));
            }
        }

        // Parse column definitions
        if (config.has("columns")) {
            JsonNode columns = config.get("columns");
            Iterator<String> columnNames = columns.fieldNames();
            while (columnNames.hasNext()) {
                String columnName = columnNames.next();
                JsonNode columnConfig = columns.get(columnName);

                // Check if this is a standard type definition
                if (columnConfig.has("type")) {
                    String typeStr = columnConfig.get("type").asText();

                    DataType type;
                    switch (typeStr.toUpperCase()) {
                        case "STRING":
                            type = DataType.STRING;
                            break;
                        case "INTEGER":
                            type = DataType.INTEGER;
                            break;
                        case "FLOAT":
                            type = DataType.FLOAT;
                            break;
                        case "BOOLEAN":
                            type = DataType.BOOLEAN;
                            break;
                        default:
                            throw new IllegalArgumentException("Unknown data type: " + typeStr);
                    }

                    columnTypes.put(columnName, type);

                    // Process visibility property
                    boolean isVisible = true; // Default is visible
                    if (columnConfig.has("visible")) {
                        JsonNode visibleValue = columnConfig.get("visible");
                        if (visibleValue.isBoolean()) {
                            isVisible = visibleValue.asBoolean();
                        } else if (visibleValue.isTextual()) {
                            isVisible = Boolean.parseBoolean(visibleValue.asText());
                        }
                    }
                    columnVisibility.put(columnName, isVisible);

                    // Check if this column is marked as unique key
                    if (columnConfig.has("uniqueKey")) {
                        JsonNode uniqueKeyValue = columnConfig.get("uniqueKey");
                        boolean isUniqueKey = false;

                        if (uniqueKeyValue.isBoolean()) {
                            isUniqueKey = uniqueKeyValue.asBoolean();
                        } else if (uniqueKeyValue.isTextual()) {
                            isUniqueKey = Boolean.parseBoolean(uniqueKeyValue.asText());
                        }

                        if (isUniqueKey) {
                            uniqueKeyField = columnName;
                            LoggingUtil.info("Found unique key field: " + uniqueKeyField);
                        }
                    }

                    LoggingUtil.debug("Column '" + columnName + "' configured with type: " + type +
                            ", visibility: " + isVisible);
                }
            }
        }

        // Parse derived boolean fields
        if (config.has("derivedBooleanFields")) {
            JsonNode derivedFields = config.get("derivedBooleanFields");
            LoggingUtil.info("Found " + derivedFields.size() + " derived boolean fields in config");

            Iterator<String> fieldNames = derivedFields.fieldNames();
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode fieldConfig = derivedFields.get(fieldName);

                derivedBooleanFields.put(fieldName, fieldConfig);
                columnTypes.put(fieldName, DataType.BOOLEAN); // Register as a boolean column

                // Process visibility property for derived fields
                boolean isVisible = true; // Default is visible
                if (fieldConfig.has("visible")) {
                    JsonNode visibleValue = fieldConfig.get("visible");
                    if (visibleValue.isBoolean()) {
                        isVisible = visibleValue.asBoolean();
                    } else if (visibleValue.isTextual()) {
                        isVisible = Boolean.parseBoolean(visibleValue.asText());
                    }
                }
                columnVisibility.put(fieldName, isVisible);

                LoggingUtil.debug("Derived boolean field '" + fieldName + "' configured with expression: " +
                        fieldConfig + ", visibility: " + isVisible);
            }
        }

        // Parse aggregate text fields
        if (config.has("aggregateTextFields")) {
            JsonNode aggregateFields = config.get("aggregateTextFields");
            LoggingUtil.info("Found " + aggregateFields.size() + " aggregate text fields in config");

            Iterator<String> fieldNames = aggregateFields.fieldNames();
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode fieldConfig = aggregateFields.get(fieldName);

                aggregateTextFields.put(fieldName, fieldConfig);
                columnTypes.put(fieldName, DataType.STRING); // Register as a string column

                // Process visibility property for aggregate fields
                boolean isVisible = true; // Default is visible
                if (fieldConfig.has("visible")) {
                    JsonNode visibleValue = fieldConfig.get("visible");
                    if (visibleValue.isBoolean()) {
                        isVisible = visibleValue.asBoolean();
                    } else if (visibleValue.isTextual()) {
                        isVisible = Boolean.parseBoolean(visibleValue.asText());
                    }
                }
                columnVisibility.put(fieldName, isVisible);

                LoggingUtil.debug("Aggregate text field '" + fieldName + "' configured with condition: "
                        + fieldConfig.get("condition").asText() + ", visibility: " + isVisible);

                // Log source fields
                ArrayNode sourceFields = (ArrayNode) fieldConfig.get("sourceFields");
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < sourceFields.size(); i++) {
                    if (i > 0) sb.append(", ");
                    sb.append(sourceFields.get(i).asText());
                }
                LoggingUtil.debug("Source fields for '" + fieldName + "': " + sb.toString());
            }
        }

        // Parse suppressed fields
        if (config.has("suppressedFields")) {
            JsonNode suppressed = config.get("suppressedFields");
            Iterator<String> fieldNames = suppressed.fieldNames();
            while (fieldNames.hasNext()) {
                String fieldToSuppress = fieldNames.next();
                String conditionField = suppressed.get(fieldToSuppress).asText();

                suppressedFields.put(fieldToSuppress, conditionField);

                LoggingUtil.debug("Field '" + fieldToSuppress + "' will be suppressed when '" +
                        conditionField + "' is false");
            }
        }

        // Print summary of configuration
        LoggingUtil.info("Configuration summary:");
        LoggingUtil.info("- Parameters: " + configParameters.size());
        LoggingUtil.info("- Column types: " + columnTypes.size());
        LoggingUtil.info("- Derived boolean fields: " + derivedBooleanFields.size());
        LoggingUtil.info("- Aggregate text fields: " + aggregateTextFields.size());
        LoggingUtil.info("- Suppressed fields: " + suppressedFields.size());
        LoggingUtil.info("- Unique key field: " + uniqueKeyField);

        // Count visible and hidden fields
        int visibleCount = 0;
        int hiddenCount = 0;
        for (Boolean visible : columnVisibility.values()) {
            if (visible) {
                visibleCount++;
            } else {
                hiddenCount++;
            }
        }
        LoggingUtil.info("- Visible fields: " + visibleCount);
        LoggingUtil.info("- Hidden fields: " + hiddenCount);
    }

    /**
     * Process the derived boolean fields for a row
     */
    public void processDerivedFields(Map<String, Object> rowValues) {
        for (Map.Entry<String, JsonNode> entry : derivedBooleanFields.entrySet()) {
            String fieldName = entry.getKey();
            JsonNode expression = entry.getValue();

            try {
                // Evaluate the boolean expression using the current row values
                Boolean result = BooleanExpressionEvaluator.evaluate(expression, rowValues);
                rowValues.put(fieldName, result);
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