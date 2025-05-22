package com.sysmuse.util;

import java.io.*;
import java.util.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * JsonConverter - Handles importing from and exporting to JSON format
 * using Jackson library.
 * Updated to use SystemConfig exclusively and proper logging.
 */
public class JsonConverter extends BaseConverter {
    private ObjectMapper mapper;
    private boolean prettyPrint;
    private int indentSize;

    /**
     * Constructor with SystemConfig
     */
    public JsonConverter(SystemConfig config) {
        super(config);
        this.mapper = new ObjectMapper();

        // Get pretty print settings from config
        this.prettyPrint = config.isPrettyPrint();
        this.indentSize = config.getIndentSize();

        if (prettyPrint) {
            mapper.enable(SerializationFeature.INDENT_OUTPUT);
        }
    }

    /**
     * Import data from a JSON file into the repository
     */
    public void importToRepository(String jsonFilePath, ConversionRepository repository) throws IOException {
        LoggingUtil.info("Importing data from JSON file: " + jsonFilePath);

        // Parse the JSON file
        File jsonFile = new File(jsonFilePath);
        JsonNode rootNode = mapper.readTree(jsonFile);

        // Check if it's an array (data rows) or an object with a config and data structure
        if (rootNode.isArray()) {
            // Simple array of objects, each representing a row
            importSimpleJsonArray(rootNode, repository);
        } else if (rootNode.isObject()) {
            // Object with possible configuration and data
            importConfiguredJsonObject(rootNode, repository);
        } else {
            throw new IllegalArgumentException("Unsupported JSON structure: root node must be array or object");
        }

        LoggingUtil.info("Imported " + repository.getDataRows().size() + " rows from JSON file");
    }

    /**
     * Import a simple JSON array of objects, each representing a row
     */
    private void importSimpleJsonArray(JsonNode rootNode, ConversionRepository repository) {
        // Collect all field names first
        Set<String> allFields = new LinkedHashSet<>();
        for (JsonNode row : rootNode) {
            Iterator<String> fieldNames = row.fieldNames();
            while (fieldNames.hasNext()) {
                allFields.add(fieldNames.next());
            }
        }

        // Convert to array and set as headers
        String[] headers = allFields.toArray(new String[0]);
        repository.setHeaders(headers);

        // If we have at least one row, use it for type inference
        if (rootNode.size() > 0) {
            JsonNode firstRow = rootNode.get(0);
            String[] firstDataRow = new String[headers.length];

            for (int i = 0; i < headers.length; i++) {
                String field = headers[i];
                JsonNode valueNode = firstRow.get(field);
                firstDataRow[i] = (valueNode != null) ? valueNode.asText() : "";
            }

            repository.setFirstDataRow(firstDataRow);
            repository.inferTypes(headers, firstDataRow);
        }

        // Process each row and add to repository
        for (JsonNode rowNode : rootNode) {
            Map<String, Object> rowValues = new LinkedHashMap<>();

            // Extract values for all fields and convert based on repository types
            for (String field : headers) {
                JsonNode valueNode = rowNode.get(field);
                Object convertedValue = null;

                if (valueNode != null && !valueNode.isNull()) {
                    // Get the expected type from repository
                    ConversionRepository.DataType expectedType = repository.getColumnTypes()
                            .getOrDefault(field, ConversionRepository.DataType.STRING);

                    // Convert the JSON value to the appropriate Java type
                    convertedValue = convertJsonValueToJavaType(valueNode, expectedType, field, repository);
                }

                rowValues.put(field, convertedValue);
            }

            // Add the row to the repository
            repository.addDataRow(rowValues);
        }
    }

    /**
     * Convert a JSON value to the appropriate Java type based on the expected data type
     */
    private Object convertJsonValueToJavaType(JsonNode valueNode, ConversionRepository.DataType expectedType,
                                              String fieldName, ConversionRepository repository) {
        if (valueNode.isNull()) {
            return null;
        }

        switch (expectedType) {
            case INTEGER:
                if (valueNode.isInt()) {
                    return valueNode.asInt();
                } else {
                    return convertValue(valueNode.asText(), expectedType, fieldName, repository);
                }

            case FLOAT:
                if (valueNode.isDouble() || valueNode.isFloat()) {
                    return valueNode.asDouble();
                } else {
                    return convertValue(valueNode.asText(), expectedType, fieldName, repository);
                }

            case BOOLEAN:
                if (valueNode.isBoolean()) {
                    return valueNode.asBoolean();
                } else {
                    return convertValue(valueNode.asText(), expectedType, fieldName, repository);
                }

            case DATE:
                // Dates in JSON are typically stored as strings
                return convertValue(valueNode.asText(), expectedType, fieldName, repository);

            case DATETIME:
                // DateTimes in JSON are typically stored as strings
                return convertValue(valueNode.asText(), expectedType, fieldName, repository);

            case STRING:
            default:
                return valueNode.asText();
        }
    }

    /**
     * Import a JSON object with configuration and data
     */
    private void importConfiguredJsonObject(JsonNode rootNode, ConversionRepository repository) {
        // Extract configuration if present
        repository.extractConfigFromJSON(rootNode);

        // Check if there's a data array
        if (rootNode.has("data") && rootNode.get("data").isArray()) {
            JsonNode dataArray = rootNode.get("data");
            importSimpleJsonArray(dataArray, repository);
        } else {
            // If no data array, treat the entire object as a single row
            Map<String, Object> rowValues = new LinkedHashMap<>();

            Iterator<String> fieldNames = rootNode.fieldNames();
            List<String> headersList = new ArrayList<>();

            while (fieldNames.hasNext()) {
                String field = fieldNames.next();
                headersList.add(field);

                JsonNode valueNode = rootNode.get(field);
                if (valueNode.isInt()) {
                    rowValues.put(field, valueNode.asInt());
                } else if (valueNode.isLong()) {
                    rowValues.put(field, valueNode.asLong());
                } else if (valueNode.isDouble() || valueNode.isFloat()) {
                    rowValues.put(field, valueNode.asDouble());
                } else if (valueNode.isBoolean()) {
                    rowValues.put(field, valueNode.asBoolean());
                } else if (valueNode.isTextual()) {
                    rowValues.put(field, valueNode.asText());
                } else if (valueNode.isNull()) {
                    rowValues.put(field, null);
                } else {
                    // For complex types, convert to string
                    rowValues.put(field, valueNode.toString());
                }
            }

            // Set headers and add the row
            repository.setHeaders(headersList.toArray(new String[0]));
            repository.addDataRow(rowValues);
        }
    }

    /**
     * Export data from the repository to a JSON file
     */
    public void exportFromRepository(ConversionRepository repository, String jsonFilePath) throws IOException {
        LoggingUtil.info("Exporting data to JSON file: " + jsonFilePath);

        // Create the root array node
        ArrayNode rootArray = mapper.createArrayNode();

        // Get visible fields in order
        List<String> visibleFields = repository.getVisibleFieldNames();
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();

        // Add each data row to the array
        for (Map<String, Object> row : repository.getDataRows()) {
            ObjectNode jsonRow = mapper.createObjectNode();

            // Add fields in the specified order
            for (String field : visibleFields) {
                if (row.containsKey(field)) {
                    Object value = row.get(field);
                    ConversionRepository.DataType type = columnTypes.getOrDefault(field,
                            ConversionRepository.DataType.STRING);
                    addValueToNode(jsonRow, field, value, type, repository);
                }
            }

            rootArray.add(jsonRow);
        }

        // Write to file
        mapper.writeValue(new File(jsonFilePath), rootArray);

        LoggingUtil.info("Exported " + repository.getDataRows().size() +
                " rows to JSON file: " + jsonFilePath);
    }

    /**
     * Export filtered subsets of data from the repository to multiple JSON files
     * using the SubsetProcessor to handle subset filtering and configuration
     */
    public void exportSubsetsFromRepository(ConversionRepository repository, String baseJsonFilePath) throws IOException {
        // Create the subset processor with system config
        SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);

        if (!subsetProcessor.hasSubsets()) {
            LoggingUtil.info("No subsets configured for export.");
            return;
        }

        LoggingUtil.info("Exporting filtered subsets to JSON files");

        // For tracking unfiltered records
        Set<Map<String, Object>> unfilteredRows = new HashSet<>(repository.getDataRows());
        // For tracking exported keys (for exclusive subsets)
        Set<String> exportedKeys = new HashSet<>();

        // Get visible fields in order
        List<String> visibleFields = getVisibleFieldsWithFallback(repository);
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();

        // Process each filter
        Map<String, String> filterToSuffix = subsetProcessor.getFilterToSuffix();
        for (Map.Entry<String, String> entry : filterToSuffix.entrySet()) {
            String filterField = entry.getKey();
            String suffix = entry.getValue();

            // Validate filter field exists
            if (!validateFilterField(repository, filterField)) {
                continue;
            }

            // Create output file path with suffix
            String outputPath = subsetProcessor.getOutputPathWithSuffix(baseJsonFilePath, suffix, ".json");
            LoggingUtil.info("Exporting subset for filter '" + filterField + "' to: " + outputPath);

            // Create a JSON array for this subset
            ArrayNode subsetArray = mapper.createArrayNode();
            int matchCount = 0;

            // Filter rows based on the filter field
            for (Map<String, Object> row : repository.getDataRows()) {
                boolean matches = subsetProcessor.rowMatchesFilter(row, filterField);
                boolean keyAlreadyExported = subsetProcessor.isRowKeyInExportedSet(row, exportedKeys);

                if (matches && !keyAlreadyExported) {
                    // Create JSON object for this row
                    ObjectNode jsonRow = mapper.createObjectNode();

                    // Add fields in the specified order
                    for (String field : visibleFields) {
                        if (row.containsKey(field)) {
                            Object value = row.get(field);
                            ConversionRepository.DataType type = columnTypes.getOrDefault(field,
                                    ConversionRepository.DataType.STRING);
                            addValueToNode(jsonRow, field, value, type, repository);
                        }
                    }

                    // Add to subset array
                    subsetArray.add(jsonRow);
                    matchCount++;

                    // Remove from unfiltered set
                    unfilteredRows.remove(row);
                    // Add to exported keys set if exclusive subsets are enabled
                    subsetProcessor.addRowKeyToExportedSet(row, exportedKeys);
                }
            }

            // Write to file
            mapper.writeValue(new File(outputPath), subsetArray);

            LoggingUtil.info("Exported " + matchCount + " rows to subset file: " + outputPath);
        }

        // If we need to output remaining unfiltered rows
        exportUnfilteredRows(repository, subsetProcessor, visibleFields, columnTypes,
                baseJsonFilePath, unfilteredRows);
    }


    /**
     * Get visible fields with fallback to all fields if needed
     */
    private List<String> getVisibleFieldsWithFallback(ConversionRepository repository) {
        List<String> visibleFields;
        try {
            visibleFields = repository.getVisibleFieldNames();
        } catch (NullPointerException e) {
            LoggingUtil.warn("Unable to get visible field names. Using all fields from first row.");
            // Fallback to the fields from the first data row if available
            visibleFields = new ArrayList<>();
            if (!repository.getDataRows().isEmpty()) {
                visibleFields.addAll(repository.getDataRows().get(0).keySet());
            }
        }

        // Check if we have fields to export
        if (visibleFields.isEmpty()) {
            LoggingUtil.warn("No fields to export. Checking if data rows exist to extract field names.");
            if (!repository.getDataRows().isEmpty()) {
                visibleFields.addAll(repository.getDataRows().get(0).keySet());
            } else {
                LoggingUtil.error("No data to export and no field names available.");
                return new ArrayList<>();
            }
        }

        return visibleFields;
    }

    /**
     * Validate filter field exists in repository data
     */
    private boolean validateFilterField(ConversionRepository repository, String filterField) {
        int rowsWithField = 0;
        int rowsWithTrueValue = 0;
        boolean filterExists = false;

        SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);

        for (Map<String, Object> row : repository.getDataRows()) {
            if (row.containsKey(filterField)) {
                filterExists = true;
                rowsWithField++;

                // Check if this field would evaluate to true
                if (subsetProcessor.rowMatchesFilter(row, filterField)) {
                    rowsWithTrueValue++;
                }
            }
        }

        if (!filterExists) {
            LoggingUtil.warn("Filter field '" + filterField + "' not found in repository data, skipping subset");
            return false;
        }

        LoggingUtil.debug("Filter field '" + filterField + "' exists in " + rowsWithField +
                " rows out of " + repository.getDataRows().size() +
                ". " + rowsWithTrueValue + " rows have 'true' values.");

        return true;
    }

    /**
     * Export unfiltered rows to default file
     */
    private void exportUnfilteredRows(ConversionRepository repository, SubsetProcessor subsetProcessor,
                                      List<String> visibleFields, Map<String, ConversionRepository.DataType> columnTypes,
                                      String baseJsonFilePath, Set<Map<String, Object>> unfilteredRows) throws IOException {

        if (unfilteredRows.isEmpty()) {
            return;
        }

        String defaultSuffix = systemConfig.getOutputSuffix();
        String unfilteredPath = subsetProcessor.getOutputPathWithSuffix(baseJsonFilePath, defaultSuffix, ".json");

        LoggingUtil.info("Exporting " + unfilteredRows.size() + " unfiltered rows to: " + unfilteredPath);

        // Create JSON array for unfiltered rows
        ArrayNode unfilteredArray = mapper.createArrayNode();

        // Add each unfiltered row
        for (Map<String, Object> row : unfilteredRows) {
            ObjectNode jsonRow = mapper.createObjectNode();

            // Add fields in the specified order
            for (String field : visibleFields) {
                if (row.containsKey(field)) {
                    Object value = row.get(field);
                    ConversionRepository.DataType type = columnTypes.getOrDefault(field,
                            ConversionRepository.DataType.STRING);
                    addValueToNode(jsonRow, field, value, type, repository);
                }
            }

            unfilteredArray.add(jsonRow);
        }

        // Write to file
        mapper.writeValue(new File(unfilteredPath), unfilteredArray);
    }

    /**
     * Export both data and configuration from the repository to a JSON file
     */
    public void exportWithConfigToRepository(ConversionRepository repository, String jsonFilePath) throws IOException {
        LoggingUtil.info("Exporting data with configuration to JSON file: " + jsonFilePath);

        // Create the root object node
        ObjectNode rootNode = mapper.createObjectNode();

        // Add parameters section
        ObjectNode paramsNode = mapper.createObjectNode();
        for (Map.Entry<String, Object> entry : repository.getConfigParameters().entrySet()) {
            addValueToNode(paramsNode, entry.getKey(), entry.getValue(),
                    ConversionRepository.DataType.STRING, repository);
        }
        rootNode.set("parameters", paramsNode);

        // Add columns section
        ObjectNode columnsNode = mapper.createObjectNode();
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();
        Map<String, Boolean> columnVisibility = repository.getColumnVisibility();
        Map<String, String> columnFormats = repository.getColumnFormats();

        for (String columnName : repository.getHeaders()) {
            if (columnName != null && !columnName.isEmpty()) {
                ObjectNode columnConfig = mapper.createObjectNode();

                // Add type if available
                if (columnTypes.containsKey(columnName)) {
                    columnConfig.put("type", columnTypes.get(columnName).toString());
                } else {
                    columnConfig.put("type", "STRING");
                }

                // Add format for DATE and DATETIME types
                if (columnFormats.containsKey(columnName)) {
                    columnConfig.put("format", columnFormats.get(columnName));
                }

                // Add visibility if available
                if (columnVisibility.containsKey(columnName)) {
                    columnConfig.put("visible", columnVisibility.get(columnName));
                } else {
                    columnConfig.put("visible", true);
                }

                columnsNode.set(columnName, columnConfig);
            }
        }
        rootNode.set("columns", columnsNode);

        // Add derived boolean fields if any
        if (!repository.getDerivedBooleanFields().isEmpty()) {
            ObjectNode derivedNode = mapper.createObjectNode();
            for (Map.Entry<String, JsonNode> entry : repository.getDerivedBooleanFields().entrySet()) {
                derivedNode.set(entry.getKey(), entry.getValue());
            }
            rootNode.set("derivedBooleanFields", derivedNode);
        }

        // Add aggregate text fields if any
        if (!repository.getAggregateTextFields().isEmpty()) {
            ObjectNode aggregateNode = mapper.createObjectNode();
            for (Map.Entry<String, JsonNode> entry : repository.getAggregateTextFields().entrySet()) {
                aggregateNode.set(entry.getKey(), entry.getValue());
            }
            rootNode.set("aggregateTextFields", aggregateNode);
        }

        // Add suppressed fields if any
        if (!repository.getSuppressedFields().isEmpty()) {
            ObjectNode suppressedNode = mapper.createObjectNode();
            for (Map.Entry<String, String> entry : repository.getSuppressedFields().entrySet()) {
                suppressedNode.put(entry.getKey(), entry.getValue());
            }
            rootNode.set("suppressedFields", suppressedNode);
        }

        // Add data array
        ArrayNode dataArray = mapper.createArrayNode();
        List<String> visibleFields = repository.getVisibleFieldNames();
        //Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();

        for (Map<String, Object> row : repository.getDataRows()) {
            ObjectNode jsonRow = mapper.createObjectNode();

            // Add fields in the specified order
            for (String field : visibleFields) {
                if (row.containsKey(field)) {
                    Object value = row.get(field);
                    ConversionRepository.DataType type = columnTypes.getOrDefault(field,
                            ConversionRepository.DataType.STRING);
                    addValueToNode(jsonRow, field, value, type, repository);
                }
            }

            dataArray.add(jsonRow);
        }
        rootNode.set("data", dataArray);

        // Write to file
        mapper.writeValue(new File(jsonFilePath), rootNode);

        LoggingUtil.info("Exported " + repository.getDataRows().size() +
                " rows with configuration to JSON file: " + jsonFilePath);
    }

    /**
     * Add a value to a Jackson ObjectNode with proper type conversion and date/datetime formatting
     */
    private void addValueToNode(ObjectNode node, String fieldName, Object value,
                                ConversionRepository.DataType type, ConversionRepository repository) {
        if (value == null) {
            node.putNull(fieldName);
            return;
        }

        switch (type) {
            case DATE:
                if (value instanceof LocalDate) {
                    // Format the date using the repository's column format or default
                    String formattedDate = formatDateForOutput((LocalDate) value, fieldName, repository);
                    node.put(fieldName, formattedDate);
                } else {
                    node.put(fieldName, value.toString());
                }
                break;

            case DATETIME:
                if (value instanceof LocalDateTime) {
                    // Format the datetime using the repository's column format or default
                    String formattedDateTime = formatDateTimeForOutput((LocalDateTime) value, fieldName, repository);
                    node.put(fieldName, formattedDateTime);
                } else {
                    node.put(fieldName, value.toString());
                }
                break;

            case INTEGER:
                if (value instanceof Integer) {
                    node.put(fieldName, (Integer) value);
                } else {
                    node.put(fieldName, Integer.parseInt(value.toString()));
                }
                break;

            case FLOAT:
                if (value instanceof Double || value instanceof Float) {
                    node.put(fieldName, ((Number) value).doubleValue());
                } else {
                    node.put(fieldName, Double.parseDouble(value.toString()));
                }
                break;

            case BOOLEAN:
                if (value instanceof Boolean) {
                    node.put(fieldName, (Boolean) value);
                } else {
                    node.put(fieldName, Boolean.parseBoolean(value.toString()));
                }
                break;

            case STRING:
            default:
                if (value instanceof String) {
                    node.put(fieldName, (String) value);
                } else if (value instanceof JsonNode) {
                    node.set(fieldName, (JsonNode) value);
                } else {
                    // Default to string for other types
                    node.put(fieldName, value.toString());
                }
                break;
        }
    }

    /**
     * Legacy method for backwards compatibility - uses generic typing
     */
    private void addValueToNode(ObjectNode node, String fieldName, Object value) {
        if (value == null) {
            node.putNull(fieldName);
        } else if (value instanceof String) {
            node.put(fieldName, (String) value);
        } else if (value instanceof Integer) {
            node.put(fieldName, (Integer) value);
        } else if (value instanceof Long) {
            node.put(fieldName, (Long) value);
        } else if (value instanceof Double) {
            node.put(fieldName, (Double) value);
        } else if (value instanceof Float) {
            node.put(fieldName, (Float) value);
        } else if (value instanceof Boolean) {
            node.put(fieldName, (Boolean) value);
        } else if (value instanceof JsonNode) {
            node.set(fieldName, (JsonNode) value);
        } else if (value instanceof LocalDate) {
            // Default formatting for LocalDate
            node.put(fieldName, value.toString());
        } else if (value instanceof LocalDateTime) {
            // Default formatting for LocalDateTime
            node.put(fieldName, value.toString());
        } else {
            // Default to string for other types
            node.put(fieldName, value.toString());
        }
    }
}
