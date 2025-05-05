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
        
        if (rowValues.containsKey(conditionField) && 
            rowValues.get(conditionField) instanceof Boolean) {
            condition = (Boolean) rowValues.get(conditionField);
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
        
        // Check if condition field exists and is false
        if (rowValues.containsKey(conditionField) && 
            rowValues.get(conditionField) instanceof Boolean) {
            Boolean condition = (Boolean) rowValues.get(conditionField);
            
            // If condition is false, suppress the field
            return !condition;
        }
        
        // Default is to not suppress
        return false;
    }
}