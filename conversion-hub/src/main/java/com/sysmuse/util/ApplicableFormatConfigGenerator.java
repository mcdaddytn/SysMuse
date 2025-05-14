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
 * Updated to use SystemConfig exclusively and proper logging.
 */
public class ApplicableFormatConfigGenerator implements ConfigGenerator {

    private SystemConfig systemConfig;
    private String compoundExpressionsString;
    private List<String> compoundExpressions = new ArrayList<>();
    private ObjectMapper mapper;

    // Pattern to match quoted strings or unquoted words
    private static final Pattern FIELD_PATTERN = Pattern.compile("\"([^\"]+)\"|([^\\s\"]+)");

    // Default text suffixes - will be overridden by config if available
    private List<String> textSuffixes = new ArrayList<>();

    /**
     * Default constructor
     */
    public ApplicableFormatConfigGenerator() {
        this.mapper = new ObjectMapper();
        this.systemConfig = new SystemConfig();
        initializeTextSuffixes();
    }

    /**
     * Constructor with compound expressions string
     */
    public ApplicableFormatConfigGenerator(String compoundExpressionsString) {
        this.mapper = new ObjectMapper();
        this.systemConfig = new SystemConfig();
        loadCompoundExpressions(compoundExpressionsString);
        initializeTextSuffixes();
    }

    /**
     * Constructor with SystemConfig
     */
    public ApplicableFormatConfigGenerator(SystemConfig config) {
        this.systemConfig = config;
        this.mapper = new ObjectMapper();

        // Load expressions from system config
        Map<String, String> expressions = config.getExpressions();
        if (!expressions.isEmpty()) {
            loadExpressionsFromMap(expressions);
        } else {
            // Fall back to compound expressions string or file
            String expressionsStr = config.getCompoundExpressionsString();
            if (expressionsStr != null && !expressionsStr.isEmpty()) {
                loadCompoundExpressions(expressionsStr);
            }
        }

        // Initialize text suffixes from config
        initializeTextSuffixesFromConfig();
    }

    /**
     * Set system configuration
     */
    @Override
    public void setSystemConfig(SystemConfig config) {
        this.systemConfig = config;
        // Reload expressions and suffixes
        if (!config.getExpressions().isEmpty()) {
            loadExpressionsFromMap(config.getExpressions());
        }
        initializeTextSuffixesFromConfig();
    }

    /**
     * Load expressions directly from a map
     */
    private void loadExpressionsFromMap(Map<String, String> expressions) {
        compoundExpressions.clear();

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String expr = "\"" + entry.getKey() + "\":" + entry.getValue();
            compoundExpressions.add(expr);
        }

        LoggingUtil.info("Loaded " + compoundExpressions.size() + " expressions from config map");
    }

    /**
     * Load compound expressions from string or file
     */
    private void loadCompoundExpressions(String expressionsInput) {
        compoundExpressions.clear();

        if (expressionsInput != null && !expressionsInput.trim().isEmpty()) {
            // Check if it's a list file
            String configDirectory = systemConfig.getConfigDirectory();
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
                        LoggingUtil.info("Loaded " + compoundExpressions.size() +
                                " compound expressions from list file: " + listFile.getPath());
                    } catch (IOException e) {
                        LoggingUtil.warn("Error reading compound expressions list file: " + e.getMessage());
                        // If file reading fails, try to parse as comma-separated as fallback
                        parseCommaSeparatedExpressions(expressionsInput);
                    }
                } else {
                    LoggingUtil.warn("Compound expressions list file not found: " + listFile.getPath());
                    // If file not found, try to parse as comma-separated as fallback
                    parseCommaSeparatedExpressions(expressionsInput);
                }
            } else {
                // Check if it might be multi-line expression string
                if (expressionsInput.contains("\n")) {
                    // Split by newlines
                    String[] lines = expressionsInput.split("\n");
                    for (String line : lines) {
                        String trimmedLine = line.trim();
                        if (!trimmedLine.isEmpty()) {
                            compoundExpressions.add(trimmedLine);
                        }
                    }
                    LoggingUtil.info("Loaded " + compoundExpressions.size() +
                            " compound expressions from multi-line string");
                } else {
                    // It's a comma-separated list
                    parseCommaSeparatedExpressions(expressionsInput);
                }
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
            LoggingUtil.info("Loaded " + compoundExpressions.size() +
                    " compound expressions from comma-separated list");
        }
    }

    /**
     * Initialize text suffixes from config or use defaults
     */
    private void initializeTextSuffixes() {
        // Clear the list first
        textSuffixes.clear();

        // If no suffixes defined in config, use defaults
        if (textSuffixes.isEmpty()) {
            textSuffixes.add(" reasoning");
            textSuffixes.add(" snippets");
        }

        LoggingUtil.debug("Using default text suffixes: " + textSuffixes);
    }

    /**
     * Initialize text suffixes from SystemConfig
     */
    private void initializeTextSuffixesFromConfig() {
        // Clear the list first
        textSuffixes.clear();

        // Get suffixes from system config
        List<String> configSuffixes = systemConfig.getTextSuffixes();
        if (configSuffixes != null && !configSuffixes.isEmpty()) {
            textSuffixes.addAll(configSuffixes);
            LoggingUtil.info("Using text suffixes from system config: " + textSuffixes);
        } else {
            // Fall back to defaults
            initializeTextSuffixes();
        }
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
        LoggingUtil.debug("Found headers with suffixes:");
        for (String suffix : textSuffixes) {
            LoggingUtil.debug("  Suffix '" + suffix + "': " + fieldsWithSuffixes.get(suffix).size() + " headers");
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

                    LoggingUtil.debug("Found custom field name: '" + customFieldName +
                            "' for expression: " + expression);
                }
            }

            // Extract field names from the expression for logging
            List<String> fieldNames = extractFieldNames(expression);
            LoggingUtil.debug("Processing expression: " + expression);
            LoggingUtil.debug("  - Referenced fields: " + fieldNames);

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
            LoggingUtil.debug("  - Created derived field: " + derivedFieldName);

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

                    // Configure separator based on aggregation mode
                    String separator = "\n\n";  // Default
                    if (systemConfig != null) {
                        if (systemConfig.getTextAggregationMode() == SystemConfig.TextAggregationMode.NEWLINE) {
                            separator = systemConfig.getNewlineChar() + systemConfig.getNewlineChar();
                        }
                    }
                    aggregateConfig.put("separator", separator);

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
                        aggregateFieldName = customFieldName + " " + formattedSuffix;
                    } else {
                        aggregateFieldName = "Aggregated" + formattedSuffix + aggregateFieldIndex;
                    }

                    // Add to config
                    aggregateTextFields.set(aggregateFieldName, aggregateConfig);
                    LoggingUtil.debug("  - Created aggregate field: " + aggregateFieldName +
                            " with " + sourceFields.size() + " source fields: " + sourceFields);
                } else {
                    LoggingUtil.debug("  - No fields found with suffix '" + suffix +
                            "' for the fields referenced in the expression");
                }
            }

            aggregateFieldIndex++;
        }

        // Add to config if we have any fields
        if (derivedBooleanFields.size() > 0) {
            config.set("derivedBooleanFields", derivedBooleanFields);
            LoggingUtil.info("Added " + derivedBooleanFields.size() + " derived boolean fields to config");
        }

        if (aggregateTextFields.size() > 0) {
            config.set("aggregateTextFields", aggregateTextFields);
            LoggingUtil.info("Added " + aggregateTextFields.size() + " aggregate text fields to config");
        }
    }

    /**
     * Enhanced configuration generation for Applicable Format with comprehensive type inference
     */
    @Override
    public JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters from system config
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows if available
        int maxImportRows = systemConfig.getMaxImportRows();
        if (maxImportRows > 0) {
            parameters.put("maxImportRows", maxImportRows);
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Enhanced type inference with format detection
        ConversionRepository tempRepository = new ConversionRepository(systemConfig);
        tempRepository.setHeaders(headers);
        tempRepository.setFirstDataRow(firstDataRow);

        // Perform comprehensive type inference
        tempRepository.inferTypes(headers, firstDataRow);

        // Get the inferred types and detected formats
        Map<String, ConversionRepository.DataType> inferredTypes = tempRepository.getColumnTypes();
        Map<String, String> detectedFormats = tempRepository.getColumnFormats();

        // Add column configurations with inferred types and formats
        ObjectNode columns = mapper.createObjectNode();

        // First pass: Add all columns to the config with proper type inference
        boolean uniqueKeySet = false;
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();

            // Use the inferred type instead of the passed columnTypes map
            ConversionRepository.DataType inferredType = inferredTypes.getOrDefault(header,
                    ConversionRepository.DataType.STRING);
            columnConfig.put("type", inferredType.toString());

            // Add detected format for DATE and DATETIME types
            if ((inferredType == ConversionRepository.DataType.DATE ||
                    inferredType == ConversionRepository.DataType.DATETIME) &&
                    detectedFormats.containsKey(header)) {
                String detectedFormat = detectedFormats.get(header);
                columnConfig.put("format", detectedFormat);
                LoggingUtil.info("ApplicableFormat: Detected " + inferredType + " format for '" +
                        header + "': " + detectedFormat);
            }

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            // Set the first valid column as uniqueKey if no uniqueKey is set yet
            if (!uniqueKeySet) {
                columnConfig.put("uniqueKey", true);
                uniqueKeySet = true;
                LoggingUtil.info("Setting first column '" + header + "' as uniqueKey");
            }

            columns.set(header, columnConfig);
        }

        config.set("columns", columns);

        // Second pass: Identify field prefixes and group related fields
        // This logic remains the same as before...
        Map<String, List<String>> prefixToFields = groupFieldsByPrefix(headers);

        // Process derived boolean fields and suppressed fields
        ObjectNode suppressedFields = mapper.createObjectNode();

        // Identify boolean fields and their related text fields
        for (Map.Entry<String, List<String>> entry : prefixToFields.entrySet()) {
            String prefix = entry.getKey();
            List<String> fields = entry.getValue();

            if (fields.size() > 1) {
                // Check if the prefix itself is a boolean field (using inferred types)
                ConversionRepository.DataType prefixType = inferredTypes.getOrDefault(prefix,
                        ConversionRepository.DataType.STRING);

                if (prefixType == ConversionRepository.DataType.BOOLEAN) {
                    // The prefix field is a boolean - use it to suppress related fields
                    for (String field : fields) {
                        if (!field.equals(prefix)) {
                            suppressedFields.put(field, prefix);
                        }
                    }

                    LoggingUtil.debug("Boolean field '" + prefix + "' will suppress " +
                            (fields.size() - 1) + " related fields");
                }
            }
        }

        config.set("suppressedFields", suppressedFields);

        // Process compound expressions for text aggregation if provided
        processCompoundExpressions(config, headers);

        // Log comprehensive type inference summary
        logExtendedTypeInferenceSummary(inferredTypes, detectedFormats, prefixToFields);

        return config;
    }

    /**
     * Group fields by their prefixes for applicable format processing
     */
    private Map<String, List<String>> groupFieldsByPrefix(String[] headers) {
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

        return prefixToFields;
    }

    /**
     * Log extended type inference summary including field groupings
     */
    private void logExtendedTypeInferenceSummary(Map<String, ConversionRepository.DataType> inferredTypes,
                                                 Map<String, String> detectedFormats,
                                                 Map<String, List<String>> prefixToFields) {
        LoggingUtil.info("=== ApplicableFormat Type Inference Summary ===");

        // Type counts
        Map<ConversionRepository.DataType, Integer> typeCounts = new HashMap<>();
        for (ConversionRepository.DataType type : inferredTypes.values()) {
            typeCounts.put(type, typeCounts.getOrDefault(type, 0) + 1);
        }

        for (Map.Entry<ConversionRepository.DataType, Integer> entry : typeCounts.entrySet()) {
            LoggingUtil.info(entry.getKey() + ": " + entry.getValue() + " columns");
        }

        // Date/DateTime formats
        if (!detectedFormats.isEmpty()) {
            LoggingUtil.info("Date/DateTime formats detected:");
            for (Map.Entry<String, String> entry : detectedFormats.entrySet()) {
                LoggingUtil.info("  " + entry.getKey() + ": " + entry.getValue());
            }
        }

        // Field groupings
        LoggingUtil.info("Field groupings detected:");
        for (Map.Entry<String, List<String>> entry : prefixToFields.entrySet()) {
            if (entry.getValue().size() > 1) {
                LoggingUtil.info("  " + entry.getKey() + ": " + entry.getValue().size() + " related fields");
            }
        }

        LoggingUtil.info("============================================");
    }

    /**
     * Generate a configuration based on the "Applicable Format" structure
     */
    //@Override
    public JsonNode generateConfig_Old(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters from system config
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows if available
        int maxImportRows = systemConfig.getMaxImportRows();
        if (maxImportRows > 0) {
            parameters.put("maxImportRows", maxImportRows);
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Add column configurations
        ObjectNode columns = mapper.createObjectNode();

        // First pass: Add all columns to the config
        boolean uniqueKeySet = false;
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();

            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ?
                    columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);

            // Add format for DATE and DATETIME types
            if ("DATE".equals(type) || "DATETIME".equals(type)) {
                // Try to find the format that was used during type inference
                String format = findFormatForColumn(header, firstDataRow, headers, type);
                if (format != null) {
                    columnConfig.put("format", format);
                }
            }

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            // Set the first valid column as uniqueKey if no uniqueKey is set yet
            if (!uniqueKeySet) {
                columnConfig.put("uniqueKey", true);
                uniqueKeySet = true;
                LoggingUtil.info("Setting first column '" + header + "' as uniqueKey");
            }

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

                    LoggingUtil.debug("Boolean field '" + prefix + "' will suppress " +
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


    /**
     * Find the format that was used for a DATE or DATETIME column during type inference
     * Move these to a base class
     */
    private String findFormatForColumn(String header, String[] firstDataRow, String[] headers, String type) {
        // Find the value for this header in the first data row
        for (int i = 0; i < headers.length && i < firstDataRow.length; i++) {
            if (header.equals(headers[i])) {
                String value = firstDataRow[i];
                return findMatchingFormat(value, type);
            }
        }
        return null;
    }

    /**
     * Find the matching format for a value of the given type
     */
    private String findMatchingFormat(String value, String type) {
        if (systemConfig == null) {
            return null;
        }

        List<String> formats = "DATE".equals(type) ?
                systemConfig.getDateFormats() : systemConfig.getDateTimeFormats();

        for (String format : formats) {
            if (tryParseWithFormat(value, format, type)) {
                return format;
            }
        }
        return null;
    }

    /**
     * Try to parse a value with the given format and type
     */
    private boolean tryParseWithFormat(String value, String format, String type) {
        try {
            java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter.ofPattern(format);
            if ("DATE".equals(type)) {
                java.time.LocalDate.parse(value, formatter);
            } else {
                java.time.LocalDateTime.parse(value, formatter);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
