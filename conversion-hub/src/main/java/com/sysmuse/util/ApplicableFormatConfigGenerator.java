package com.sysmuse.util;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Specialized ConfigGenerator for the "Applicable Format" structure,
 * which handles boolean fields and their related text fields,
 * as well as compound expressions for text aggregation.
 */
public class ApplicableFormatConfigGenerator implements ConfigGenerator {

    private String compoundExpressionsString;
    private Properties properties;
    private ObjectMapper mapper;

    // Pattern to match quoted strings or unquoted words
    private static final Pattern FIELD_PATTERN = Pattern.compile("\"([^\"]+)\"|([^\\s\"]+)");

    /**
     * Default constructor
     */
    public ApplicableFormatConfigGenerator() {
        this.compoundExpressionsString = null;
        this.properties = new Properties();
        this.mapper = new ObjectMapper();
    }

    /**
     * Constructor with compound expressions
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString) {
        this.compoundExpressionsString = compoundExpressionsString;
        this.properties = new Properties();
        this.mapper = new ObjectMapper();
    }

    /**
     * Constructor with properties
     */
    public ApplicableFormatConfigGenerator(Properties properties) {
        this.properties = properties;
        this.compoundExpressionsString = properties.getProperty("applicable.format.compound.expressions");
        this.mapper = new ObjectMapper();
    }

    /**
     * Constructor with compound expressions and properties
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString, Properties properties) {
        this.compoundExpressionsString = compoundExpressionsString;
        this.properties = properties;
        this.mapper = new ObjectMapper();
    }

    /**
     * Set properties
     */
    public void setProperties(Properties properties) {
        this.properties = properties;
    }

    /**
     * Generate a configuration based on the "Applicable Format" structure
     */
    @Override
    public JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters from properties
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows from properties if available
        String maxImportRows = properties.getProperty("maxImportRows");
        if (maxImportRows != null && !maxImportRows.equals("0")) {
            try {
                int maxRows = Integer.parseInt(maxImportRows);
                parameters.put("maxImportRows", maxRows);
            } catch (NumberFormatException e) {
                parameters.putNull("maxImportRows");
            }
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Add column configurations
        ObjectNode columns = mapper.createObjectNode();

        // Map to store field prefixes
        Map<String, List<String>> prefixToFields = new LinkedHashMap<>();

        // Process headers to identify field patterns
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();
            
            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ?
                    columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            columns.set(header, columnConfig);

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

        config.set("columns", columns);

        // Process derived boolean fields and suppressed fields
        ObjectNode suppressedFields = mapper.createObjectNode();

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

        config.set("suppressedFields", suppressedFields);

        // Process compound expressions for text aggregation if provided
        if (compoundExpressionsString != null && !compoundExpressionsString.isEmpty()) {
            ObjectNode aggregateTextFields = mapper.createObjectNode();
            ObjectNode derivedBooleanFields = mapper.createObjectNode();
            
            String[] expressions = compoundExpressionsString.split(",");

            int aggregateFieldIndex = 1;
            for (String expression : expressions) {
                // Parse the expression
                ObjectNode booleanExpression = parseCompoundExpression(expression.trim());

                // Find all suffix types (reasoning, snippets)
                Set<String> suffixTypes = new LinkedHashSet<>();
                for (String header : headers) {
                    if (header.endsWith(" reasoning")) {
                        suffixTypes.add("reasoning");
                    } else if (header.endsWith(" snippets")) {
                        suffixTypes.add("snippets");
                    }
                }

                // Create derived boolean field for this expression
                String derivedFieldName = "DerivedExpression" + aggregateFieldIndex;

                // Add derived boolean field to config
                derivedBooleanFields.set(derivedFieldName, booleanExpression);

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
                        ObjectNode aggregateConfig = mapper.createObjectNode();
                        aggregateConfig.put("condition", derivedFieldName);
                        aggregateConfig.put("visible", true);  // Add visibility property

                        ArrayNode sourcesArray = mapper.createArrayNode();
                        for (String source : sourceFields) {
                            sourcesArray.add(source);
                        }

                        aggregateConfig.set("sourceFields", sourcesArray);
                        aggregateConfig.put("separator", "\n\n");

                        String aggregateFieldName = "Aggregated" + suffix.substring(0, 1).toUpperCase() +
                                suffix.substring(1) + aggregateFieldIndex;
                        aggregateTextFields.set(aggregateFieldName, aggregateConfig);
                    }
                }

                aggregateFieldIndex++;
            }

            if (derivedBooleanFields.size() > 0) {
                config.set("derivedBooleanFields", derivedBooleanFields);
            }
            
            if (aggregateTextFields.size() > 0) {
                config.set("aggregateTextFields", aggregateTextFields);
            }
        }

        return config;
    }

    /**
     * Parse a compound expression string into a JsonNode representing the boolean expression
     */
    private ObjectNode parseCompoundExpression(String expression) {
        // Replace quoted strings with a temporary placeholder
        Map<String, String> placeholders = new HashMap<>();
        int placeholderCount = 0;

        Matcher matcher = FIELD_PATTERN.matcher(expression);
        StringBuffer sb = new StringBuffer();

        while (matcher.find()) {
            String field = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            String placeholder = "FIELD_" + placeholderCount++;
            placeholders.put(placeholder, field);
            matcher.appendReplacement(sb, placeholder);
        }
        matcher.appendTail(sb);

        String processedExpression = sb.toString();

        // Now parse the expression with placeholders
        if (processedExpression.contains(" AND ")) {
            String[] parts = processedExpression.split(" AND ");

            ObjectNode andExpr = mapper.createObjectNode();
            andExpr.put("type", "AND");

            ArrayNode operands = mapper.createArrayNode();
            for (String part : parts) {
                operands.add(parseCompoundExpressionWithPlaceholders(part.trim(), placeholders));
            }

            andExpr.set("operands", operands);
            return andExpr;

        } else if (processedExpression.contains(" OR ")) {
            String[] parts = processedExpression.split(" OR ");

            ObjectNode orExpr = mapper.createObjectNode();
            orExpr.put("type", "OR");

            ArrayNode operands = mapper.createArrayNode();
            for (String part : parts) {
                operands.add(parseCompoundExpressionWithPlaceholders(part.trim(), placeholders));
            }

            orExpr.set("operands", operands);
            return orExpr;

        } else {
            return parseCompoundExpressionWithPlaceholders(processedExpression, placeholders);
        }
    }

    /**
     * Helper method to parse expressions with placeholders
     */
    private ObjectNode parseCompoundExpressionWithPlaceholders(String expr, Map<String, String> placeholders) {
        String trimmedExpr = expr.trim();
        ObjectNode fieldRef = mapper.createObjectNode();
        fieldRef.put("type", "FIELD");

        // Replace placeholder with original field name
        if (placeholders.containsKey(trimmedExpr)) {
            fieldRef.put("field", placeholders.get(trimmedExpr));
        } else {
            fieldRef.put("field", trimmedExpr);
        }

        return fieldRef;
    }

    /**
     * Extract field names from a compound expression
     */
    private List<String> extractFieldNames(String expression) {
        List<String> fieldNames = new ArrayList<>();
        Matcher matcher = FIELD_PATTERN.matcher(expression);

        while (matcher.find()) {
            String field = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            fieldNames.add(field);
        }

        return fieldNames;
    }
}
