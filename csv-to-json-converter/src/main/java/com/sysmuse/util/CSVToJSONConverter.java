package com.sysmuse.util;

import java.io.*;
import java.util.*;
import java.nio.file.*;
import org.json.simple.*;
import org.json.simple.parser.*;
import java.util.regex.*;
import java.util.Properties;

/**
 * CSVToJSONConverter - Converts CSV files to JSON format with type inference,
 * derived fields, and field transformations based on configuration.
 */
public class CSVToJSONConverter {
    
    // Supported data types
    private enum DataType {
        STRING, INTEGER, FLOAT, BOOLEAN
    }
    
    // Map of column names to their indices
    private Map<String, Integer> columnMap = new HashMap<>();
    
    // Map of column names to their data types (from config or inferred)
    private Map<String, DataType> columnTypes = new HashMap<>();
    
    // Map for derived boolean fields (name -> expression)
    private Map<String, JSONObject> derivedBooleanFields = new HashMap<>();
    
    // Map for text aggregation fields (name -> configuration)
    private Map<String, JSONObject> aggregateTextFields = new HashMap<>();
    
    // Map for conditional text suppression (field to suppress -> condition field)
    private Map<String, String> suppressedFields = new HashMap<>();
    
    // The directory containing the input file
    private String inputDirectory;
    
    // The directory containing configuration files
    private String configDirectory;
    
    // Configuration parameters
    private Map<String, Object> configParameters = new HashMap<>();
    
    // Properties
    private Properties properties;
    
    // Main entry point
    public static void main(String[] args) {
        CSVToJSONConverter converter = new CSVToJSONConverter();
        try {
            // Load default properties
            Properties defaultProps = new Properties();
            try (InputStream in = CSVToJSONConverter.class.getClassLoader().getResourceAsStream("application.properties")) {
                if (in != null) {
                    defaultProps.load(in);
                    System.out.println("Loaded default properties");
                } else {
                    System.out.println("Default properties file not found, using built-in defaults");
                }
            } catch (IOException e) {
                System.out.println("Error loading default properties: " + e.getMessage());
            }
            
            // Set config directory from arguments or properties
            String configDir = null;
            if (args.length > 0) {
                configDir = args[0];
                System.out.println("Using config directory from arguments: " + configDir);
                
                // Check if the directory exists
                if (!Files.exists(Paths.get(configDir))) {
                    System.out.println("Warning: Config directory does not exist: " + configDir);
                    System.out.println("Will use default config directory");
                    configDir = defaultProps.getProperty("config.directory", "config");
                }
            } else {
                configDir = defaultProps.getProperty("config.directory", "config");
                System.out.println("Using default config directory: " + configDir);
            }
            converter.setConfigDirectory(configDir);
            converter.setProperties(defaultProps);
            
            // Check if CSV file is provided
            String csvFilePath = null;
            if (args.length > 1) {
                csvFilePath = args[1];
            } else {
                System.out.println("Usage: CSVToJSONConverter [config_directory] <csv_file> [config_json_file]");
                System.exit(1);
            }
            
            // Check if config file is provided
            String configFilePath = null;
            if (args.length > 2) {
                configFilePath = args[2];
            } else {
                // Use default config file from the config directory
                String defaultConfigFilename = defaultProps.getProperty("config.filename", "config.json");
                Path configPath = Paths.get(configDir, defaultConfigFilename);
                if (Files.exists(configPath)) {
                    configFilePath = configPath.toString();
                    System.out.println("Using default config file: " + configFilePath);
                } else {
                    System.out.println("No config file specified and default config not found at: " + configPath);
                    System.out.println("Will infer types from data");
                }
            }
            
            // Start conversion
            converter.convert(csvFilePath, configFilePath);
        } catch (Exception e) {
            System.err.println("Error during conversion: " + e.getMessage());
            e.printStackTrace();
        }
    }
    
    /**
     * Constructor
     */
    public CSVToJSONConverter() {
        this.properties = new Properties();
    }
    
    /**
     * Set the configuration directory
     */
    public void setConfigDirectory(String configDirectory) {
        this.configDirectory = configDirectory;
    }
    
    /**
     * Set properties
     */
    public void setProperties(Properties properties) {
        this.properties = properties;
    }
    
    /**
     * Main conversion method
     */
    public void convert(String csvFilePath, String configFilePath) throws Exception {
        System.out.println("Starting conversion process for: " + csvFilePath);
        
        // Store directory for output files
        File csvFile = new File(csvFilePath);
        inputDirectory = csvFile.getParent();
        if (inputDirectory == null) {
            inputDirectory = "."; // Current directory if no path specified
        }
        System.out.println("Input directory: " + inputDirectory);
        
        // Parse the CSV file - first just read the header
        System.out.println("Parsing CSV header...");
        String[] headers = parseCSVHeader(csvFilePath);
        
        if (headers.length == 0) {
            throw new IllegalArgumentException("CSV file is empty or has no headers");
        }
        
        System.out.println("Found " + headers.length + " columns in header row:");
        for (int i = 0; i < headers.length; i++) {
            System.out.println("  Column " + i + ": " + headers[i]);
        }
        
        // Create column map (name to index)
        for (int i = 0; i < headers.length; i++) {
            columnMap.put(headers[i], i);
        }
        System.out.println("Column map created successfully.");
        
        // Parse optional configuration file if provided
        if (configFilePath != null) {
            System.out.println("Parsing configuration file: " + configFilePath);
            parseConfig(configFilePath);
            System.out.println("Configuration parsed successfully.");
            
            // Log the imported parameters
            System.out.println("Configuration parameters:");
            for (Map.Entry<String, Object> entry : configParameters.entrySet()) {
                System.out.println("  " + entry.getKey() + ": " + entry.getValue());
            }
        } else {
            System.out.println("No configuration file provided. Inferring types from first data row...");
            // If no config file, infer types from first data row
            String[] firstDataRow = parseFirstDataRow(csvFilePath);
            if (firstDataRow != null) {
                inferTypes(headers, firstDataRow);
                System.out.println("Types inferred successfully.");
                
                // Generate and save a config file
                generateConfigFile(headers);
                System.out.println("Configuration file generated successfully.");
            }
        }
        
        // Parse the full CSV file now that we have the types
        System.out.println("Parsing full CSV data...");
        List<String[]> data = parseCSVData(csvFilePath);
        System.out.println("Parsed " + data.size() + " data rows successfully.");
        
        // Convert to JSON and write to file
        System.out.println("Converting data to JSON...");
        JSONArray jsonArray = convertToJSON(headers, data);
        System.out.println("Conversion to JSON successful.");
        
        String outputPath = csvFilePath.replaceAll("\\.csv$", ".json");
        System.out.println("Writing JSON to file: " + outputPath);
        writeJSON(jsonArray, outputPath);
        
        System.out.println("Conversion completed successfully.");
    }
    
    /**
     * Parse only the CSV header
     */
    private String[] parseCSVHeader(String csvFilePath) throws IOException {
        BufferedReader reader = new BufferedReader(new FileReader(csvFilePath));
        String headerLine = reader.readLine();
        reader.close();
        
        if (headerLine == null) {
            return new String[0];
        }
        
        // Split the header by commas
        String[] headers = headerLine.split(",");
        // Trim whitespace and quotes
        for (int i = 0; i < headers.length; i++) {
            headers[i] = headers[i].trim();
            if (headers[i].startsWith("\"") && headers[i].endsWith("\"")) {
                headers[i] = headers[i].substring(1, headers[i].length() - 1);
            }
        }
        
        return headers;
    }
    
    /**
     * Parse only the first data row after the header
     */
    private String[] parseFirstDataRow(String csvFilePath) throws IOException {
        BufferedReader reader = new BufferedReader(new FileReader(csvFilePath));
        
        // Skip the header
        reader.readLine();
        
        // Parse the first data row
        StringBuilder firstRowBuilder = new StringBuilder();
        boolean inQuotes = false;
        char[] buffer = new char[4096]; // Buffer for reading
        int charsRead;
        
        while ((charsRead = reader.read(buffer)) != -1) {
            for (int i = 0; i < charsRead; i++) {
                char c = buffer[i];
                firstRowBuilder.append(c);
                
                if (c == '"') {
                    inQuotes = !inQuotes;
                } else if (c == '\n' && !inQuotes) {
                    // End of the first data row
                    reader.close();
                    String rowData = firstRowBuilder.toString();
                    return parseCSVRow(rowData);
                }
            }
        }
        
        reader.close();
        
        // If we reached here, there's only one row or the file is empty
        if (firstRowBuilder.length() > 0) {
            return parseCSVRow(firstRowBuilder.toString());
        }
        
        return null;
    }
    
    /**
     * Parse a CSV row considering quoted fields
     */
    private String[] parseCSVRow(String rowData) {
        List<String> values = new ArrayList<>();
        StringBuilder currentValue = new StringBuilder();
        boolean inQuotes = false;
        
        for (int i = 0; i < rowData.length(); i++) {
            char c = rowData.charAt(i);
            
            if (c == '"') {
                inQuotes = !inQuotes;
                // Don't add the quotes to the value
                continue;
            }
            
            if (c == ',' && !inQuotes) {
                // End of current value
                values.add(currentValue.toString().trim());
                currentValue = new StringBuilder();
                continue;
            }
            
            currentValue.append(c);
        }
        
        // Add the last value
        if (currentValue.length() > 0) {
            values.add(currentValue.toString().trim());
        }
        
        return values.toArray(new String[0]);
    }
    
    /**
     * Parse the full CSV file, handling newlines within quotes
     */
    private List<String[]> parseCSVData(String csvFilePath) throws IOException {
        List<String[]> rows = new ArrayList<>();
        
        // First read the entire file
        System.out.println("Reading file: " + csvFilePath);
        String fileContent = new String(Files.readAllBytes(Paths.get(csvFilePath)));
        System.out.println("File size: " + fileContent.length() + " characters");
        
        // Split the content by newlines, but respect quotes
        boolean inQuotes = false;
        int rowStartIndex = 0;
        List<String> rowStrings = new ArrayList<>();
        
        // Skip the header
        System.out.println("Skipping header row...");
        for (int i = 0; i < fileContent.length(); i++) {
            if (fileContent.charAt(i) == '\n' && !inQuotes) {
                rowStartIndex = i + 1;
                break;
            } else if (fileContent.charAt(i) == '"') {
                inQuotes = !inQuotes;
            }
        }
        
        // Check if maxImportRows is set in the configuration
        Integer maxRows = null;
        if (configParameters.containsKey("maxImportRows")) {
            Object maxRowsObj = configParameters.get("maxImportRows");
            if (maxRowsObj instanceof Long) {
                maxRows = ((Long) maxRowsObj).intValue();
            } else if (maxRowsObj instanceof Integer) {
                maxRows = (Integer) maxRowsObj;
            }
            
            if (maxRows != null) {
                System.out.println("Will import at most " + maxRows + " rows as specified in configuration");
            }
        } else {
            // Check if maxImportRows is set in properties
            String maxRowsStr = properties.getProperty("maxImportRows");
            if (maxRowsStr != null && !maxRowsStr.equals("0")) {
                try {
                    maxRows = Integer.parseInt(maxRowsStr);
                    System.out.println("Will import at most " + maxRows + " rows as specified in properties");
                } catch (NumberFormatException e) {
                    System.out.println("Invalid maxImportRows property value: " + maxRowsStr);
                }
            }
        }
        
        // Parse remaining rows
        int rowCount = 0;
        System.out.println("Parsing data rows...");
        for (int i = rowStartIndex; i < fileContent.length(); i++) {
            char c = fileContent.charAt(i);
            
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == '\n' && !inQuotes) {
                // End of row
                String rowData = fileContent.substring(rowStartIndex, i);
                rowStrings.add(rowData);
                rowStartIndex = i + 1;
                
                rowCount++;
                if (rowCount % 100 == 0) {
                    System.out.println("Processed " + rowCount + " rows so far");
                }
                
                // Check if we've reached the maximum number of rows to import
                if (maxRows != null && rowCount >= maxRows) {
                    System.out.println("Reached maximum number of rows to import (" + maxRows + "). Stopping.");
                    break;
                }
            }
        }
        
        // Add the last row if there is one and we haven't reached maxRows
        if (rowStartIndex < fileContent.length() && (maxRows == null || rowCount < maxRows)) {
            String rowData = fileContent.substring(rowStartIndex);
            rowStrings.add(rowData);
            rowCount++;
        }
        
        System.out.println("Found " + rowCount + " data rows. Processing...");
        
        // Parse each row string into an array of values
        int processedRows = 0;
        for (String rowString : rowStrings) {
            String[] values = parseCSVRow(rowString);
            rows.add(values);
            
            processedRows++;
            if (processedRows % 100 == 0) {
                System.out.println("Processed details for " + processedRows + " rows");
            }
        }
        
        System.out.println("Finished parsing CSV data. Total data rows: " + rows.size());
        return rows;
    }
    
    /**
     * Parse JSON configuration file
     */
    private void parseConfig(String configFilePath) throws Exception {
        JSONParser parser = new JSONParser();
        JSONObject config = (JSONObject) parser.parse(new FileReader(configFilePath));
        
        // Parse parameters section if it exists
        if (config.containsKey("parameters")) {
            JSONObject parameters = (JSONObject) config.get("parameters");
            
            for (Object key : parameters.keySet()) {
                String paramName = (String) key;
                Object paramValue = parameters.get(paramName);
                configParameters.put(paramName, paramValue);
                
                System.out.println("Found parameter: " + paramName + " = " + paramValue);
            }
        }
        
        // Parse column definitions
        JSONObject columns = (JSONObject) config.get("columns");
        for (Object key : columns.keySet()) {
            String columnName = (String) key;
            JSONObject columnConfig = (JSONObject) columns.get(columnName);
            
            // Check if this is a standard type definition
            if (columnConfig.containsKey("type")) {
                String typeStr = (String) columnConfig.get("type");
                
                DataType type;
                switch (typeStr.toUpperCase()) {
                    case "STRING":
                        type = DataType.STRING;
                        break;
                    case "INTEGER":
                        type = DataType.INTEGER;
                        break;
                    case "FLOAT":
                        type = DataType.FLOAT;
                        break;
                    case "BOOLEAN":
                        type = DataType.BOOLEAN;
                        break;
                    default:
                        throw new IllegalArgumentException("Unknown data type: " + typeStr);
                }
                
                columnTypes.put(columnName, type);
                System.out.println("Column '" + columnName + "' configured with type: " + type);
            }
        }
        
        // Parse derived boolean fields
        if (config.containsKey("derivedBooleanFields")) {
            JSONObject derivedFields = (JSONObject) config.get("derivedBooleanFields");
            
            for (Object key : derivedFields.keySet()) {
                String fieldName = (String) key;
                JSONObject fieldConfig = (JSONObject) derivedFields.get(fieldName);
                
                derivedBooleanFields.put(fieldName, fieldConfig);
                columnTypes.put(fieldName, DataType.BOOLEAN); // Register as a boolean column
                
                System.out.println("Derived boolean field '" + fieldName + "' configured with expression: " + fieldConfig);
            }
        }
        
        // Parse aggregate text fields
        if (config.containsKey("aggregateTextFields")) {
            JSONObject aggregateFields = (JSONObject) config.get("aggregateTextFields");
            
            for (Object key : aggregateFields.keySet()) {
                String fieldName = (String) key;
                JSONObject fieldConfig = (JSONObject) aggregateFields.get(fieldName);
                
                aggregateTextFields.put(fieldName, fieldConfig);
                columnTypes.put(fieldName, DataType.STRING); // Register as a string column
                
                System.out.println("Aggregate text field '" + fieldName + "' configured");
            }
        }
        
        // Parse suppressed fields
        if (config.containsKey("suppressedFields")) {
            JSONObject suppressed = (JSONObject) config.get("suppressedFields");
            
            for (Object key : suppressed.keySet()) {
                String fieldToSuppress = (String) key;
                String conditionField = (String) suppressed.get(fieldToSuppress);
                
                suppressedFields.put(fieldToSuppress, conditionField);
                
                System.out.println("Field '" + fieldToSuppress + "' will be suppressed when '" + 
                                  conditionField + "' is false");
            }
        }
    }
    
    /**
     * Infer column types from first data row
     */
    private void inferTypes(String[] headers, String[] firstDataRow) {
        for (int i = 0; i < headers.length && i < firstDataRow.length; i++) {
            String value = firstDataRow[i];
            String columnName = headers[i];
            
            // Check if it's a boolean
            if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("false")) {
                columnTypes.put(columnName, DataType.BOOLEAN);
                continue;
            }
            
            // Check if it's a number
            try {
                if (value.contains(".")) {
                    Double.parseDouble(value);
                    columnTypes.put(columnName, DataType.FLOAT);
                } else {
                    Integer.parseInt(value);
                    columnTypes.put(columnName, DataType.INTEGER);
                }
            } catch (NumberFormatException e) {
                // Default to string if parsing fails
                columnTypes.put(columnName, DataType.STRING);
            }
        }
    }
    
    /**
     * Generate a configuration JSON file with examples of derived fields
     */
    private void generateConfigFile(String[] headers) throws IOException {
        JSONObject config = new JSONObject();
        
        // Add default parameters
        JSONObject parameters = new JSONObject();
        parameters.put("maxImportRows", null);
        config.put("parameters", parameters);
        
        // Add column configurations
        JSONObject columns = new JSONObject();
        
        for (String header : headers) {
            JSONObject columnConfig = new JSONObject();
            DataType type = columnTypes.getOrDefault(header, DataType.STRING);
            columnConfig.put("type", type.toString());
            columns.put(header, columnConfig);
            
            System.out.println("Adding column '" + header + "' with inferred type: " + type);
        }
        
        config.put("columns", columns);
        
        // Add example derived boolean fields - this is just a template
        JSONObject derivedBooleanFields = new JSONObject();
        
        // Example 1: Simple field reference
        JSONObject simpleField = new JSONObject();
        simpleField.put("type", "FIELD");
        simpleField.put("field", "ExistingBoolField");
        derivedBooleanFields.put("DerivedBoolField1", simpleField);
        
        // Example 2: AND operation
        JSONObject andOperation = new JSONObject();
        andOperation.put("type", "AND");
        
        JSONArray andOperands = new JSONArray();
        
        JSONObject operand1 = new JSONObject();
        operand1.put("type", "FIELD");
        operand1.put("field", "BoolField1");
        andOperands.add(operand1);
        
        JSONObject operand2 = new JSONObject();
        operand2.put("type", "FIELD");
        operand2.put("field", "BoolField2");
        andOperands.add(operand2);
        
        andOperation.put("operands", andOperands);
        derivedBooleanFields.put("ANDResult", andOperation);
        
        // Example 3: OR operation
        JSONObject orOperation = new JSONObject();
        orOperation.put("type", "OR");
        
        JSONArray orOperands = new JSONArray();
        
        JSONObject orOperand1 = new JSONObject();
        orOperand1.put("type", "FIELD");
        orOperand1.put("field", "BoolField1");
        orOperands.add(orOperand1);
        
        JSONObject orOperand2 = new JSONObject();
        orOperand2.put("type", "FIELD");
        orOperand2.put("field", "BoolField2");
        orOperands.add(orOperand2);
        
        orOperation.put("operands", orOperands);
        derivedBooleanFields.put("ORResult", orOperation);
        
        // Example 4: NOT operation
        JSONObject notOperation = new JSONObject();
        notOperation.put("type", "NOT");
        
        JSONObject notOperand = new JSONObject();
        notOperand.put("type", "FIELD");
        notOperand.put("field", "BoolField1");
        
        notOperation.put("operand", notOperand);
        derivedBooleanFields.put("NOTResult", notOperation);
        
        // Example 5: Complex nested expression (A AND (B OR NOT C))
        JSONObject complexExpr = new JSONObject();
        complexExpr.put("type", "AND");
        
        JSONArray complexOperands = new JSONArray();
        
        JSONObject complexOp1 = new JSONObject();
        complexOp1.put("type", "FIELD");
        complexOp1.put("field", "BoolField1");
        complexOperands.add(complexOp1);
        
        JSONObject nestedOr = new JSONObject();
        nestedOr.put("type", "OR");
        
        JSONArray nestedOrOps = new JSONArray();
        
        JSONObject nestedOrOp1 = new JSONObject();
        nestedOrOp1.put("type", "FIELD");
        nestedOrOp1.put("field", "BoolField2");
        nestedOrOps.add(nestedOrOp1);
        
        JSONObject nestedNot = new JSONObject();
        nestedNot.put("type", "NOT");
        
        JSONObject nestedNotOp = new JSONObject();
        nestedNotOp.put("type", "FIELD");
        nestedNotOp.put("field", "BoolField3");
        
        nestedNot.put("operand", nestedNotOp);
        nestedOrOps.add(nestedNot);
        
        nestedOr.put("operands", nestedOrOps);
        complexOperands.add(nestedOr);
        
        complexExpr.put("operands", complexOperands);
        derivedBooleanFields.put("ComplexExpression", complexExpr);
        
        config.put("derivedBooleanFields", derivedBooleanFields);
        
        // Add example text aggregation fields
        JSONObject aggregateTextFields = new JSONObject();
        
        // Example 1: Simple concatenation when a boolean field is true
        JSONObject textAgg1 = new JSONObject();
        textAgg1.put("condition", "BoolField1");
        
        JSONArray sources1 = new JSONArray();
        sources1.add("TextField1");
        sources1.add("TextField2");
        
        textAgg1.put("sourceFields", sources1);
        textAgg1.put("separator", " - ");
        
        aggregateTextFields.put("AggregatedText1", textAgg1);
        
        // Example 2: Concatenation based on a derived field
        JSONObject textAgg2 = new JSONObject();
        textAgg2.put("condition", "ComplexExpression");
        
        JSONArray sources2 = new JSONArray();
        sources2.add("TextField1");
        sources2.add("TextField3");
        sources2.add("TextField4");
        
        textAgg2.put("sourceFields", sources2);
        textAgg2.put("separator", ", ");
        
        aggregateTextFields.put("AggregatedText2", textAgg2);
        
        config.put("aggregateTextFields", aggregateTextFields);
        
        // Add example suppressed fields
        JSONObject suppressedFields = new JSONObject();
        suppressedFields.put("TextField1", "BoolField1");
        suppressedFields.put("TextField2", "ANDResult");
        suppressedFields.put("TextField3", "ComplexExpression");
        
        config.put("suppressedFields", suppressedFields);
        
        // Determine output location - either in the config directory or the input directory
        String configFilePath;
        if (configDirectory != null && !configDirectory.isEmpty()) {
            // Check if config directory exists, create it if it doesn't
            Path configDir = Paths.get(configDirectory);
            if (!Files.exists(configDir)) {
                Files.createDirectories(configDir);
                System.out.println("Created config directory: " + configDirectory);
            }
            configFilePath = configDirectory + File.separator + "config.json";
        } else {
            configFilePath = inputDirectory + File.separator + "config.json";
        }
        
        try (FileWriter file = new FileWriter(configFilePath)) {
            file.write(config.toJSONString());
        }
        
        System.out.println("Generated configuration file with examples: " + configFilePath);
    }
    
    /**
     * Convert a string value to the appropriate type
     */
    private Object convertValue(String value, DataType type) {
        switch (type) {
            case INTEGER:
                try {
                    return Integer.parseInt(value);
                } catch (NumberFormatException e) {
                    return 0; // Default value for parsing error
                }
            case FLOAT:
                try {
                    return Double.parseDouble(value);
                } catch (NumberFormatException e) {
                    return 0.0; // Default value for parsing error
                }
            case BOOLEAN:
                return Boolean.parseBoolean(value);
            case STRING:
            default:
                return value;
        }
    }
    
    /**
     * Convert parsed CSV data to JSON with derived fields
     */
    private JSONArray convertToJSON(String[] headers, List<String[]> dataRows) {
        JSONArray jsonArray = new JSONArray();
        
        // Process all data rows
        int rowIndex = 0;
        for (String[] row : dataRows) {
            rowIndex++;
            if (rowIndex % 100 == 0) {
                System.out.println("Converting row " + rowIndex + " to JSON");
            }
            
            // Create a map for the current row's values
            Map<String, Object> rowValues = new HashMap<>();
            
            // First process the direct column mappings
            for (int colIndex = 0; colIndex < headers.length && colIndex < row.length; colIndex++) {
                String columnName = headers[colIndex];
                String value = row[colIndex];
                
                // Convert value based on column type
                DataType type = columnTypes.getOrDefault(columnName, DataType.STRING);
                Object convertedValue = convertValue(value, type);
                
                rowValues.put(columnName, convertedValue);
            }
            
            // Process derived boolean fields
            for (Map.Entry<String, JSONObject> entry : derivedBooleanFields.entrySet()) {
                String fieldName = entry.getKey();
                JSONObject expression = entry.getValue();
                
                // Evaluate the boolean expression using the current row values
                Boolean result = BooleanExpressionEvaluator.evaluate(expression, rowValues);
                rowValues.put(fieldName, result);
            }
            
            // Process aggregate text fields
            for (Map.Entry<String, JSONObject> entry : aggregateTextFields.entrySet()) {
                String fieldName = entry.getKey();
                JSONObject config = entry.getValue();
                
                // Process the aggregate field configuration
                String aggregatedText = TextFieldProcessor.processAggregateField(config, rowValues);
                rowValues.put(fieldName, aggregatedText);
            }
            
            // Apply field suppression
            for (String fieldName : new ArrayList<>(rowValues.keySet())) {
                if (TextFieldProcessor.shouldSuppressField(fieldName, suppressedFields, rowValues)) {
                    // Condition is false, suppress the field by setting to null
                    rowValues.put(fieldName, null);
                }
            }
            
            // Create the JSON object for this row
            JSONObject jsonRow = new JSONObject();
            for (Map.Entry<String, Object> entry : rowValues.entrySet()) {
                jsonRow.put(entry.getKey(), entry.getValue());
            }
            
            jsonArray.add(jsonRow);
        }
        
        return jsonArray;
    }
    
    /**
     * Write JSON output to file
     */
    private void writeJSON(JSONArray jsonArray, String outputFilePath) throws IOException {
        boolean prettyPrint = Boolean.parseBoolean(properties.getProperty("output.pretty", "true"));
        
        try (FileWriter file = new FileWriter(outputFilePath)) {
            if (prettyPrint) {
                // Format JSON with indentation
                int indent = Integer.parseInt(properties.getProperty("output.indent", "2"));
                StringBuilder sb = new StringBuilder();
                formatJSON(jsonArray, sb, 0, indent);
                file.write(sb.toString());
            } else {
                // Write compact JSON
                file.write(jsonArray.toJSONString());
            }
        }
    }
    
    /**
     * Format JSON with indentation
     */
    private void formatJSON(JSONArray array, StringBuilder sb, int depth, int indent) {
        String indentStr = getIndent(depth, indent);
        String innerIndent = getIndent(depth + 1, indent);
        
        sb.append("[\n");
        
        for (int i = 0; i < array.size(); i++) {
            JSONObject obj = (JSONObject) array.get(i);
            sb.append(innerIndent);
            formatJSONObject(obj, sb, depth + 1, indent);
            
            if (i < array.size() - 1) {
                sb.append(",");
            }
            sb.append("\n");
        }
        
        sb.append(indentStr).append("]");
    }
    
    /**
     * Format JSON object with indentation
     */
    private void formatJSONObject(JSONObject obj, StringBuilder sb, int depth, int indent) {
        String indentStr = getIndent(depth, indent);
        String innerIndent = getIndent(depth + 1, indent);
        
        sb.append("{\n");
        
        boolean first = true;
        for (Object keyObj : obj.keySet()) {
            String key = keyObj.toString();
            Object value = obj.get(key);
            
            if (!first) {
                sb.append(",\n");
            }
            first = false;
            
            sb.append(innerIndent).append("\"").append(key).append("\": ");
            
            if (value instanceof JSONObject) {
                formatJSONObject((JSONObject) value, sb, depth + 1, indent);
            } else if (value instanceof JSONArray) {
                formatJSON((JSONArray) value, sb, depth + 1, indent);
            } else if (value instanceof String) {
                sb.append("\"").append(escapeJSONString((String) value)).append("\"");
            } else if (value == null) {
                sb.append("null");
            } else {
                sb.append(value);
            }
        }
        
        sb.append("\n").append(indentStr).append("}");
    }
    
    /**
     * Get indentation string
     */
    private String getIndent(int depth, int indent) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < depth * indent; i++) {
            sb.append(" ");
        }
        return sb.toString();
    }
    
    /**
     * Escape special characters in JSON strings
     */
    private String escapeJSONString(String value) {
        return value.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\b", "\\b")
                    .replace("\f", "\\f")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t");
    }
}