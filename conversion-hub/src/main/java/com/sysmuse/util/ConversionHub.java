package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * ConversionHub - Main application class that coordinates the conversion process
 * between different data formats like CSV and JSON.
 * Updated to use SystemConfig for configuration management.
 */
public class ConversionHub {

    private Properties properties;
    private SystemConfig systemConfig;
    private ConversionRepository repository;
    private String configDirectory;
    private String inputDirectory;
    private ConfigGenerator configGenerator;

    /**
     * Main entry point for the application
     */
    public static void main(String[] args) {
        ConversionHub hub = new ConversionHub();
        try {
            // Load default properties
            Properties defaultProps = new Properties();
            try (InputStream in = ConversionHub.class.getClassLoader().getResourceAsStream("application.properties")) {
                if (in != null) {
                    defaultProps.load(in);
                    LoggingUtil.info("Loaded default properties");
                } else {
                    LoggingUtil.info("Default properties file not found, using built-in defaults");
                }
            } catch (IOException e) {
                LoggingUtil.error("Error loading default properties: " + e.getMessage());
            }

            hub.setProperties(defaultProps);

            // Parse command line arguments
            String configDir = null;
            String inputFilePath = null;
            String configFilePath = null;
            String outputFormat = null;

            if (args.length > 0) {
                // Check if first argument is a directory (config directory)
                File firstArg = new File(args[0]);
                if (firstArg.isDirectory()) {
                    configDir = args[0];
                    LoggingUtil.info("Using config directory from arguments: " + configDir);

                    // Next argument would be input file
                    if (args.length > 1) {
                        inputFilePath = args[1];

                        // Check if there's a config file specified
                        if (args.length > 2) {
                            configFilePath = args[2];

                            // Check if output format is specified
                            if (args.length > 3) {
                                outputFormat = args[3];
                            }
                        }
                    }
                } else {
                    // First argument is the input file
                    inputFilePath = args[0];

                    // Check if there's a config file specified
                    if (args.length > 1) {
                        configFilePath = args[1];

                        // Check if output format is specified
                        if (args.length > 2) {
                            outputFormat = args[2];
                        }
                    }
                }
            }

            // Set config directory
            if (configDir == null) {
                configDir = defaultProps.getProperty("config.directory", "");
            }
            hub.setConfigDirectory(configDir);

            // Load system configuration first
            String sysConfigDir = defaultProps.getProperty("sysconfig.directory", configDir);
            String sysConfigFile = defaultProps.getProperty("sysconfig.filename", "sysconfig.json");
            String sysConfigPath = Paths.get(sysConfigDir, sysConfigFile).toString();

            hub.loadSystemConfig(sysConfigPath);
            hub.systemConfig.printDebug();

            //gm: to remove
            // Update properties with system config (for backward compatibility)
            /*
            Properties combinedProps = hub.getSystemConfigAsProperties();
            combinedProps.putAll(defaultProps); // Allow application.properties to override
            hub.setProperties(combinedProps);
             */

            // Set text field processor config
            TextFieldProcessor.setSystemConfig(hub.systemConfig);
            // gm: to remove
            //TextFieldProcessor.setProperties(combinedProps);

            // If no input file specified, use from system config
            if (inputFilePath == null) {
                // Try to use the first input file from system config
                List<String> inputFiles = hub.systemConfig.getInputFiles();
                String inputPath = hub.systemConfig.getInputPath();

                if (!inputFiles.isEmpty() && !inputPath.isEmpty()) {
                    inputFilePath = Paths.get(inputPath, inputFiles.get(0)).toString();
                    LoggingUtil.info("Using input file from system config: " + inputFilePath);
                } else {
                    // Fallback to application.properties
                    inputPath = defaultProps.getProperty("input.path", "");
                    String inputFilename = defaultProps.getProperty("input.filename", "");

                    if (inputPath.isEmpty() || inputFilename.isEmpty()) {
                        // Legacy properties
                        String csvPath = defaultProps.getProperty("input.csv.path", "");
                        String csvFilename = defaultProps.getProperty("input.csv.filename", "");
                        String jsonPath = defaultProps.getProperty("input.json.path", "");
                        String jsonFilename = defaultProps.getProperty("input.json.filename", "");

                        if (!csvPath.isEmpty() && !csvFilename.isEmpty()) {
                            inputPath = csvPath;
                            inputFilename = csvFilename;
                        } else if (!jsonPath.isEmpty() && !jsonFilename.isEmpty()) {
                            inputPath = jsonPath;
                            inputFilename = jsonFilename;
                        }
                    }

                    if (!inputPath.isEmpty() && !inputFilename.isEmpty()) {
                        inputFilePath = Paths.get(inputPath, inputFilename).toString();
                        LoggingUtil.info("Using input file from properties: " + inputFilePath);
                    } else {
                        LoggingUtil.info("No input file specified in arguments, system config, or properties");
                        LoggingUtil.info("Usage: ConversionHub [config_directory] <input_file> [config_json_file] [output_format]");
                        System.exit(1);
                    }
                }
            }

            // If no config file specified, try to use default from the config directory
            if (configFilePath == null) {
                String defaultConfigFilename = defaultProps.getProperty("config.filename", "config.json");
                Path configPath = Paths.get(configDir, defaultConfigFilename);
                configFilePath = configPath.toString();
                LoggingUtil.info("Using config file path: " + configFilePath);
            }

            // If no output format specified, try to get from system config or properties
            if (outputFormat == null) {
                outputFormat = hub.systemConfig.getOutputFormat();

                if (outputFormat == null || outputFormat.isEmpty()) {
                    // Try properties
                    outputFormat = hub.properties.getProperty("output.format");

                    if (outputFormat == null || outputFormat.isEmpty()) {
                        // If not in properties either, determine from input file extension
                        if (inputFilePath.toLowerCase().endsWith(".csv")) {
                            outputFormat = "json";
                        } else if (inputFilePath.toLowerCase().endsWith(".json")) {
                            outputFormat = "csv";
                        } else {
                            // Default to JSON if can't determine
                            outputFormat = "json";
                        }
                        LoggingUtil.info("Output format determined from input file: " + outputFormat);
                    } else {
                        LoggingUtil.info("Using output format from properties: " + outputFormat);
                    }
                } else {
                    LoggingUtil.info("Using output format from system config: " + outputFormat);
                }
            }

            // Initialize the repository
            hub.repository = new ConversionRepository();

            // Set max text length from system config
            hub.repository.setMaxTextLength(hub.systemConfig.getMaxTextLength());

            // Start conversion process
            hub.process(inputFilePath, configFilePath, outputFormat);

        } catch (Exception e) {
            System.err.println("Error during processing: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Constructor
     */
    public ConversionHub() {
        this.properties = new Properties();
        this.systemConfig = new SystemConfig(); // Initialize with defaults
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
     * Load system configuration from file
     */
    public void loadSystemConfig(String configFilePath) {
        try {
            SystemConfig config = new SystemConfig();
            config.loadFromFile(configFilePath);
            this.systemConfig = config;
            LoggingUtil.info("Loaded system configuration from: " + configFilePath);
        } catch (IOException e) {
            LoggingUtil.error("Could not load system configuration: " + e.getMessage());
            LoggingUtil.error("Using default system configuration");
            this.systemConfig = new SystemConfig(); // Use defaults
        }
    }

    /**
     * Get properties from system config for backward compatibility
     */
    // gm: to remove
    /*
    public Properties getSystemConfigAsProperties() {
        return this.systemConfig.toProperties();
    }
     */

    /**
     * Main processing method that orchestrates the conversion
     */
    public void process(String inputFilePath, String configFilePath, String outputFormat) throws Exception {
        LoggingUtil.info("Starting conversion process for: " + inputFilePath);

        // Store directory for output files
        File inputFile = new File(inputFilePath);
        inputDirectory = inputFile.getParent();
        if (inputDirectory == null) {
            inputDirectory = "."; // Current directory if no path specified
        }
        LoggingUtil.info("Input directory: " + inputDirectory);

        // Determine file format from extension or system config
        String inputFormat = systemConfig.getInputFormat();

        // Override with file extension if needed
        if (inputFormat == null || inputFormat.isEmpty() || !inputFormat.equalsIgnoreCase("csv") && !inputFormat.equalsIgnoreCase("json")) {
            if (inputFilePath.toLowerCase().endsWith(".csv")) {
                inputFormat = "csv";
            } else if (inputFilePath.toLowerCase().endsWith(".json")) {
                inputFormat = "json";
            } else {
                throw new IllegalArgumentException("Unsupported input file format. Supported formats: .csv, .json");
            }
            LoggingUtil.info("Using input format determined from file extension: " + inputFormat);
        } else {
            LoggingUtil.info("Using input format from system configuration: " + inputFormat);
        }

        // Load or generate configuration - Need to do this first to identify uniqueKey field if using multiple files
        configGenerator = loadConfigGenerator();

        // Variables for CSV multi-file handling
        boolean useMultipleFiles = false;
        String csvFilename = "";

        // Track the actual first file path for output name generation
        String firstActualFilePath = inputFilePath;

        if ("csv".equals(inputFormat)) {
            List<String> inputFiles = systemConfig.getInputFiles();
            String inputPath = systemConfig.getInputPath();

            // If system config has no input files, check properties
            if (inputFiles.isEmpty()) {
                String inputCsvFilename = properties.getProperty("input.csv.filename", "");
                if (inputCsvFilename.contains(",")) {
                    // Multiple files in comma-separated list
                    String[] files = inputCsvFilename.split(",");
                    for (String file : files) {
                        inputFiles.add(file.trim());
                    }
                } else if (inputCsvFilename.endsWith(".list")) {
                    // List file
                    String inputCsvPath = properties.getProperty("input.csv.path", "");
                    File listFile = new File(Paths.get(inputCsvPath, inputCsvFilename).toString());
                    if (listFile.exists() && listFile.isFile()) {
                        try {
                            List<String> fileLines = Files.readAllLines(listFile.toPath());
                            for (String file : fileLines) {
                                if (!file.trim().isEmpty()) {
                                    inputFiles.add(file.trim());
                                }
                            }
                        } catch (IOException e) {
                            LoggingUtil.error("Warning: Could not read list file: " + e.getMessage());
                            // Add the single file as fallback
                            inputFiles.add(inputCsvFilename);
                        }
                    } else {
                        // Just add as single file
                        inputFiles.add(inputCsvFilename);
                    }
                } else if (!inputCsvFilename.isEmpty()) {
                    // Single file
                    inputFiles.add(inputCsvFilename);
                }

                // Update input path if needed
                if (inputPath.isEmpty()) {
                    inputPath = properties.getProperty("input.csv.path", inputDirectory);
                }
            }

            // Check if we have multiple files now
            if (inputFiles.size() > 1) {
                useMultipleFiles = true;
                csvFilename = String.join(",", inputFiles);

                // Get the first file for output generation
                String firstFile = inputFiles.get(0);
                if (!new File(firstFile).isAbsolute()) {
                    firstActualFilePath = Paths.get(inputPath, firstFile).toString();
                } else {
                    firstActualFilePath = firstFile;
                }
            } else if (inputFiles.size() == 1) {
                // Single file
                useMultipleFiles = false;
                csvFilename = inputFiles.get(0);

                // Update first actual file path if needed
                if (!new File(csvFilename).isAbsolute() && !inputPath.isEmpty()) {
                    firstActualFilePath = Paths.get(inputPath, csvFilename).toString();
                }
            } else {
                // No files found in config, just use the input file path
                useMultipleFiles = false;
                csvFilename = new File(inputFilePath).getName();
            }
        }

        // Initialize the CSV converter (needed for header parsing)
        CsvConverter csvConverter = new CsvConverter(systemConfig);

        // Load the appropriate converter based on the input format
        if ("csv".equals(inputFormat)) {
            // Parse the header to set up the repository structure
            if (useMultipleFiles) {
                // For multiple files, parse the first file's header
                String firstFile = firstActualFilePath;
                LoggingUtil.info("Parsing headers from first file: " + firstFile);
                String[] headers = csvConverter.parseCSVHeader(firstFile);
                repository.setHeaders(headers);

                // Also parse the first data row for type inference
                String[] firstDataRow = csvConverter.parseFirstDataRow(firstFile);
                repository.setFirstDataRow(firstDataRow);
                repository.inferTypes(headers, firstDataRow);

                // Multi-file processing
                csvConverter.importMultipleFilesToRepository(csvFilename, inputDirectory, repository);

                // Try to load or generate configuration
                loadConfiguration(configFilePath, repository.getHeaders(), repository.getFirstDataRow());
            } else {
                // Single file mode
                LoggingUtil.info("Parsing headers from file: " + inputFilePath);
                String[] headers = csvConverter.parseCSVHeader(inputFilePath);
                repository.setHeaders(headers);

                // Parse the first data row for type inference
                String[] firstDataRow = csvConverter.parseFirstDataRow(inputFilePath);
                repository.setFirstDataRow(firstDataRow);
                repository.inferTypes(headers, firstDataRow);

                // Try to load or generate configuration
                loadConfiguration(configFilePath, headers, firstDataRow);

                // Import data
                csvConverter.importToRepository(inputFilePath, repository);
            }
        } else if ("json".equals(inputFormat)) {
            JsonConverter jsonConverter = new JsonConverter(systemConfig);

            // Import the data into the repository
            jsonConverter.importToRepository(inputFilePath, repository);

            // Configuration should be embedded in the JSON file
            // No need to load separately
        }

        // Make sure headers are set if we're working with JSON
        if ("json".equals(inputFormat) && repository.getHeaders() == null) {
            // Get all field names from the first data row if available
            if (!repository.getDataRows().isEmpty()) {
                Map<String, Object> firstRow = repository.getDataRows().get(0);
                String[] headers = firstRow.keySet().toArray(new String[0]);
                repository.setHeaders(headers);
                LoggingUtil.info("Set headers from first JSON data row with " + headers.length + " fields");
            } else {
                LoggingUtil.info("Warning: No data rows to extract headers from JSON file");
            }
        }

        // Check if headers are still null - this could cause problems during export
        if (repository.getHeaders() == null) {
            LoggingUtil.info("Warning: Headers are still null after processing. Creating empty headers array.");
            repository.setHeaders(new String[0]);
        }

        // Ensure all derived fields are processed for all rows
        LoggingUtil.info("Ensuring all derived fields are processed before export...");
        int rowCount = repository.getDataRows().size();
        int processedFields = 0;

        // First, make sure all derived boolean fields are evaluated
        for (Map<String, Object> row : repository.getDataRows()) {
            repository.processDerivedFields(row);
            repository.processAggregateFields(row);
            repository.applySuppression(row);
            processedFields++;

            if (processedFields % 100 == 0) {
                LoggingUtil.info("Processed derived fields for " + processedFields + " out of " + rowCount + " rows");
            }
        }

        // Print some sample rows to verify data
        if (!repository.getDataRows().isEmpty()) {
            LoggingUtil.info("\nSample data verification (first row):");
            Map<String, Object> sampleRow = repository.getDataRows().get(0);

            // Print derived boolean fields
            for (String field : repository.getDerivedBooleanFields().keySet()) {
                LoggingUtil.info("Derived field '" + field + "' = " + sampleRow.get(field));
            }

            // Print subset filter fields if available
            Map<String, String> subsets = systemConfig.getSubsets();
            if (!subsets.isEmpty()) {
                for (String filterField : subsets.keySet()) {
                    if (sampleRow.containsKey(filterField)) {
                        LoggingUtil.info("Filter field '" + filterField + "' = " + sampleRow.get(filterField));
                    } else {
                        LoggingUtil.info("Filter field '" + filterField + "' not found in sample row");
                    }
                }
            } else {
                // Check legacy properties
                String subsetConfig = properties.getProperty("output.subsets");
                if (subsetConfig != null && !subsetConfig.trim().isEmpty()) {
                    SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);
                    Map<String, String> filterToSuffix = subsetProcessor.getFilterToSuffix();

                    for (String filterField : filterToSuffix.keySet()) {
                        if (sampleRow.containsKey(filterField)) {
                            LoggingUtil.info("Filter field '" + filterField + "' = " + sampleRow.get(filterField));
                        } else {
                            LoggingUtil.info("Filter field '" + filterField + "' not found in sample row");
                        }
                    }
                }
            }
        }

        // Print list of all available fields for debugging
        LoggingUtil.info("\nAvailable fields in repository:");
        List<String> allFields = repository.getAllFieldNames();
        for (String field : allFields) {
            LoggingUtil.info("  - " + field);
        }

        LoggingUtil.info("About to process output in format: " + outputFormat);
        LoggingUtil.info("System config output format: " + systemConfig.getOutputFormat());

        // Export to the desired output format
        if ("json".equals(outputFormat.toLowerCase())) {

            // gm: to remove
            // Create JSON converter with properties that include system config
            /*
            Properties exportProps = new Properties();
            exportProps.putAll(properties);

            // Override with system config
            exportProps.setProperty("output.subsets", mapToSubsetString(systemConfig.getSubsets()));
            exportProps.setProperty("output.suffix", systemConfig.getOutputSuffix());
            exportProps.setProperty("output.pretty", String.valueOf(systemConfig.isPrettyPrint()));
            exportProps.setProperty("output.indent", String.valueOf(systemConfig.getIndentSize()));
            exportProps.setProperty("exclusiveSubsets", String.valueOf(systemConfig.isExclusiveSubsets()));
             */

            JsonConverter jsonConverter = new JsonConverter(systemConfig);

            // Create SubsetProcessor with the combined properties
            SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);

            if (subsetProcessor.hasSubsets() || !systemConfig.getSubsets().isEmpty()) {
                // Generate base output path for JSON
                String baseJsonPath;
                String outputFilename = properties.getProperty("output.json.filename");

                if (outputFilename != null && !outputFilename.isEmpty()) {
                    // If a specific output filename is provided in properties, use it
                    File outputDir = new File(inputDirectory);
                    baseJsonPath = new File(outputDir, outputFilename).getPath();
                } else {
                    // Otherwise, derive from first actual file path
                    baseJsonPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".json");
                }

                // Export subsets
                jsonConverter.exportSubsetsFromRepository(repository, baseJsonPath);
                return; // Skip standard export since we've done subset exports
            }

            // Standard export (no subsets)
            String outputFilename = properties.getProperty("output.json.filename");
            String outputJsonPath;

            if (outputFilename != null && !outputFilename.isEmpty()) {
                // If a specific output filename is provided in properties, use it
                File outputDir = new File(inputDirectory);
                outputJsonPath = new File(outputDir, outputFilename).getPath();
            } else {
                // Get suffix from system config
                String suffix = systemConfig.getOutputSuffix();
                if (suffix == null || suffix.isEmpty()) {
                    // Try from properties
                    suffix = properties.getProperty("output.suffix");
                }

                if (suffix != null && !suffix.isEmpty()) {
                    // Extract base path without extension
                    String basePathWithoutExt = firstActualFilePath.replaceAll("\\.[^.]+$", "");
                    // Add suffix and extension
                    outputJsonPath = basePathWithoutExt + suffix + ".json";
                } else {
                    // Just replace extension with .json
                    outputJsonPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".json");
                }
            }

            jsonConverter.exportFromRepository(repository, outputJsonPath);
            LoggingUtil.info("Exported data to JSON: " + outputJsonPath);
        } else if ("csv".equals(outputFormat.toLowerCase())) {
            // Create properties that include system config
            Properties exportProps = new Properties();
            exportProps.putAll(properties);

            // Override with system config
            exportProps.setProperty("output.subsets", mapToSubsetString(systemConfig.getSubsets()));
            exportProps.setProperty("output.suffix", systemConfig.getOutputSuffix());
            exportProps.setProperty("exclusiveSubsets", String.valueOf(systemConfig.isExclusiveSubsets()));

            // gm: changed this
            csvConverter = new CsvConverter(systemConfig);
            //CsvConverter csvConverter = new CsvConverter(exportProps);

            // Create SubsetProcessor with the combined properties
            SubsetProcessor subsetProcessor = new SubsetProcessor(systemConfig, repository);

            if (subsetProcessor.hasSubsets() || !systemConfig.getSubsets().isEmpty()) {
                // Generate base output path for CSV
                String baseCsvPath;
                String outputFilename = properties.getProperty("output.csv.filename");

                if (outputFilename != null && !outputFilename.isEmpty()) {
                    // If a specific output filename is provided in properties, use it
                    File outputDir = new File(inputDirectory);
                    baseCsvPath = new File(outputDir, outputFilename).getPath();
                } else {
                    // Otherwise, derive from first actual file path
                    baseCsvPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".csv");
                }

                // Export subsets
                csvConverter.exportSubsetsFromRepository(repository, baseCsvPath);
                return; // Skip standard export since we've done subset exports
            }

            // Standard export (no subsets)
            String outputFilename = properties.getProperty("output.csv.filename");
            String outputCsvPath;

            if (outputFilename != null && !outputFilename.isEmpty()) {
                // If a specific output filename is provided in properties, use it
                File outputDir = new File(inputDirectory);
                outputCsvPath = new File(outputDir, outputFilename).getPath();
            } else {
                // Get suffix from system config
                String suffix = systemConfig.getOutputSuffix();
                if (suffix == null || suffix.isEmpty()) {
                    // Try from properties
                    suffix = properties.getProperty("output.suffix");
                }

                if (suffix != null && !suffix.isEmpty()) {
                    // Extract base path without extension
                    String basePathWithoutExt = firstActualFilePath.replaceAll("\\.[^.]+$", "");
                    // Add suffix and extension
                    outputCsvPath = basePathWithoutExt + suffix + ".csv";
                } else {
                    // Just replace extension with .csv
                    outputCsvPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".csv");
                }
            }

            csvConverter.exportFromRepository(repository, outputCsvPath);
            LoggingUtil.info("Exported data to CSV: " + outputCsvPath);
        } else {
            throw new IllegalArgumentException("Unsupported output format: " + outputFormat);
        }

        LoggingUtil.info("Conversion completed successfully.");
    }

    /**
     * Helper method to convert a map of subsets to the legacy string format
     */
    private String mapToSubsetString(Map<String, String> subsets) {
        if (subsets.isEmpty()) {
            return "";
        }

        StringBuilder result = new StringBuilder();
        boolean first = true;

        for (Map.Entry<String, String> entry : subsets.entrySet()) {
            if (!first) {
                result.append(",");
            }
            first = false;

            result.append(entry.getKey())
                    .append(":")
                    .append(entry.getValue());
        }

        return result.toString();
    }

    /**
     * Load and instantiate a config generator class
     */
    private ConfigGenerator loadConfigGenerator() {
        String generatorClassName = properties.getProperty("config.generator.class",
                "com.sysmuse.util.StandardConfigGenerator");

        try {
            Class<?> generatorClass = Class.forName(generatorClassName);

            // Try to find constructor that takes properties
            try {
                return (ConfigGenerator) generatorClass.getConstructor(Properties.class)
                        .newInstance(properties);
            } catch (Exception e) {
                // Try constructor that takes a string parameter (for compound expressions)
                try {
                    if (generatorClass.getName().contains("ApplicableFormatConfigGenerator")) {
                        // Get compound expressions from properties or system config
                        String expressions = "";

                        if (systemConfig != null) {
                            // Get the expressions string from SystemConfig
                            expressions = systemConfig.getCompoundExpressionsString();
                        }

                        if (expressions.isEmpty()) {
                            // Fallback to properties
                            expressions = properties.getProperty("applicable.format.compound.expressions", "");
                        }

                        // Create with expressions parameter if available
                        if (!expressions.isEmpty()) {
                            return (ConfigGenerator) generatorClass.getConstructor(String.class, Properties.class)
                                    .newInstance(expressions, properties);
                        }
                    }
                } catch (Exception ex) {
                    LoggingUtil.error("Could not instantiate with compound expressions: " + ex.getMessage());
                }

                // Fallback to default constructor
                ConfigGenerator generator = (ConfigGenerator) generatorClass.getConstructor().newInstance();

                // Set properties if the generator has a setProperties method
                try {
                    generatorClass.getMethod("setProperties", Properties.class).invoke(generator, properties);
                } catch (Exception ex) {
                    // Ignore if the method doesn't exist
                }

                // Set SystemConfig if the generator has a setSystemConfig method
                if (systemConfig != null) {
                    try {
                        generatorClass.getMethod("setSystemConfig", SystemConfig.class).invoke(generator, systemConfig);
                    } catch (Exception ex) {
                        // Ignore if the method doesn't exist
                    }
                }

                return generator;
            }
        } catch (Exception e) {
            LoggingUtil.error("Error loading config generator class: " + e.getMessage());
            LoggingUtil.error("Falling back to StandardConfigGenerator");
            return new StandardConfigGenerator(systemConfig);
        }
    }

    /**
     * Load or generate configuration
     */
    private void loadConfiguration(String configFilePath, String[] headers, String[] firstDataRow) throws Exception {
        LoggingUtil.info("Checking for configuration file: " + configFilePath);

        // Check if the file exists before trying to parse it
        File configFile = new File(configFilePath);
        if (!configFile.exists()) {
            LoggingUtil.info("Configuration file not found: " + configFilePath);
            LoggingUtil.info("Will generate a new configuration file.");

            // Convert repository's type map to Object map for the generator
            Map<String, Object> typesMap = new HashMap<>();
            for (Map.Entry<String, ConversionRepository.DataType> entry : repository.getColumnTypes().entrySet()) {
                typesMap.put(entry.getKey(), entry.getValue().toString());
            }

            // Generate configuration - passing headers ensures order is preserved
            // in the config generator implementation
            com.fasterxml.jackson.databind.JsonNode config = configGenerator.generateConfig(
                    headers, firstDataRow, typesMap);

            // Extract configuration and apply to repository
            repository.extractConfigFromJSON(config);

            // Save the generated config
            saveGeneratedConfig(config);

            return;
        }

        // Parse the existing config file using Jackson
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        try {
            com.fasterxml.jackson.databind.JsonNode config = mapper.readTree(configFile);
            LoggingUtil.info("Successfully parsed config file: " + configFilePath);

            // Extract configuration and apply to repository
            repository.extractConfigFromJSON(config);
        } catch (Exception e) {
            System.err.println("Error parsing config file: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Save generated configuration to a file
     */
    private void saveGeneratedConfig(com.fasterxml.jackson.databind.JsonNode config) throws IOException {
        String configFilename = properties.getProperty("config.filename", "config.json");

        // Determine output location - either in the config directory or the input directory
        String configFilePath;
        if (configDirectory != null && !configDirectory.isEmpty()) {
            // Check if config directory exists, create it if it doesn't
            Path configDir = Paths.get(configDirectory);
            if (!Files.exists(configDir)) {
                Files.createDirectories(configDir);
                LoggingUtil.info("Created config directory: " + configDirectory);
            }
            configFilePath = Paths.get(configDirectory, configFilename).toString();
        } else {
            configFilePath = Paths.get(inputDirectory, configFilename).toString();
        }

        // Write the config file with pretty printing
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        mapper.enable(com.fasterxml.jackson.databind.SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(new File(configFilePath), config);

        LoggingUtil.info("Generated configuration saved to: " + configFilePath);
    }
}