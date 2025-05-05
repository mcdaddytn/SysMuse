package com.sysmuse.util;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import java.util.Map;

/**
 * Utility class for evaluating boolean expressions defined in JSON
 */
public class BooleanExpressionEvaluator {
    
    /**
     * Evaluate a boolean expression against the current row values
     */
    public static Boolean evaluate(JSONObject expression, Map<String, Object> rowValues) {
        // Check expression type
        if (!expression.containsKey("type")) {
            throw new IllegalArgumentException("Boolean expression missing 'type' field");
        }
        
        String type = (String) expression.get("type");
        
        switch (type.toUpperCase()) {
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
    private static Boolean evaluateFieldReference(JSONObject expression, Map<String, Object> rowValues) {
        String fieldName = (String) expression.get("field");
        if (!rowValues.containsKey(fieldName)) {
            System.out.println("Warning: Referenced field '" + fieldName + "' not found in row values");
            return false;
        }
        
        Object value = rowValues.get(fieldName);
        if (!(value instanceof Boolean)) {
            System.out.println("Warning: Field '" + fieldName + "' is not a boolean value: " + value);
            return false;
        }
        
        return (Boolean) value;
    }
    
    /**
     * Evaluate a logical AND operation
     */
    private static Boolean evaluateAndOperation(JSONObject expression, Map<String, Object> rowValues) {
        JSONArray andOperands = (JSONArray) expression.get("operands");
        
        // If no operands, return true (empty AND is true)
        if (andOperands.isEmpty()) {
            return true;
        }
        
        // Check all operands - if any is false, return false
        for (Object operand : andOperands) {
            JSONObject subExpression = (JSONObject) operand;
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
    private static Boolean evaluateOrOperation(JSONObject expression, Map<String, Object> rowValues) {
        JSONArray orOperands = (JSONArray) expression.get("operands");
        
        // If no operands, return false (empty OR is false)
        if (orOperands.isEmpty()) {
            return false;
        }
        
        // Check all operands - if any is true, return true
        for (Object operand : orOperands) {
            JSONObject subExpression = (JSONObject) operand;
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
    private static Boolean evaluateNotOperation(JSONObject expression, Map<String, Object> rowValues) {
        JSONObject notOperand = (JSONObject) expression.get("operand");
        return !evaluate(notOperand, rowValues);
    }
}