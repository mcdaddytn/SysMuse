package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
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
    //gm: added
    private String configDirectory;
    private List<String> compoundExpressions = new ArrayList<>();
    private Properties properties;
    private ObjectMapper mapper;

    // Pattern to match quoted strings or unquoted words
    private static final Pattern FIELD_PATTERN = Pattern.compile("\"([^\"]+)\"|([^\\s\"]+)");

    // Default text suffixes - will be overridden by properties if available
    private List<String> textSuffixes = new ArrayList<>();

    /**
     * Default constructor
     */
    public ApplicableFormatConfigGenerator() {
        this.properties = new Properties();
        this.mapper = new ObjectMapper();
        initializeTextSuffixes();
    }

    /**
     * Constructor with compound expressions string
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString) {
        this.properties = new Properties();
        this.mapper = new ObjectMapper();
        loadCompoundExpressions(compoundExpressionsString);
        initializeTextSuffixes();
    }

    /**
     * Constructor with properties
     */
    public ApplicableFormatConfigGenerator(Properties properties) {
        this.properties = properties;
        this.mapper = new ObjectMapper();
        String compoundExpressionsString = properties.getProperty("applicable.format.compound.expressions");
        this.configDirectory = properties.getProperty("config.directory", "");
        loadCompoundExpressions(compoundExpressionsString);
        initializeTextSuffixes();
    }

    /**
     * Constructor with compound expressions and properties
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString, Properties properties) {
        this.properties = properties;
        this.mapper = new ObjectMapper();
        this.configDirectory = properties.getProperty("config.directory", "");
        loadCompoundExpressions(compoundExpressionsString);
        initializeTextSuffixes();
    }

    /**
     * Load compound expressions from string or file
     */
    private void loadCompoundExpressions(String expressionsInput) {
        compoundExpressions.clear();

        if (expressionsInput != null && !expressionsInput.trim().isEmpty()) {
            // Check if it's a list file
            if (expressionsInput.trim().endsWith(".list") && !configDirectory.isEmpty()) {
                // It's a list file - read from the config directory
                File listFile = new File(Paths.get(configDirectory, expressionsInput).toString());
                if (listFile.exists() && listFile.isFile()) {
                    try {
                        List<String> lines = Files.readAllLines(listFile.toPath());
                        for (String line : lines) {
                            String trimmedLine = line.trim();
                            if (!trimmedLine.isEmpty()) {
                                compoundExpressions.add(trimmedLine);
                            }
                        }
                        System.out.println("Loaded " + compoundExpressions.size() +
                                " compound expressions from list file: " + listFile.getPath());
                    } catch (IOException e) {
                        System.out.println("Error reading compound expressions list file: " + e.getMessage());
                        // If file reading fails, try to parse as comma-separated as fallback
                        parseCommaSeparatedExpressions(expressionsInput);
                    }
                } else {
                    System.out.println("Compound expressions list file not found: " + listFile.getPath());
                    // If file not found, try to parse as comma-separated as fallback
                    parseCommaSeparatedExpressions(expressionsInput);
                }
            } else {
                // It's a comma-separated list
                parseCommaSeparatedExpressions(expressionsInput);
            }
        }
    }

    /**
     * Parse comma-separated expressions
     */
    private void parseCommaSeparatedExpressions(String expressionsInput) {
        if (expressionsInput != null && !expressionsInput.trim().isEmpty()) {
            String[] expressions = expressionsInput.split(",");
            for (String expr : expressions) {
                String trimmedExpr = expr.trim();
                if (!trimmedExpr.isEmpty()) {
                    compoundExpressions.add(trimmedExpr);
                }
            }
            System.out.println("Loaded " + compoundExpressions.size() +
                    " compound expressions from comma-separated list");
        }
    }

    /**
     * Initialize text suffixes from properties or use defaults
     */
    private void initializeTextSuffixes() {
        // Clear the list first
        textSuffixes.clear();

        // Try to get text suffixes from properties
        String suffixesProperty = properties.getProperty("applicable.format.text.suffixes");

        if (suffixesProperty != null && !suffixesProperty.trim().isEmpty()) {
            // Split by comma
            String[] suffixArray = suffixesProperty.split(",");
            for (String suffix : suffixArray) {
                // Just trim the suffix itself, but preserve the leading space if present
                String processedSuffix = suffix.trim();
                // If no space at the beginning, add one
                if (!processedSuffix.startsWith(" ")) {
                    processedSuffix = " " + processedSuffix;
                }
                if (!processedSuffix.isEmpty()) {
                    textSuffixes.add(processedSuffix);
                }
            }
        }

        // If no suffixes defined in properties, use defaults
        if (textSuffixes.isEmpty()) {
            textSuffixes.add(" reasoning");
            textSuffixes.add(" snippets");
        }

        System.out.println("Using text suffixes: " + textSuffixes);
    }

    /**
     * Set properties
     */
    public void setProperties(Properties properties) {
        this.properties = properties;
        // Reinitialize text suffixes when properties change
        initializeTextSuffixes();
    }

    /**
     * Process compound expressions to create derived boolean fields and aggregate text fields
     */
    private void processCompoundExpressions(ObjectNode config, String[] headers) {
        if (compoundExpressions.isEmpty()) {
            return;  // No expressions to process
        }

        ObjectNode derivedBooleanFields = mapper.createObjectNode();
        ObjectNode aggregateTextFields = mapper.createObjectNode();

        // Find all actual header combinations that match our suffixes
        Map<String, Set<String>> fieldsWithSuffixes = new HashMap<>();

        // Initialize the map for each suffix
        for (String suffix : textSuffixes) {
            fieldsWithSuffixes.put(suffix, new HashSet<>());
        }

        // Populate the map with headers that have our suffixes
        for (String header : headers) {
            for (String suffix : textSuffixes) {
                if (header.endsWith(suffix)) {
                    fieldsWithSuffixes.get(suffix).add(header);
                }
            }
        }

        // Debug
        System.out.println("Found headers with suffixes:");
        for (String suffix : textSuffixes) {
            System.out.println("  Suffix '" + suffix + "': " + fieldsWithSuffixes.get(suffix).size() + " headers");
        }

        int aggregateFieldIndex = 1;
        for (String expressionLine : compoundExpressions) {
            // Check if this expression has a custom name (using colon delimiter)
            String customFieldName = null;
            String expression = expressionLine;

            // Look for the pattern "CustomName":"Expression"
            if (expressionLine.contains(":")) {
                // Find the position of the first colon
                int colonPos = expressionLine.indexOf(":");

                // Extract the custom name part (before the colon)
                String potentialCustomName = expressionLine.substring(0, colonPos).trim();

                // If the custom name is quoted, remove the quotes
                if (potentialCustomName.startsWith("\"") && potentialCustomName.endsWith("\"")) {
                    potentialCustomName = potentialCustomName.substring(1, potentialCustomName.length() - 1);
                }

                // If we have a valid custom name, use it
                if (!potentialCustomName.isEmpty()) {
                    customFieldName = potentialCustomName;

                    // Extract the actual expression part (after the colon)
                    expression = expressionLine.substring(colonPos + 1).trim();

                    System.out.println("Found custom field name: '" + customFieldName +
                            "' for expression: " + expression);
                }
            }

            // Extract field names from the expression for logging
            List<String> fieldNames = extractFieldNames(expression);
            System.out.println("Processing expression: " + expression);
            System.out.println("  - Referenced fields: " + fieldNames);

            // Parse the expression into a boolean expression JSON
            ObjectNode booleanExpression = parseCompoundExpression(expression);

            // Create derived boolean field name - use custom name if available
            String derivedFieldName;
            if (customFieldName != null) {
                derivedFieldName = customFieldName;
            } else {
                derivedFieldName = "DerivedExpression" + aggregateFieldIndex;
            }

            // Add derived boolean field to config
            derivedBooleanFields.set(derivedFieldName, booleanExpression);
            System.out.println("  - Created derived field: " + derivedFieldName);

            // For each suffix type, create an aggregate text field
            for (String suffix : textSuffixes) {
                // Find all related fields with this suffix
                List<String> sourceFields = new ArrayList<>();

                // Get the set of all headers with this suffix
                Set<String> headersWithSuffix = fieldsWithSuffixes.get(suffix);

                // Check which of our field names appear in the headers with this suffix
                for (String fieldName : fieldNames) {
                    // Look for exact matches with this field name and suffix
                    // For example, if fieldName is "Subscribed Newsletter" and suffix is " reasoning",
                    // we're looking for "Subscribed Newsletter reasoning" exactly
                    String exactFieldWithSuffix = fieldName + suffix;

                    if (Arrays.asList(headers).contains(exactFieldWithSuffix)) {
                        sourceFields.add(exactFieldWithSuffix);
                        continue;
                    }

                    // If no exact match, try a different approach: look for headers that
                    // end with the suffix and contain the field name
                    for (String header : headersWithSuffix) {
                        // Get the part before the suffix
                        String headerPrefix = header.substring(0, header.length() - suffix.length());

                        // Check if this matches our field name
                        if (headerPrefix.equals(fieldName)) {
                            sourceFields.add(header);
                            break;
                        }
                    }
                }

                // Only create aggregate field if we found source fields
                if (!sourceFields.isEmpty()) {
                    ObjectNode aggregateConfig = mapper.createObjectNode();

                    // Set the condition to the derived field name
                    aggregateConfig.put("condition", derivedFieldName);
                    aggregateConfig.put("visible", true);

                    // Add source fields as an array
                    ArrayNode sourcesArray = mapper.createArrayNode();
                    for (String source : sourceFields) {
                        sourcesArray.add(source);
                    }
                    aggregateConfig.set("sourceFields", sourcesArray);

                    // Set separator (default to double newline)
                    aggregateConfig.put("separator", "\n\n");

                    // Format the suffix for the aggregate field name
                    // Remove leading space and capitalize first letter
                    String formattedSuffix = suffix.trim();
                    if (!formattedSuffix.isEmpty()) {
                        formattedSuffix = formattedSuffix.substring(0, 1).toUpperCase() +
                                formattedSuffix.substring(1);
                    }

                    // Create aggregate field name - use custom name if available
                    String aggregateFieldName;
                    if (customFieldName != null) {
                        //aggregateFieldName = customFieldName + formattedSuffix;
                        aggregateFieldName = customFieldName + " " + formattedSuffix;
                    } else {
                        aggregateFieldName = "Aggregated" + formattedSuffix + aggregateFieldIndex;
                    }

                    // Add to config
                    aggregateTextFields.set(aggregateFieldName, aggregateConfig);
                    System.out.println("  - Created aggregate field: " + aggregateFieldName +
                            " with " + sourceFields.size() + " source fields: " + sourceFields);
                } else {
                    System.out.println("  - No fields found with suffix '" + suffix +
                            "' for the fields referenced in the expression");
                }
            }

            aggregateFieldIndex++;
        }

        // Add to config if we have any fields
        if (derivedBooleanFields.size() > 0) {
            config.set("derivedBooleanFields", derivedBooleanFields);
            System.out.println("Added " + derivedBooleanFields.size() + " derived boolean fields to config");
        }

        if (aggregateTextFields.size() > 0) {
            config.set("aggregateTextFields", aggregateTextFields);
            System.out.println("Added " + aggregateTextFields.size() + " aggregate text fields to config");
        }
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

        // First pass: Add all columns to the config
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
        }

        config.set("columns", columns);

        // Second pass: Identify field prefixes and group related fields
        // Map to store field prefixes
        Map<String, List<String>> prefixToFields = new LinkedHashMap<>();

        // First, identify all base fields (without suffixes)
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue;
            }

            boolean hasSuffix = false;
            for (String suffix : textSuffixes) {
                if (header.endsWith(suffix)) {
                    hasSuffix = true;
                    break;
                }
            }

            if (!hasSuffix) {
                // This is a base field - add it as a prefix
                if (!prefixToFields.containsKey(header)) {
                    prefixToFields.put(header, new ArrayList<>());
                }
                prefixToFields.get(header).add(header);
            }
        }

        // Now add fields with suffixes to their corresponding prefix groups
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue;
            }

            for (String suffix : textSuffixes) {
                if (header.endsWith(suffix)) {
                    String prefix = header.substring(0, header.lastIndexOf(suffix));

                    // If the prefix doesn't exist as a key yet, add it
                    if (!prefixToFields.containsKey(prefix)) {
                        prefixToFields.put(prefix, new ArrayList<>());
                    }

                    // Add this field to its prefix group
                    prefixToFields.get(prefix).add(header);
                    break;
                }
            }
        }

        // Process derived boolean fields and suppressed fields
        ObjectNode suppressedFields = mapper.createObjectNode();

        // Identify boolean fields and their related text fields
        for (Map.Entry<String, List<String>> entry : prefixToFields.entrySet()) {
            String prefix = entry.getKey();
            List<String> fields = entry.getValue();

            if (fields.size() > 1) {
                // Check if the prefix itself is a boolean field
                if (columnTypes.containsKey(prefix) &&
                        columnTypes.get(prefix).toString().equals("BOOLEAN")) {

                    // The prefix field is a boolean - use it to suppress related fields
                    for (String field : fields) {
                        if (!field.equals(prefix)) {
                            suppressedFields.put(field, prefix);
                        }
                    }

                    System.out.println("Boolean field '" + prefix + "' will suppress " +
                            (fields.size() - 1) + " related fields");
                }
            }
        }

        config.set("suppressedFields", suppressedFields);

        // Process compound expressions for text aggregation if provided
        processCompoundExpressions(config, headers);

        return config;
    }

    /**
     * Check if a field has any of the known suffixes
     */
    private boolean hasSuffix(String fieldName) {
        for (String suffix : textSuffixes) {
            if (fieldName.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parse a compound expression string into a JsonNode representing the boolean expression
     */
    private ObjectNode parseCompoundExpression(String expression) {
        // Detect logical operators in the expression
        if (expression.contains(" AND ")) {
            String[] parts = expression.split(" AND ");

            ObjectNode andExpr = mapper.createObjectNode();
            andExpr.put("type", "AND");

            ArrayNode operands = mapper.createArrayNode();
            for (String part : parts) {
                operands.add(parseSubExpression(part.trim()));
            }

            andExpr.set("operands", operands);
            return andExpr;

        } else if (expression.contains(" OR ")) {
            String[] parts = expression.split(" OR ");

            ObjectNode orExpr = mapper.createObjectNode();
            orExpr.put("type", "OR");

            ArrayNode operands = mapper.createArrayNode();
            for (String part : parts) {
                operands.add(parseSubExpression(part.trim()));
            }

            orExpr.set("operands", operands);
            return orExpr;

        } else {
            // It's a simple field reference
            return parseFieldReference(expression.trim());
        }
    }

    /**
     * Parse a field reference or quoted field name
     */
    private ObjectNode parseFieldReference(String fieldExpr) {
        ObjectNode fieldRef = mapper.createObjectNode();
        fieldRef.put("type", "FIELD");

        // Check if it's a quoted field name
        if (fieldExpr.startsWith("\"") && fieldExpr.endsWith("\"")) {
            // Remove the quotes
            String fieldName = fieldExpr.substring(1, fieldExpr.length() - 1);
            fieldRef.put("field", fieldName);
        } else {
            // Just use as is
            fieldRef.put("field", fieldExpr);
        }

        return fieldRef;
    }

    /**
     * Parse a sub-expression which could be a field reference or a quoted field
     */
    private JsonNode parseSubExpression(String expr) {
        // This sub-expression could be a quoted field name or a simple field reference
        return parseFieldReference(expr);
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