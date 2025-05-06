package com.sysmuse.util;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import java.util.Map;

/**
 * Utility class for processing text fields based on conditions
 */
public class TextFieldProcessor {

    /**
     * Process aggregate text fields based on configuration
     */
    public static String processAggregateField(JSONObject config, Map<String, Object> rowValues) {
        // Check if the condition field exists and is true
        String conditionField = (String) config.get("condition");
        Boolean condition = false;

        if (rowValues.containsKey(conditionField)) {
            Object condValue = rowValues.get(conditionField);
            if (condValue instanceof Boolean) {
                condition = (Boolean) condValue;
            } else {
                System.out.println("Warning: Condition field '" + conditionField +
                        "' has non-boolean value: " + condValue);
                // Convert String "true"/"false" to boolean if needed
                if (condValue instanceof String) {
                    condition = Boolean.parseBoolean((String) condValue);
                }
            }
        } else {
            System.out.println("Warning: Condition field '" + conditionField +
                    "' not found in row values. Available fields: " + rowValues.keySet());
        }

        if (!condition) {
            // Condition is false, return empty string
            return "";
        }

        // Condition is true, create the aggregate text
        JSONArray sourceFields = (JSONArray) config.get("sourceFields");
        StringBuilder aggregated = new StringBuilder();

        // Get separator if specified
        String separator = config.containsKey("separator") ?
                (String) config.get("separator") : " ";

        boolean isFirst = true;
        for (Object sourceField : sourceFields) {
            String fieldToAggregate = (String) sourceField;
            if (rowValues.containsKey(fieldToAggregate)) {
                Object val = rowValues.get(fieldToAggregate);
                if (val != null && !val.toString().isEmpty()) {
                    if (!isFirst) {
                        aggregated.append(separator);
                    } else {
                        isFirst = false;
                    }
                    aggregated.append(val.toString());
                }
            } else {
                System.out.println("Warning: Source field '" + fieldToAggregate +
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
            System.out.println("Warning: Condition field '" + conditionField +
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
            System.out.println("Warning: Condition field '" + conditionField +
                    "' has unexpected type: " + (condValue != null ? condValue.getClass().getName() : "null"));
            return false;
        }

        // If condition is false, suppress the field
        return !condition;
    }
}