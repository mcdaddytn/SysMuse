package com.sysmuse.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.Map;

/**
 * Utility class for processing text fields based on conditions
 * Updated to use SystemConfig exclusively and proper logging
 */
public class TextFieldProcessor {

    private static SystemConfig systemConfig;

    /**
     * Set the system configuration for text field processing
     */
    public static void setSystemConfig(SystemConfig config) {
        systemConfig = config;
    }

    public static String processAggregateField(JsonNode config, Map<String, Object> rowValues) {
        // Check if the condition field exists and is true
        String conditionField = config.get("condition").asText();
        Boolean condition = false;

        if (rowValues.containsKey(conditionField)) {
            Object condValue = rowValues.get(conditionField);
            LoggingUtil.debug("Condition field '" + conditionField + "' has value: " + condValue);

            if (condValue instanceof Boolean) {
                condition = (Boolean) condValue;
            } else {
                LoggingUtil.debug("Condition field '" + conditionField + "' has non-boolean value: " + condValue);
                // Convert String "true"/"false" to boolean if needed
                if (condValue instanceof String) {
                    condition = Boolean.parseBoolean((String) condValue);
                }
            }
        } else {
            LoggingUtil.debug("Condition field '" + conditionField + "' not found in row values. Available fields: " + rowValues.keySet());
        }

        if (!condition) {
            // Condition is false, return empty string
            LoggingUtil.debug("Condition for aggregate field is false, returning empty string");
            return "";
        }

        // Condition is true, create the aggregate text
        LoggingUtil.debug("Condition for aggregate field is true, creating aggregate text");
        ArrayNode sourceFields = (ArrayNode) config.get("sourceFields");
        StringBuilder aggregated = new StringBuilder();

        // Determine aggregation mode and settings
        SystemConfig.TextAggregationMode mode = SystemConfig.TextAggregationMode.NEWLINE;
        String separator = "\n";
        String fieldNamePrefix = "[";
        String fieldNameSuffix = "]";

        // Check for explicit separator in config
        if (config.has("separator")) {
            // If explicit separator is specified in the field config, use it directly
            separator = config.get("separator").asText();
        } else if (systemConfig != null) {
            // Otherwise use system config
            mode = systemConfig.getTextAggregationMode();

            if (mode == SystemConfig.TextAggregationMode.NEWLINE) {
                separator = systemConfig.getNewlineChar();
            } else if (mode == SystemConfig.TextAggregationMode.FIELDNAME) {
                // For FIELDNAME mode, the separator becomes newline plus field name
                separator = systemConfig.getNewlineChar();
                fieldNamePrefix = systemConfig.getFieldNamePrefix();
                fieldNameSuffix = systemConfig.getFieldNameSuffix();
            }
        } else {
            LoggingUtil.warn("No system configuration set for text field processing, using defaults");
        }

        boolean isFirst = true;
        for (int i = 0; i < sourceFields.size(); i++) {
            String fieldToAggregate = sourceFields.get(i).asText();
            if (rowValues.containsKey(fieldToAggregate)) {
                Object val = rowValues.get(fieldToAggregate);
                if (val != null && !val.toString().isEmpty()) {
                    if (!isFirst) {
                        aggregated.append(separator);

                        // In FIELDNAME mode, add field name as prefix
                        if (mode == SystemConfig.TextAggregationMode.FIELDNAME) {
                            aggregated.append(fieldNamePrefix)
                                    .append(fieldToAggregate)
                                    .append(fieldNameSuffix)
                                    .append(" ");
                        }
                    } else {
                        isFirst = false;

                        // For first field in FIELDNAME mode, add field name as prefix
                        if (mode == SystemConfig.TextAggregationMode.FIELDNAME) {
                            aggregated.append(fieldNamePrefix)
                                    .append(fieldToAggregate)
                                    .append(fieldNameSuffix)
                                    .append(" ");
                        }
                    }
                    aggregated.append(val.toString());
                }
            } else {
                LoggingUtil.debug("Source field '" + fieldToAggregate +
                        "' not found for aggregation. Available fields: " + rowValues.keySet());
            }
        }

        return aggregated.toString();
    }

    /**
     * Check if a field should be suppressed based on a condition
     */
    public static boolean shouldSuppressField(String fieldName, Map<String, String> suppressionRules,
                                              Map<String, Object> rowValues) {
        // Check if this field has a suppression rule
        if (!suppressionRules.containsKey(fieldName)) {
            return false;
        }

        // Get the condition field
        String conditionField = suppressionRules.get(fieldName);

        // Check if condition field exists
        if (!rowValues.containsKey(conditionField)) {
            LoggingUtil.debug("Condition field '" + conditionField +
                    "' not found for suppression rule. Available fields: " + rowValues.keySet());
            return false;
        }

        // Check if condition field is a boolean or can be converted to one
        Object condValue = rowValues.get(conditionField);
        boolean condition = false;

        if (condValue instanceof Boolean) {
            condition = (Boolean) condValue;
        } else if (condValue instanceof String) {
            condition = Boolean.parseBoolean((String) condValue);
        } else {
            LoggingUtil.debug("Condition field '" + conditionField +
                    "' has unexpected type: " + (condValue != null ? condValue.getClass().getName() : "null"));
            return false;
        }

        // If condition is false, suppress the field
        return !condition;
    }
}
