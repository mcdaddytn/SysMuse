package com.sysmuse.util;

import org.json.simple.JSONObject;
import org.json.simple.JSONArray;
import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * Specialized ConfigGenerator for the "Applicable Format" CSV structure,
 * which handles boolean fields and their related text fields,
 * as well as compound expressions for text aggregation.
 */
public class ApplicableFormatConfigGenerator implements ConfigGenerator {
    
    private String compoundExpressionsString;
    
    /**
     * Default constructor
     */
    public ApplicableFormatConfigGenerator() {
        this.compoundExpressionsString = null;
    }
    
    /**
     * Constructor with compound expressions
     * 
     * @param compoundExpressionsString Comma-separated list of compound expressions
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString) {
        this.compoundExpressionsString = compoundExpressionsString;
    }
    
    /**
     * Generate a configuration based on the "Applicable Format" CSV structure
     */
    @Override
    public JSONObject generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        JSONObject config = new JSONObject();
        
        // Add default parameters
        JSONObject parameters = new JSONObject();
        parameters.put("maxImportRows", null);
        config.put("parameters", parameters);
        
        // Add column configurations
        JSONObject columns = new JSONObject();
        
        // Map to store field prefixes
        Map<String, List<String>> prefixToFields = new HashMap<>();
        
        // Process headers to identify field patterns
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }
            
            JSONObject columnConfig = new JSONObject();
            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ? 
                          columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);
            columns.put(header, columnConfig);
            
            // Find field prefix (everything before " reasoning" or " snippets")
            String prefix = header;
            if (header.endsWith(" reasoning") || header.endsWith(" snippets")) {
                prefix = header.substring(0, header.lastIndexOf(" "));
            }
            
            // Add to prefix map
            if (!prefixToFields.containsKey(prefix)) {
                prefixToFields.put(prefix, new ArrayList<>());
            }
            prefixToFields.get(prefix).add(header);
        }
        
        config.put("columns", columns);
        
        // Process derived boolean fields and suppressed fields
        JSONObject suppressedFields = new JSONObject();
        
        // Identify boolean fields and their related text fields
        for (Map.Entry<String, List<String>> entry : prefixToFields.entrySet()) {
            String prefix = entry.getKey();
            List<String> fields = entry.getValue();
            
            // Sort fields by length (shortest is usually the boolean field)
            fields.sort(Comparator.comparing(String::length));
            
            if (fields.size() > 1) {
                String boolField = fields.get(0);
                
                // Check if the shortest field is actually a boolean
                if (columnTypes.containsKey(boolField) && 
                    columnTypes.get(boolField).toString().equals("BOOLEAN")) {
                    
                    // Add suppression rules for related text fields
                    for (int i = 1; i < fields.size(); i++) {
                        suppressedFields.put(fields.get(i), boolField);
                    }
                }
            }
        }
        
        config.put("suppressedFields", suppressedFields);
        
        // Process compound expressions for text aggregation if provided
        if (compoundExpressionsString != null && !compoundExpressionsString.isEmpty()) {
            JSONObject aggregateTextFields = new JSONObject();
            String[] expressions = compoundExpressionsString.split(",");
            
            int aggregateFieldIndex = 1;
            for (String expression : expressions) {
                // Parse the expression
                JSONObject booleanExpression = parseCompoundExpression(expression.trim());
                
                // Find all suffix types (reasoning, snippets)
                Set<String> suffixTypes = new HashSet<>();
                for (String header : headers) {
                    if (header.endsWith(" reasoning")) {
                        suffixTypes.add("reasoning");
                    } else if (header.endsWith(" snippets")) {
                        suffixTypes.add("snippets");
                    }
                }
                
                // Create derived boolean field for this expression
                String derivedFieldName = "DerivedExpression" + aggregateFieldIndex;
                
                // Add derived boolean field
                if (config.containsKey("derivedBooleanFields")) {
                    ((JSONObject)config.get("derivedBooleanFields")).put(derivedFieldName, booleanExpression);
                } else {
                    JSONObject derivedFields = new JSONObject();
                    derivedFields.put(derivedFieldName, booleanExpression);
                    config.put("derivedBooleanFields", derivedFields);
                }
                
                // Create aggregate text fields for each suffix type
                for (String suffix : suffixTypes) {
                    // Find all related fields with this suffix
                    List<String> sourceFields = new ArrayList<>();
                    
                    // Extract field names from the expression
                    List<String> fieldNames = extractFieldNames(expression);
                    
                    // Add fields with the current suffix
                    for (String fieldName : fieldNames) {
                        String fieldWithSuffix = fieldName + " " + suffix;
                        if (Arrays.asList(headers).contains(fieldWithSuffix)) {
                            sourceFields.add(fieldWithSuffix);
                        }
                    }
                    
                    if (!sourceFields.isEmpty()) {
                        JSONObject aggregateConfig = new JSONObject();
                        aggregateConfig.put("condition", derivedFieldName);
                        
                        JSONArray sourcesArray = new JSONArray();
                        for (String source : sourceFields) {
                            sourcesArray.add(source);
                        }
                        
                        aggregateConfig.put("sourceFields", sourcesArray);
                        aggregateConfig.put("separator", "\n\n");
                        
                        String aggregateFieldName = "Aggregated" + suffix.substring(0, 1).toUpperCase() + 
                                                  suffix.substring(1) + aggregateFieldIndex;
                        aggregateTextFields.put(aggregateFieldName, aggregateConfig);
                    }
                }
                
                aggregateFieldIndex++;
            }
            
            if (!aggregateTextFields.isEmpty()) {
                config.put("aggregateTextFields", aggregateTextFields);
            }
        }
        
        return config;
    }
    
    /**
     * Parse a compound expression string into a JSONObject representing the boolean expression
     */
    private JSONObject parseCompoundExpression(String expression) {
        // Split by " AND " and " OR "
        if (expression.contains(" AND ")) {
            String[] parts = expression.split(" AND ");
            
            JSONObject andExpr = new JSONObject();
            andExpr.put("type", "AND");
            
            JSONArray operands = new JSONArray();
            for (String part : parts) {
                operands.add(parseCompoundExpression(part));
            }
            
            andExpr.put("operands", operands);
            return andExpr;
            
        } else if (expression.contains(" OR ")) {
            String[] parts = expression.split(" OR ");
            
            JSONObject orExpr = new JSONObject();
            orExpr.put("type", "OR");
            
            JSONArray operands = new JSONArray();
            for (String part : parts) {
                operands.add(parseCompoundExpression(part));
            }
            
            orExpr.put("operands", operands);
            return orExpr;
            
        } else {
            // It's a simple field reference
            JSONObject fieldRef = new JSONObject();
            fieldRef.put("type", "FIELD");
            fieldRef.put("field", expression.trim());
            return fieldRef;
        }
    }
    
    /**
     * Extract field names from a compound expression
     */
    private List<String> extractFieldNames(String expression) {
        List<String> fieldNames = new ArrayList<>();
        
        // Replace AND and OR with space to split the expression
        String simplified = expression.replace(" AND ", " ").replace(" OR ", " ");
        
        // Split and add each field name
        for (String part : simplified.split(" ")) {
            if (!part.trim().isEmpty()) {
                fieldNames.add(part.trim());
            }
        }
        
        return fieldNames;
    }
}
