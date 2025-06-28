package com.sysmuse.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Utility class for evaluating boolean expressions defined in JSON
 * Enhanced with string comparison operations and proper logging
 */
public class BooleanExpressionEvaluator {

    /**
     * Evaluate a boolean expression against the current row values
     */
    public static Boolean evaluate(JsonNode expression, Map<String, Object> rowValues) {
        // Check expression type
        if (!expression.has("type")) {
            throw new IllegalArgumentException("Boolean expression missing 'type' field");
        }

        String type = expression.get("type").asText().toUpperCase();

        switch (type) {
            case "FIELD":
                if (expression.has("comparison")) {
                    return evaluateFieldComparison(expression, rowValues);
                }
                return evaluateFieldReference(expression, rowValues);

            case "AND":
                return evaluateAndOperation(expression, rowValues);

            case "OR":
                return evaluateOrOperation(expression, rowValues);

            case "NOT":
                return evaluateNotOperation(expression, rowValues);

            case "STRING_EXACT_MATCH":
                return evaluateStringExactMatch(expression, rowValues);

            case "STRING_CASE_INSENSITIVE_MATCH":
                return evaluateStringCaseInsensitiveMatch(expression, rowValues);

            case "STRING_IN_SET":
                return evaluateStringInSet(expression, rowValues);

            case "STRING_REGEX_MATCH":
                return evaluateStringRegexMatch(expression, rowValues);

            case "STRING_IN_REGEXSET":
                return evaluateStringInRegexSet(expression, rowValues);

            default:
                throw new IllegalArgumentException("Unknown boolean expression type: " + type);
        }
    }

    /**
     * Evaluate a field reference expression
     */
    private static Boolean evaluateFieldReference(JsonNode expression, Map<String, Object> rowValues) {
        String fieldName = expression.get("field").asText();
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Referenced field '" + fieldName + "' not found in row values");
            LoggingUtil.debug("Available fields: " + rowValues.keySet());
            return false;
        }

        Object value = rowValues.get(fieldName);
        if (value instanceof Boolean) {
            return (Boolean) value;
        } else if (value instanceof String) {
            // Handle string values like "true" or "false"
            return Boolean.parseBoolean((String) value);
        } else {
            LoggingUtil.debug("Field '" + fieldName + "' is not a boolean value: " + value);
            // Default to false for non-boolean values
            return false;
        }
    }

    private static Boolean evaluateFieldComparison(JsonNode expression, Map<String, Object> rowValues) {
        String fieldName = expression.get("field").asText();

        // Check if the field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for comparison");
            return false;
        }

        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return false;
        }

        // If no comparison specified, treat as boolean field
        if (!expression.has("comparison")) {
            return evaluateFieldReference(expression, rowValues);
        }

        // Get comparison and value to compare against
        String comparisonType = expression.get("comparison").asText();
        JsonNode valueNode = expression.get("value");

        // Debug the comparison
        LoggingUtil.debug("Comparing field '" + fieldName + "' with value " + fieldValue +
                " " + comparisonType + " " + valueNode);

        // Convert field value and comparison value to appropriate types for numeric comparison
        try {
            double fieldNumValue;
            double compareNumValue;

            // Convert field value to double
            if (fieldValue instanceof Number) {
                fieldNumValue = ((Number) fieldValue).doubleValue();
            } else {
                fieldNumValue = Double.parseDouble(fieldValue.toString());
            }

            // Convert comparison value to double
            if (valueNode.isNumber()) {
                compareNumValue = valueNode.asDouble();
            } else {
                compareNumValue = Double.parseDouble(valueNode.asText());
            }

            // Perform numeric comparison
            switch (comparisonType) {
                case ">": return fieldNumValue > compareNumValue;
                case ">=": return fieldNumValue >= compareNumValue;
                case "<": return fieldNumValue < compareNumValue;
                case "<=": return fieldNumValue <= compareNumValue;
                case "==": return fieldNumValue == compareNumValue;
                case "!=": return fieldNumValue != compareNumValue;
                default:
                    LoggingUtil.debug("Unsupported comparison operator: " + comparisonType);
                    return false;
            }
        } catch (NumberFormatException e) {
            // If values can't be converted to numbers, fall back to string comparison
            String fieldStrValue = fieldValue.toString();
            String compareStrValue = valueNode.asText();

            switch (comparisonType) {
                case "==": return fieldStrValue.equals(compareStrValue);
                case "!=": return !fieldStrValue.equals(compareStrValue);
                default:
                    LoggingUtil.debug("Cannot perform numeric comparison with non-numeric values");
                    return false;
            }
        }
    }

    private static Object convertToAppropriateType(JsonNode valueNode, Object referenceValue) {
        if (valueNode.isInt()) {
            return valueNode.asInt();
        } else if (valueNode.isLong()) {
            return valueNode.asLong();
        } else if (valueNode.isDouble()) {
            return valueNode.asDouble();
        } else if (valueNode.isBoolean()) {
            return valueNode.asBoolean();
        } else if (valueNode.isTextual()) {
            String textValue = valueNode.asText();

            // Try to convert based on reference value type
            if (referenceValue instanceof Integer) {
                return Integer.parseInt(textValue);
            } else if (referenceValue instanceof Long) {
                return Long.parseLong(textValue);
            } else if (referenceValue instanceof Double) {
                return Double.parseDouble(textValue);
            } else if (referenceValue instanceof Boolean) {
                return Boolean.parseBoolean(textValue);
            }

            return textValue;
        }

        return null;
    }

    /**
     * Evaluate a logical AND operation
     */
    private static Boolean evaluateAndOperation(JsonNode expression, Map<String, Object> rowValues) {
        ArrayNode andOperands = (ArrayNode) expression.get("operands");

        // If no operands, return true (empty AND is true)
        if (andOperands.size() == 0) {
            return true;
        }

        // Check all operands - if any is false, return false
        for (int i = 0; i < andOperands.size(); i++) {
            JsonNode subExpression = andOperands.get(i);
            if (!evaluate(subExpression, rowValues)) {
                return false;
            }
        }

        // All operands were true
        return true;
    }

    /**
     * Evaluate a logical OR operation
     */
    private static Boolean evaluateOrOperation(JsonNode expression, Map<String, Object> rowValues) {
        ArrayNode orOperands = (ArrayNode) expression.get("operands");

        // If no operands, return false (empty OR is false)
        if (orOperands.size() == 0) {
            return false;
        }

        // Check all operands - if any is true, return true
        for (int i = 0; i < orOperands.size(); i++) {
            JsonNode subExpression = orOperands.get(i);
            if (evaluate(subExpression, rowValues)) {
                return true;
            }
        }

        // All operands were false
        return false;
    }

    /**
     * Evaluate a logical NOT operation
     */
    private static Boolean evaluateNotOperation(JsonNode expression, Map<String, Object> rowValues) {
        JsonNode notOperand = expression.get("operand");
        return !evaluate(notOperand, rowValues);
    }

    /**
     * Evaluate a string exact match operation
     * Compares field value to a specified string for exact equality
     */
    private static Boolean evaluateStringExactMatch(JsonNode expression, Map<String, Object> rowValues) {
        // Get field name and expected value
        String fieldName = expression.get("field").asText();
        String expectedValue = expression.get("value").asText();

        // Check if field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for string comparison");
            return false;
        }

        // Get actual field value
        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return expectedValue == null; // Both null means match
        }

        // Convert field value to string if necessary
        String fieldValueStr = fieldValue.toString();

        // Compare strings exactly
        return fieldValueStr.equals(expectedValue);
    }

    /**
     * Evaluate a string case-insensitive match operation
     * Compares field value to a specified string ignoring case
     */
    private static Boolean evaluateStringCaseInsensitiveMatch(JsonNode expression, Map<String, Object> rowValues) {
        // Get field name and expected value
        String fieldName = expression.get("field").asText();
        String expectedValue = expression.get("value").asText();

        // Check if field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for case-insensitive comparison");
            return false;
        }

        // Get actual field value
        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return expectedValue == null; // Both null means match
        }

        // Convert field value to string if necessary
        String fieldValueStr = fieldValue.toString();

        // Compare strings ignoring case
        return fieldValueStr.toLowerCase().equals(expectedValue.toLowerCase());
    }

    /**
     * Evaluate a string in-set operation
     * Checks if field value is in a set of allowed values
     */
    private static Boolean evaluateStringInSet(JsonNode expression, Map<String, Object> rowValues) {
        // Get field name
        String fieldName = expression.get("field").asText();

        // Check if field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for in-set comparison");
            return false;
        }

        // Get actual field value
        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return false; // Null value cannot be in set
        }

        // Convert field value to string if necessary
        String fieldValueStr = fieldValue.toString();

        // Get the set of allowed values
        ArrayNode valuesNode = (ArrayNode) expression.get("values");
        Set<String> allowedValues = new HashSet<>();

        // Case-insensitive option (default to false if not specified)
        boolean ignoreCase = false;
        if (expression.has("ignoreCase")) {
            ignoreCase = expression.get("ignoreCase").asBoolean();
        }

        // Fill the allowed values set
        for (int i = 0; i < valuesNode.size(); i++) {
            String value = valuesNode.get(i).asText();
            allowedValues.add(ignoreCase ? value.toLowerCase() : value);
        }

        // Check if field value is in the set
        if (ignoreCase) {
            return allowedValues.contains(fieldValueStr.toLowerCase());
        } else {
            return allowedValues.contains(fieldValueStr);
        }
    }

    /**
     * Evaluate a string regex match operation
     * Checks if field value matches a regular expression pattern
     */
    private static Boolean evaluateStringRegexMatch(JsonNode expression, Map<String, Object> rowValues) {
        // Get field name and regex pattern
        String fieldName = expression.get("field").asText();
        String pattern = expression.get("pattern").asText();

        // Check if field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for regex comparison");
            return false;
        }

        // Get actual field value
        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return false; // Null doesn't match any pattern
        }

        // Convert field value to string
        String fieldValueStr = fieldValue.toString();

        try {
            // Compile and match regex pattern
            return fieldValueStr.matches(pattern);
        } catch (Exception e) {
            LoggingUtil.warn("Invalid regex pattern '" + pattern + "': " + e.getMessage());
            return false;
        }
    }

    /**
     * Evaluate a string in regex set operation
     * Checks if field value matches any of the regex patterns in a set
     */
    private static Boolean evaluateStringInRegexSet(JsonNode expression, Map<String, Object> rowValues) {
        // Get field name
        String fieldName = expression.get("field").asText();

        // Check if field exists in row values
        if (!rowValues.containsKey(fieldName)) {
            LoggingUtil.debug("Field '" + fieldName + "' not found for regex set comparison");
            return false;
        }

        // Get actual field value
        Object fieldValue = rowValues.get(fieldName);
        if (fieldValue == null) {
            return false; // Null value cannot be in set
        }

        // Convert field value to string
        String fieldValueStr = fieldValue.toString();

        // Get the set of regex patterns
        ArrayNode patternsNode = (ArrayNode) expression.get("patterns");

        // Check each pattern
        for (int i = 0; i < patternsNode.size(); i++) {
            String pattern = patternsNode.get(i).asText();

            try {
                if (fieldValueStr.matches(pattern)) {
                    return true; // Return true on first match
                }
            } catch (Exception e) {
                LoggingUtil.warn("Invalid regex pattern '" + pattern + "': " + e.getMessage());
                // Continue checking other patterns
            }
        }

        // No patterns matched
        return false;
    }
}
