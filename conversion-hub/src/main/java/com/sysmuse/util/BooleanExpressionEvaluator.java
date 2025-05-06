package com.sysmuse.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.Map;

/**
 * Utility class for evaluating boolean expressions defined in JSON
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
            System.out.println("Warning: Referenced field '" + fieldName + "' not found in row values");
            System.out.println("Available fields: " + rowValues.keySet());
            return false;
        }

        Object value = rowValues.get(fieldName);
        if (value instanceof Boolean) {
            return (Boolean) value;
        } else if (value instanceof String) {
            // Handle string values like "true" or "false"
            return Boolean.parseBoolean((String) value);
        } else {
            System.out.println("Warning: Field '" + fieldName + "' is not a boolean value: " + value);
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
}
