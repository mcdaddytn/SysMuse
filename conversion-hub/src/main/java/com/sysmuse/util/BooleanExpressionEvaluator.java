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
}
