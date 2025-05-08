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
 * Central configuration class for the Conversion Hub system
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

    // Configuration paths
    private String configDirectory = "";
    private String configFilename = "config.json";

    // Logging configuration
    private String loggingLevel = "INFO";
    private boolean consoleLoggingEnabled = true;
    private boolean fileLoggingEnabled = false;
    private String logFileName = "converter.log";

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
            LoggingUtil.warn("System config file not found: " + configFilePath);
            LoggingUtil.info("Using default system configuration");
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
                            LoggingUtil.warn("Could not read list file: " + e.getMessage());
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

                LoggingUtil.info("Loaded " + expressions.size() + " expressions from config");
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
                    LoggingUtil.warn("Invalid text aggregation mode: " + modeString +
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

        // Parse configuration paths
        if (configJson.has("paths")) {
            JsonNode pathsNode = configJson.get("paths");

            if (pathsNode.has("configDirectory")) {
                configDirectory = pathsNode.get("configDirectory").asText();
            }

            if (pathsNode.has("configFilename")) {
                configFilename = pathsNode.get("configFilename").asText();
            }
        }

        // Parse logging configuration
        if (configJson.has("logging")) {
            JsonNode loggingNode = configJson.get("logging");

            if (loggingNode.has("level")) {
                loggingLevel = loggingNode.get("level").asText();
            }

            if (loggingNode.has("console")) {
                consoleLoggingEnabled = loggingNode.get("console").asBoolean();
            }

            if (loggingNode.has("file")) {
                fileLoggingEnabled = loggingNode.get("file").asBoolean();
            }

            if (loggingNode.has("filename")) {
                logFileName = loggingNode.get("filename").asText();
            }
        }

        LoggingUtil.info("Loaded system configuration from: " + configFilePath);
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

        // Configuration paths
        ObjectNode pathsNode = rootNode.putObject("paths");
        pathsNode.put("configDirectory", configDirectory);
        pathsNode.put("configFilename", configFilename);

        // Logging configuration
        ObjectNode loggingNode = rootNode.putObject("logging");
        loggingNode.put("level", loggingLevel);
        loggingNode.put("console", consoleLoggingEnabled);
        loggingNode.put("file", fileLoggingEnabled);
        loggingNode.put("filename", logFileName);

        // Write to file
        mapper.writeValue(new File(configFilePath), rootNode);
        LoggingUtil.info("Saved system configuration to: " + configFilePath);
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
     * Print debug information about the current configuration
     */
    public void printDebug() {
        LoggingUtil.debug("==== SystemConfig Debug Information ====");
        LoggingUtil.debug("Input Format: " + this.inputFormat);
        LoggingUtil.debug("Input Path: " + this.inputPath);
        LoggingUtil.debug("Input Files: " + this.inputFiles);
        LoggingUtil.debug("Output Format: " + this.outputFormat);
        LoggingUtil.debug("Output Suffix: " + this.outputSuffix);
        LoggingUtil.debug("Max Import Rows: " + this.maxImportRows);
        LoggingUtil.debug("Max Text Length: " + this.maxTextLength);
        LoggingUtil.debug("Text Aggregation Mode: " + this.textAggregationMode);
        LoggingUtil.debug("Exclusive Subsets: " + this.exclusiveSubsets);
        LoggingUtil.debug("Number of Subsets: " + this.subsets.size());
        LoggingUtil.debug("Number of Expressions: " + this.expressions.size());
        LoggingUtil.debug("Config Directory: " + this.configDirectory);
        LoggingUtil.debug("Config Filename: " + this.configFilename);
        LoggingUtil.debug("Logging Level: " + this.loggingLevel);
        LoggingUtil.debug("Console Logging: " + this.consoleLoggingEnabled);
        LoggingUtil.debug("File Logging: " + this.fileLoggingEnabled);
        LoggingUtil.debug("Log Filename: " + this.logFileName);
        LoggingUtil.debug("========================================");
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

    public String getConfigDirectory() {
        return configDirectory;
    }

    public void setConfigDirectory(String configDirectory) {
        this.configDirectory = configDirectory;
    }

    public String getConfigFilename() {
        return configFilename;
    }

    public void setConfigFilename(String configFilename) {
        this.configFilename = configFilename;
    }

    public String getLoggingLevel() {
        return loggingLevel;
    }

    public void setLoggingLevel(String loggingLevel) {
        this.loggingLevel = loggingLevel;
    }

    public boolean isConsoleLoggingEnabled() {
        return consoleLoggingEnabled;
    }

    public void setConsoleLoggingEnabled(boolean consoleLoggingEnabled) {
        this.consoleLoggingEnabled = consoleLoggingEnabled;
    }

    public boolean isFileLoggingEnabled() {
        return fileLoggingEnabled;
    }

    public void setFileLoggingEnabled(boolean fileLoggingEnabled) {
        this.fileLoggingEnabled = fileLoggingEnabled;
    }

    public String getLogFileName() {
        return logFileName;
    }

    public void setLogFileName(String logFileName) {
        this.logFileName = logFileName;
    }

    public JsonNode getConfigJson() {
        return configJson;
    }
}
