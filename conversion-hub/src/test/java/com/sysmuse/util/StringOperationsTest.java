package com.sysmuse.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.Map;

/**
 * Test program to demonstrate the string matching operations in BooleanExpressionEvaluator
 */
public class StringOperationsTest {

    public static void main(String[] args) {
        try {
            // Create test data
            Map<String, Object> user1 = createTestUser("USR001", "johndoe", "john.doe@example.com", 
                                                      "2023-01-15", "Email", "Premium", "Active",
                                                      "Credit Card");
            
            Map<String, Object> user2 = createTestUser("USR002", "janedoe", "jane.doe@example.com", 
                                                      "2023-02-20", "Phone", "Basic", "Inactive",
                                                      "paypal");
            
            Map<String, Object> user3 = createTestUser("USR003", "bobsmith", "bob.smith@example.com", 
                                                      "2023-03-10", "email", "premium", "Active",
                                                      "Bank Transfer");
            
            Map<String, Object> user4 = createTestUser("USR004", "alicejones", "alice.jones@example.com", 
                                                      "2023-04-05", "PHONE", "Trial", "Expired",
                                                      "Venmo");
            
            Map<String, Object> user5 = createTestUser("USR005", "mikelee", "mike.lee@example.com", 
                                                      "2023-05-12", "sms", "Basic", "Active",
                                                      "credit card");
            
            // Create JSON expression for string exact match
            JsonNode exactMatchExpr = createExactMatchExpression("AccountType", "Premium");
            
            // Create JSON expression for case-insensitive match
            JsonNode caseInsensitiveExpr = createCaseInsensitiveMatchExpression("PreferredContact", "email");
            
            // Create JSON expression for in-set match
            JsonNode inSetExpr = createInSetExpression("PaymentMethod", 
                                                      new String[]{"Credit Card", "PayPal", "Bank Transfer"}, 
                                                      true);
            
            // Create complex expression (Premium user AND uses popular payment method)
            JsonNode complexExpr = createComplexExpression();
            
            // Test the expressions with each user
            System.out.println("=== Test Results ===");
            System.out.println("\n1. Exact String Match (AccountType = 'Premium'):");
            testExpression(exactMatchExpr, user1, user2, user3, user4, user5);
            
            System.out.println("\n2. Case-Insensitive Match (PreferredContact = 'email'):");
            testExpression(caseInsensitiveExpr, user1, user2, user3, user4, user5);
            
            System.out.println("\n3. In-Set Match (PaymentMethod in ['Credit Card', 'PayPal', 'Bank Transfer']):");
            testExpression(inSetExpr, user1, user2, user3, user4, user5);
            
            System.out.println("\n4. Complex Expression (Premium/premium user AND popular payment method):");
            testExpression(complexExpr, user1, user2, user3, user4, user5);
            
        } catch (Exception e) {
            System.err.println("Error in test: " + e.getMessage());
            e.printStackTrace();
        }
    }
    
    /**
     * Create a test user with the specified attributes
     */
    private static Map<String, Object> createTestUser(String userID, String userName, String email,
                                                     String joinDate, String preferredContact,
                                                     String accountType, String subscriptionStatus,
                                                     String paymentMethod) {
        Map<String, Object> user = new HashMap<>();
        user.put("UserID", userID);
        user.put("UserName", userName);
        user.put("Email", email);
        user.put("JoinDate", joinDate);
        user.put("PreferredContact", preferredContact);
        user.put("AccountType", accountType);
        user.put("SubscriptionStatus", subscriptionStatus);
        user.put("PaymentMethod", paymentMethod);
        return user;
    }
    
    /**
     * Create a JSON expression for string exact match
     */
    private static JsonNode createExactMatchExpression(String fieldName, String value) {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode expr = mapper.createObjectNode();
        expr.put("type", "STRING_EXACT_MATCH");
        expr.put("field", fieldName);
        expr.put("value", value);
        return expr;
    }
    
    /**
     * Create a JSON expression for case-insensitive match
     */
    private static JsonNode createCaseInsensitiveMatchExpression(String fieldName, String value) {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode expr = mapper.createObjectNode();
        expr.put("type", "STRING_CASE_INSENSITIVE_MATCH");
        expr.put("field", fieldName);
        expr.put("value", value);
        return expr;
    }
    
    /**
     * Create a JSON expression for in-set match
     */
    private static JsonNode createInSetExpression(String fieldName, String[] values, boolean ignoreCase) {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode expr = mapper.createObjectNode();
        expr.put("type", "STRING_IN_SET");
        expr.put("field", fieldName);
        
        ArrayNode valuesArray = mapper.createArrayNode();
        for (String value : values) {
            valuesArray.add(value);
        }
        expr.set("values", valuesArray);
        expr.put("ignoreCase", ignoreCase);
        
        return expr;
    }
    
    /**
     * Create a complex expression that combines multiple operations
     */
    private static JsonNode createComplexExpression() {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode expr = mapper.createObjectNode();
        expr.put("type", "AND");
        
        // Account type case-insensitive match to "premium"
        ObjectNode accountTypeExpr = mapper.createObjectNode();
        accountTypeExpr.put("type", "STRING_CASE_INSENSITIVE_MATCH");
        accountTypeExpr.put("field", "AccountType");
        accountTypeExpr.put("value", "premium");
        
        // Active subscription
        ObjectNode subscriptionExpr = mapper.createObjectNode();
        subscriptionExpr.put("type", "STRING_EXACT_MATCH");
        subscriptionExpr.put("field", "SubscriptionStatus");
        subscriptionExpr.put("value", "Active");
        
        // Popular payment method
        ObjectNode paymentExpr = mapper.createObjectNode();
        paymentExpr.put("type", "STRING_IN_SET");
        paymentExpr.put("field", "PaymentMethod");
        
        ArrayNode valuesArray = mapper.createArrayNode();
        valuesArray.add("Credit Card");
        valuesArray.add("PayPal");
        valuesArray.add("Bank Transfer");
        paymentExpr.set("values", valuesArray);
        paymentExpr.put("ignoreCase", true);
        
        // Create operands array
        ArrayNode operands = mapper.createArrayNode();
        operands.add(accountTypeExpr);
        operands.add(subscriptionExpr);
        operands.add(paymentExpr);
        
        expr.set("operands", operands);
        
        return expr;
    }
    
    /**
     * Test an expression with multiple users and print the results
     */
    private static void testExpression(JsonNode expression, Map<String, Object>... users) {
        for (int i = 0; i < users.length; i++) {
            Map<String, Object> user = users[i];
            boolean result = BooleanExpressionEvaluator.evaluate(expression, user);
            
            System.out.println(String.format("User %s (%s): %s", 
                                             user.get("UserID"), 
                                             getUserSummary(user), 
                                             result ? "MATCH" : "NO MATCH"));
        }
    }
    
    /**
     * Create a summary string for a user
     */
    private static String getUserSummary(Map<String, Object> user) {
        return String.format("%s, Account: %s, Contact: %s, Payment: %s", 
                            user.get("UserName"), 
                            user.get("AccountType"), 
                            user.get("PreferredContact"),
                            user.get("PaymentMethod"));
    }
}
