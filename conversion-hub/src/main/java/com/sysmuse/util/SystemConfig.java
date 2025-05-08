package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * SystemConfig - Handles loading and managing system configuration from JSON file
 * Updated to include expressions directly in config
 */
public class SystemConfig {

    // Enumeration for text aggregation modes
    public enum TextAggregationMode {
        NEWLINE,     // Fields separated by newlines
        FIELDNAME    // Fields prefixed with field name in delimiters
    }

    // Core parameters with defaults
    private String inputFormat = "csv";
    private List<String> inputFiles = new ArrayList<>();
    private String inputPath = "";
    private String outputFormat = "csv";
    private int maxImportRows = 0;
    private int maxTextLength = 0;
    private List<String> textSuffixes = new ArrayList<>();
    private Map<String, String> subsets = new LinkedHashMap<>();
    private String outputSuffix = "_converted";
    private boolean exclusiveSubsets = false;
    private boolean prettyPrint = true;
    private int indentSize = 2;

    // Text aggregation parameters
    private TextAggregationMode textAggregationMode = TextAggregationMode.NEWLINE;
    private String fieldNamePrefix = "[";
    private String fieldNameSuffix = "]";
    private String newlineChar = "\n";

    // Expressions directly in config (no separate file)
    private Map<String, String> expressions = new LinkedHashMap<>();

    // Raw JSON config
    private JsonNode configJson;

    /**
     * Constructor that loads from file
     */
    public SystemConfig(String configFilePath) throws IOException {
        loadFromFile(configFilePath);
    }

    /**
     * Default constructor
     */
    public SystemConfig() {
        // Initialize with default values
        textSuffixes.add(" reasoning");
        textSuffixes.add(" snippets");
    }

    /**
     * Load configuration from JSON file
     */
    public void loadFromFile(String configFilePath) throws IOException {
        File configFile = new File(configFilePath);
        if (!configFile.exists()) {
            System.out.println("System config file not found: " + configFilePath);
            System.out.println("Using default system configuration");
            return;
        }

        ObjectMapper mapper = new ObjectMapper();
        configJson = mapper.readTree(configFile);

        // Parse input configuration
        if (configJson.has("input")) {
            JsonNode inputNode = configJson.get("input");

            if (inputNode.has("format")) {
                inputFormat = inputNode.get("format").asText();
            }

            if (inputNode.has("path")) {
                inputPath = inputNode.get("path").asText();
            }

            if (inputNode.has("files")) {
                JsonNode filesNode = inputNode.get("files");
                if (filesNode.isArray()) {
                    for (JsonNode fileNode : filesNode) {
                        inputFiles.add(fileNode.asText());
                    }
                } else if (filesNode.isTextual()) {
                    // Single file or list file
                    String fileValue = filesNode.asText();
                    if (fileValue.endsWith(".list")) {
                        // Process as a list file
                        try {
                            Path listPath = Paths.get(inputPath, fileValue);
                            List<String> fileList = Files.readAllLines(listPath);
                            for (String file : fileList) {
                                if (!file.trim().isEmpty()) {
                                    inputFiles.add(file.trim());
                                }
                            }
                        } catch (IOException e) {
                            System.out.println("Warning: Could not read list file: " + e.getMessage());
                            // Add the list file itself as a fallback
                            inputFiles.add(fileValue);
                        }
                    } else {
                        // Just a single file
                        inputFiles.add(fileValue);
                    }
                }
            }
        }

        // Parse output configuration
        if (configJson.has("output")) {
            JsonNode outputNode = configJson.get("output");

            if (outputNode.has("format")) {
                outputFormat = outputNode.get("format").asText();
            }

            if (outputNode.has("suffix")) {
                outputSuffix = outputNode.get("suffix").asText();
            }

            if (outputNode.has("pretty")) {
                prettyPrint = outputNode.get("pretty").asBoolean();
            }

            if (outputNode.has("indent")) {
                indentSize = outputNode.get("indent").asInt();
            }
        }

        // Parse processing limits
        if (configJson.has("limits")) {
            JsonNode limitsNode = configJson.get("limits");

            if (limitsNode.has("maxImportRows")) {
                maxImportRows = limitsNode.get("maxImportRows").asInt();
            }

            if (limitsNode.has("maxTextLength")) {
                maxTextLength = limitsNode.get("maxTextLength").asInt();
            }
        }

        // Parse applicable format configuration
        if (configJson.has("applicableFormat")) {
            JsonNode formatNode = configJson.get("applicableFormat");

            if (formatNode.has("textSuffixes")) {
                textSuffixes.clear();
                JsonNode suffixesNode = formatNode.get("textSuffixes");
                if (suffixesNode.isArray()) {
                    for (JsonNode suffixNode : suffixesNode) {
                        String suffix = suffixNode.asText();
                        // Ensure leading space
                        if (!suffix.startsWith(" ")) {
                            suffix = " " + suffix;
                        }
                        textSuffixes.add(suffix);
                    }
                }
            }

            // Parse expressions directly from config
            if (formatNode.has("expressions")) {
                JsonNode expressionsNode = formatNode.get("expressions");
                expressions.clear();

                Iterator<String> fieldNames = expressionsNode.fieldNames();
                while (fieldNames.hasNext()) {
                    String name = fieldNames.next();
                    expressions.put(name, expressionsNode.get(name).asText());
                }

                System.out.println("Loaded " + expressions.size() + " expressions from config");
            }
        }

        // Parse text aggregation configuration
        if (configJson.has("textAggregation")) {
            JsonNode aggregationNode = configJson.get("textAggregation");

            if (aggregationNode.has("mode")) {
                String modeString = aggregationNode.get("mode").asText().toUpperCase();
                try {
                    textAggregationMode = TextAggregationMode.valueOf(modeString);
                } catch (IllegalArgumentException e) {
                    System.out.println("Warning: Invalid text aggregation mode: " + modeString +
                            ". Using default: " + textAggregationMode);
                }
            }

            if (aggregationNode.has("fieldNamePrefix")) {
                fieldNamePrefix = aggregationNode.get("fieldNamePrefix").asText();
            }

            if (aggregationNode.has("fieldNameSuffix")) {
                fieldNameSuffix = aggregationNode.get("fieldNameSuffix").asText();
            }

            if (aggregationNode.has("newlineChar")) {
                newlineChar = aggregationNode.get("newlineChar").asText();
            }
        }

        // Parse subset configuration
        if (configJson.has("subsets")) {
            JsonNode subsetsNode = configJson.get("subsets");

            if (subsetsNode.has("filters")) {
                JsonNode filtersNode = subsetsNode.get("filters");
                Iterator<String> fieldNames = filtersNode.fieldNames();
                while (fieldNames.hasNext()) {
                    String filterField = fieldNames.next();
                    String suffix = filtersNode.get(filterField).asText();
                    subsets.put(filterField, suffix);
                }
            }

            if (subsetsNode.has("exclusive")) {
                exclusiveSubsets = subsetsNode.get("exclusive").asBoolean();
            }
        }

        System.out.println("Loaded system configuration from: " + configFilePath);
    }

    /**
     * Save configuration to a JSON file
     */
    public void saveToFile(String configFilePath) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(com.fasterxml.jackson.databind.SerializationFeature.INDENT_OUTPUT);

        ObjectNode rootNode = mapper.createObjectNode();

        // Input configuration
        ObjectNode inputNode = rootNode.putObject("input");
        inputNode.put("format", inputFormat);
        inputNode.put("path", inputPath);

        if (inputFiles.size() == 1) {
            inputNode.put("files", inputFiles.get(0));
        } else {
            ArrayNode filesArray = inputNode.putArray("files");
            for (String file : inputFiles) {
                filesArray.add(file);
            }
        }

        // Output configuration
        ObjectNode outputNode = rootNode.putObject("output");
        outputNode.put("format", outputFormat);
        outputNode.put("suffix", outputSuffix);
        outputNode.put("pretty", prettyPrint);
        outputNode.put("indent", indentSize);

        // Processing limits
        ObjectNode limitsNode = rootNode.putObject("limits");
        limitsNode.put("maxImportRows", maxImportRows);
        limitsNode.put("maxTextLength", maxTextLength);

        // Applicable format configuration
        ObjectNode formatNode = rootNode.putObject("applicableFormat");

        // Add expressions directly to config
        if (!expressions.isEmpty()) {
            ObjectNode expressionsNode = formatNode.putObject("expressions");
            for (Map.Entry<String, String> entry : expressions.entrySet()) {
                expressionsNode.put(entry.getKey(), entry.getValue());
            }
        }

        ArrayNode suffixesArray = formatNode.putArray("textSuffixes");
        for (String suffix : textSuffixes) {
            suffixesArray.add(suffix.trim());
        }

        // Text aggregation configuration
        ObjectNode aggregationNode = rootNode.putObject("textAggregation");
        aggregationNode.put("mode", textAggregationMode.name());
        aggregationNode.put("fieldNamePrefix", fieldNamePrefix);
        aggregationNode.put("fieldNameSuffix", fieldNameSuffix);
        aggregationNode.put("newlineChar", newlineChar);

        // Subset configuration
        ObjectNode subsetsNode = rootNode.putObject("subsets");
        subsetsNode.put("exclusive", exclusiveSubsets);

        ObjectNode filtersNode = subsetsNode.putObject("filters");
        for (Map.Entry<String, String> entry : subsets.entrySet()) {
            filtersNode.put(entry.getKey(), entry.getValue());
        }

        // Write to file
        mapper.writeValue(new File(configFilePath), rootNode);
        System.out.println("Saved system configuration to: " + configFilePath);
    }

    /**
     * Generate compound expressions for ApplicableFormatConfigGenerator
     */
    public String getCompoundExpressionsString() {
        if (expressions.isEmpty()) {
            return "";
        }

        StringBuilder result = new StringBuilder();
        boolean first = true;

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            if (!first) {
                result.append("\n");
            }
            first = false;

            result.append("\"").append(entry.getKey()).append("\":").append(entry.getValue());
        }

        return result.toString();
    }

    /**
     * Add an expression
     */
    public void addExpression(String name, String expression) {
        expressions.put(name, expression);
    }

    /**
     * Get expressions map
     */
    public Map<String, String> getExpressions() {
        return expressions;
    }

    /**
     * Convert system configuration to properties for backward compatibility
     */
    public Properties toProperties() {
        Properties props = new Properties();

        // Input configuration
        props.setProperty("input.format", inputFormat);
        props.setProperty("input.path", inputPath);

        if (!inputFiles.isEmpty()) {
            if (inputFiles.size() == 1) {
                props.setProperty("input.filename", inputFiles.get(0));
            } else {
                // Join multiple files with commas
                props.setProperty("input.filename", String.join(",", inputFiles));
            }

            // Legacy properties for backward compatibility
            if ("csv".equalsIgnoreCase(inputFormat)) {
                props.setProperty("input.csv.path", inputPath);
                props.setProperty("input.csv.filename", props.getProperty("input.filename"));
            } else if ("json".equalsIgnoreCase(inputFormat)) {
                props.setProperty("input.json.path", inputPath);
                props.setProperty("input.json.filename", props.getProperty("input.filename"));
            }
        }

        // Output configuration
        props.setProperty("output.format", outputFormat);
        props.setProperty("output.suffix", outputSuffix);
        props.setProperty("output.pretty", String.valueOf(prettyPrint));
        props.setProperty("output.indent", String.valueOf(indentSize));

        // Legacy properties for backward compatibility
        props.setProperty("output.csvSuffix", outputSuffix);
        props.setProperty("output.jsonSuffix", outputSuffix);

        // Processing limits
        props.setProperty("maxImportRows", String.valueOf(maxImportRows));
        props.setProperty("maxTextLength", String.valueOf(maxTextLength));

        // Applicable format configuration
        if (!expressions.isEmpty()) {
            // Create a comma-separated list for legacy format
            props.setProperty("applicable.format.compound.expressions", getCompoundExpressionsString());
        }

        props.setProperty("applicable.format.text.suffixes", String.join(",", textSuffixes));

        // Text aggregation configuration
        props.setProperty("textAggregation.mode", textAggregationMode.name());
        props.setProperty("textAggregation.fieldNamePrefix", fieldNamePrefix);
        props.setProperty("textAggregation.fieldNameSuffix", fieldNameSuffix);
        props.setProperty("textAggregation.newlineChar", newlineChar);

        // For backward compatibility with default.text.separator
        if (textAggregationMode == TextAggregationMode.NEWLINE) {
            props.setProperty("default.text.separator", newlineChar);
        } else {
            props.setProperty("default.text.separator", "");
        }

        // Subset configuration
        if (!subsets.isEmpty()) {
            StringBuilder subsetConfig = new StringBuilder();
            boolean first = true;

            for (Map.Entry<String, String> entry : subsets.entrySet()) {
                if (!first) {
                    subsetConfig.append(",");
                }
                first = false;

                subsetConfig.append(entry.getKey())
                        .append(":")
                        .append(entry.getValue());
            }

            props.setProperty("output.subsets", subsetConfig.toString());
            // Legacy properties for backward compatibility
            props.setProperty("output.csvSubsets", subsetConfig.toString());
            props.setProperty("output.jsonSubsets", subsetConfig.toString());
        }

        props.setProperty("exclusiveSubsets", String.valueOf(exclusiveSubsets));

        return props;
    }

    /**
     * Print debug information about the current configuration
     */
    public void printDebug() {
        System.out.println("==== SystemConfig Debug Information ====");
        System.out.println("Input Format: " + this.inputFormat);
        System.out.println("Input Path: " + this.inputPath);
        System.out.println("Input Files: " + this.inputFiles);
        System.out.println("Output Format: " + this.outputFormat);
        System.out.println("Output Suffix: " + this.outputSuffix);
        System.out.println("Max Import Rows: " + this.maxImportRows);
        System.out.println("Max Text Length: " + this.maxTextLength);
        System.out.println("Text Aggregation Mode: " + this.textAggregationMode);
        System.out.println("Exclusive Subsets: " + this.exclusiveSubsets);
        System.out.println("Number of Subsets: " + this.subsets.size());
        System.out.println("Number of Expressions: " + this.expressions.size());
        System.out.println("========================================");
    }

    // Getters and setters

    public String getInputFormat() {
        return inputFormat;
    }

    public void setInputFormat(String inputFormat) {
        this.inputFormat = inputFormat;
    }

    public List<String> getInputFiles() {
        return inputFiles;
    }

    public void setInputFiles(List<String> inputFiles) {
        this.inputFiles = inputFiles;
    }

    public String getInputPath() {
        return inputPath;
    }

    public void setInputPath(String inputPath) {
        this.inputPath = inputPath;
    }

    public String getOutputFormat() {
        return outputFormat;
    }

    public void setOutputFormat(String outputFormat) {
        this.outputFormat = outputFormat;
    }

    public int getMaxImportRows() {
        return maxImportRows;
    }

    public void setMaxImportRows(int maxImportRows) {
        this.maxImportRows = maxImportRows;
    }

    public int getMaxTextLength() {
        return maxTextLength;
    }

    public void setMaxTextLength(int maxTextLength) {
        this.maxTextLength = maxTextLength;
    }

    public List<String> getTextSuffixes() {
        return textSuffixes;
    }

    public void setTextSuffixes(List<String> textSuffixes) {
        this.textSuffixes = textSuffixes;
    }

    public Map<String, String> getSubsets() {
        return subsets;
    }

    public void setSubsets(Map<String, String> subsets) {
        this.subsets = subsets;
    }

    public String getOutputSuffix() {
        return outputSuffix;
    }

    public void setOutputSuffix(String outputSuffix) {
        this.outputSuffix = outputSuffix;
    }

    public boolean isExclusiveSubsets() {
        return exclusiveSubsets;
    }

    public void setExclusiveSubsets(boolean exclusiveSubsets) {
        this.exclusiveSubsets = exclusiveSubsets;
    }

    public boolean isPrettyPrint() {
        return prettyPrint;
    }

    public void setPrettyPrint(boolean prettyPrint) {
        this.prettyPrint = prettyPrint;
    }

    public int getIndentSize() {
        return indentSize;
    }

    public void setIndentSize(int indentSize) {
        this.indentSize = indentSize;
    }

    public TextAggregationMode getTextAggregationMode() {
        return textAggregationMode;
    }

    public void setTextAggregationMode(TextAggregationMode textAggregationMode) {
        this.textAggregationMode = textAggregationMode;
    }

    public String getFieldNamePrefix() {
        return fieldNamePrefix;
    }

    public void setFieldNamePrefix(String fieldNamePrefix) {
        this.fieldNamePrefix = fieldNamePrefix;
    }

    public String getFieldNameSuffix() {
        return fieldNameSuffix;
    }

    public void setFieldNameSuffix(String fieldNameSuffix) {
        this.fieldNameSuffix = fieldNameSuffix;
    }

    public String getNewlineChar() {
        return newlineChar;
    }

    public void setNewlineChar(String newlineChar) {
        this.newlineChar = newlineChar;
    }

    public JsonNode getConfigJson() {
        return configJson;
    }
}