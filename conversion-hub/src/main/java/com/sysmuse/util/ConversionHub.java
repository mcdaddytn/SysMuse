package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * ConversionHub - Main application class that coordinates the conversion process
 * between different data formats like CSV and JSON.
 * Updated to support multi-file overlay functionality.
 */
public class ConversionHub {

    private Properties properties;
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
                    System.out.println("Loaded default properties");
                } else {
                    System.out.println("Default properties file not found, using built-in defaults");
                }
            } catch (IOException e) {
                System.out.println("Error loading default properties: " + e.getMessage());
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
                    System.out.println("Using config directory from arguments: " + configDir);

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

            // If no input file specified, use from properties
            if (inputFilePath == null) {
                String inputPath = defaultProps.getProperty("input.csv.path", "");
                String inputFilename = defaultProps.getProperty("input.csv.filename", "");

                if (!inputPath.isEmpty() && !inputFilename.isEmpty()) {
                    inputFilePath = Paths.get(inputPath, inputFilename).toString();
                    System.out.println("Using input file from properties: " + inputFilePath);
                } else {
                    System.out.println("No input file specified in arguments or properties");
                    System.out.println("Usage: ConversionHub [config_directory] <input_file> [config_json_file] [output_format]");
                    System.exit(1);
                }
            }

            // If no config directory specified, use from properties
            if (configDir == null) {
                configDir = defaultProps.getProperty("config.directory", "");
                if (!configDir.isEmpty()) {
                    System.out.println("Using config directory from properties: " + configDir);
                } else {
                    // Default to input directory if not specified
                    File inputFile = new File(inputFilePath);
                    configDir = inputFile.getParent();
                    if (configDir == null) {
                        configDir = "."; // Current directory if no path specified
                    }
                    System.out.println("No config directory specified, defaulting to input directory: " + configDir);
                }
            }

            // Set config directory
            hub.setConfigDirectory(configDir);

            // If no config file specified, try to use default from the config directory
            if (configFilePath == null) {
                String defaultConfigFilename = defaultProps.getProperty("config.filename", "config.json");
                Path configPath = Paths.get(configDir, defaultConfigFilename);
                configFilePath = configPath.toString();
                System.out.println("Using config file path: " + configFilePath);
            }

            // If no output format specified, try to get from properties or determine from input file extension
            if (outputFormat == null) {
                outputFormat = hub.properties.getProperty("output.format");

                if (outputFormat == null) {
                    // If not in properties either, determine from input file extension
                    if (inputFilePath.toLowerCase().endsWith(".csv")) {
                        outputFormat = "json";
                    } else if (inputFilePath.toLowerCase().endsWith(".json")) {
                        outputFormat = "csv";
                    } else {
                        // Default to JSON if can't determine
                        outputFormat = "json";
                    }
                    System.out.println("Output format determined from input file: " + outputFormat);
                } else {
                    System.out.println("Using output format from properties: " + outputFormat);
                }
            }

            // Initialize the repository
            hub.repository = new ConversionRepository();

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
     * Parse subset configuration from properties
     */
    private Map<String, String> parseSubsetConfig(String subsetConfig) {
        Map<String, String> filterToSuffix = new LinkedHashMap<>();

        if (subsetConfig == null || subsetConfig.trim().isEmpty()) {
            return filterToSuffix;
        }

        System.out.println("Parsing subset configuration: " + subsetConfig);

        // Track current parsing state
        StringBuilder currentFilter = new StringBuilder();
        StringBuilder currentSuffix = new StringBuilder();
        boolean inQuotes = false;
        boolean foundColon = false;

        for (int i = 0; i < subsetConfig.length(); i++) {
            char c = subsetConfig.charAt(i);

            if (c == '"') {
                inQuotes = !inQuotes;
                // When leaving quotes, check if we're in filter or suffix part
                if (!inQuotes && !foundColon) {
                    // Finished parsing filter name in quotes
                    continue;
                } else if (!inQuotes && foundColon) {
                    // Finished parsing suffix in quotes
                    continue;
                }
            } else if (c == ':' && !inQuotes) {
                // Found the separator between filter and suffix
                foundColon = true;
                continue;
            } else if (c == ',' && !inQuotes) {
                // Found end of a pair, add to map and reset
                if (foundColon && currentFilter.length() > 0 && currentSuffix.length() > 0) {
                    String filter = currentFilter.toString().trim();
                    String suffix = currentSuffix.toString().trim();

                    // Remove quotes if present
                    if (filter.startsWith("\"") && filter.endsWith("\"")) {
                        filter = filter.substring(1, filter.length() - 1);
                    }
                    if (suffix.startsWith("\"") && suffix.endsWith("\"")) {
                        suffix = suffix.substring(1, suffix.length() - 1);
                    }

                    System.out.println("Parsed subset filter: '" + filter + "' with suffix: '" + suffix + "'");
                    filterToSuffix.put(filter, suffix);

                    // Reset for next pair
                    currentFilter = new StringBuilder();
                    currentSuffix = new StringBuilder();
                    foundColon = false;
                }
                continue;
            }

            // Add character to current part
            if (!foundColon) {
                currentFilter.append(c);
            } else {
                currentSuffix.append(c);
            }
        }

        // Process the last pair if any
        if (foundColon && currentFilter.length() > 0 && currentSuffix.length() > 0) {
            String filter = currentFilter.toString().trim();
            String suffix = currentSuffix.toString().trim();

            // Remove quotes if present
            if (filter.startsWith("\"") && filter.endsWith("\"")) {
                filter = filter.substring(1, filter.length() - 1);
            }
            if (suffix.startsWith("\"") && suffix.endsWith("\"")) {
                suffix = suffix.substring(1, suffix.length() - 1);
            }

            System.out.println("Parsed subset filter: '" + filter + "' with suffix: '" + suffix + "'");
            filterToSuffix.put(filter, suffix);
        }

        // Output the complete map
        System.out.println("Parsed " + filterToSuffix.size() + " subset filters:");
        for (Map.Entry<String, String> entry : filterToSuffix.entrySet()) {
            System.out.println("  - '" + entry.getKey() + "': '" + entry.getValue() + "'");
        }

        return filterToSuffix;
    }

    /**
     * Main processing method that orchestrates the conversion
     */
    public void process(String inputFilePath, String configFilePath, String outputFormat) throws Exception {
        System.out.println("Starting conversion process for: " + inputFilePath);

        // Store directory for output files
        File inputFile = new File(inputFilePath);
        inputDirectory = inputFile.getParent();
        if (inputDirectory == null) {
            inputDirectory = "."; // Current directory if no path specified
        }
        System.out.println("Input directory: " + inputDirectory);

        // Determine file format from extension
        String inputFormat = "";
        if (inputFilePath.toLowerCase().endsWith(".csv")) {
            inputFormat = "csv";
        } else if (inputFilePath.toLowerCase().endsWith(".json")) {
            inputFormat = "json";
        } else {
            throw new IllegalArgumentException("Unsupported input file format. Supported formats: .csv, .json");
        }

        // Load or generate configuration - Need to do this first to identify uniqueKey field if using multiple files
        configGenerator = loadConfigGenerator();

        // Check whether input is a single file or multiple files
        boolean useMultipleFiles = false;
        String csvFilename = "";

        // Track the actual first file path for output name generation
        String firstActualFilePath = inputFilePath;

        if ("csv".equals(inputFormat)) {
            String inputCsvPath = properties.getProperty("input.csv.path", "");
            String inputCsvFilename = properties.getProperty("input.csv.filename", "");

            // Check if filename contains commas (indicating multiple files)
            if (inputCsvFilename.contains(",")) {
                useMultipleFiles = true;
                csvFilename = inputCsvFilename;

                // Get the first file name for output generation
                String firstFile = inputCsvFilename.split(",")[0].trim();
                if (!new File(firstFile).isAbsolute()) {
                    firstActualFilePath = Paths.get(inputDirectory, firstFile).toString();
                } else {
                    firstActualFilePath = firstFile;
                }
            } else {
                // Check if the specified filename is a .list file
                File potentialListFile = new File(Paths.get(inputCsvPath, inputCsvFilename).toString());
                if (potentialListFile.exists() && potentialListFile.isFile() &&
                        potentialListFile.getName().endsWith(".list")) {
                    useMultipleFiles = true;
                    csvFilename = inputCsvFilename;

                    // Read the first filename from the list file
                    try {
                        List<String> fileList = Files.readAllLines(potentialListFile.toPath());
                        if (!fileList.isEmpty()) {
                            String firstFile = fileList.get(0).trim();
                            if (!new File(firstFile).isAbsolute()) {
                                firstActualFilePath = Paths.get(inputDirectory, firstFile).toString();
                            } else {
                                firstActualFilePath = firstFile;
                            }
                        }
                    } catch (IOException e) {
                        System.out.println("Warning: Could not read list file: " + e.getMessage());
                        // Keep default inputFilePath as fallback
                    }
                } else {
                    // Single file (normal behavior)
                    useMultipleFiles = false;
                    csvFilename = inputCsvFilename;
                }
            }
        }

        // Initialize the CSV converter (needed for header parsing)
        CsvConverter csvConverter = new CsvConverter(properties);

        // Load the appropriate converter based on the input format
        if ("csv".equals(inputFormat)) {
            // Parse the header to set up the repository structure
            if (useMultipleFiles) {
                // For multiple files, parse the first file's header
                String firstFile = firstActualFilePath;
                System.out.println("Parsing headers from first file: " + firstFile);
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
                System.out.println("Parsing headers from file: " + inputFilePath);
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
            JsonConverter jsonConverter = new JsonConverter(properties);

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
                System.out.println("Set headers from first JSON data row with " + headers.length + " fields");
            } else {
                System.out.println("Warning: No data rows to extract headers from JSON file");
            }
        }

        // Check if headers are still null - this could cause problems during export
        if (repository.getHeaders() == null) {
            System.out.println("Warning: Headers are still null after processing. Creating empty headers array.");
            repository.setHeaders(new String[0]);
        }

        // Ensure all derived fields are processed for all rows
        System.out.println("Ensuring all derived fields are processed before export...");
        int rowCount = repository.getDataRows().size();
        int processedFields = 0;

        // First, make sure all derived boolean fields are evaluated
        for (Map<String, Object> row : repository.getDataRows()) {
            repository.processDerivedFields(row);
            repository.processAggregateFields(row);
            repository.applySuppression(row);
            processedFields++;

            if (processedFields % 100 == 0) {
                System.out.println("Processed derived fields for " + processedFields + " out of " + rowCount + " rows");
            }
        }

        // Print some sample rows to verify data
        if (!repository.getDataRows().isEmpty()) {
            System.out.println("\nSample data verification (first row):");
            Map<String, Object> sampleRow = repository.getDataRows().get(0);

            // Print derived boolean fields
            for (String field : repository.getDerivedBooleanFields().keySet()) {
                System.out.println("Derived field '" + field + "' = " + sampleRow.get(field));
            }

            // Print subset filter fields if available
            String subsetConfig = properties.getProperty("output." + outputFormat.toLowerCase() + "Subsets");
            if (subsetConfig != null && !subsetConfig.trim().isEmpty()) {
                Map<String, String> filterToSuffix = parseSubsetConfig(subsetConfig);
                for (String filterField : filterToSuffix.keySet()) {
                    if (sampleRow.containsKey(filterField)) {
                        System.out.println("Filter field '" + filterField + "' = " + sampleRow.get(filterField));
                    } else {
                        System.out.println("Filter field '" + filterField + "' not found in sample row");
                    }
                }
            }
        }

        // Print list of all available fields for debugging
        System.out.println("\nAvailable fields in repository:");
        List<String> allFields = repository.getAllFieldNames();
        for (String field : allFields) {
            System.out.println("  - " + field);
        }

        // Export to the desired output format
        if ("json".equals(outputFormat.toLowerCase())) {
            JsonConverter jsonConverter = new JsonConverter(properties);

            // Check if subset exports are configured
            String subsetConfig = properties.getProperty("output.jsonSubsets");
            if (subsetConfig != null && !subsetConfig.trim().isEmpty()) {
                // Parse subset configuration
                Map<String, String> filterToSuffix = parseSubsetConfig(subsetConfig);

                if (!filterToSuffix.isEmpty()) {
                    System.out.println("Found " + filterToSuffix.size() + " subset filters for JSON export");

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
                    jsonConverter.exportSubsetsFromRepository(repository, baseJsonPath, filterToSuffix);
                    return; // Skip standard export since we've done subset exports
                }
            }

            // Standard export (no subsets)
            String outputFilename = properties.getProperty("output.json.filename");
            String outputJsonPath;

            if (outputFilename != null && !outputFilename.isEmpty()) {
                // If a specific output filename is provided in properties, use it
                File outputDir = new File(inputDirectory);
                outputJsonPath = new File(outputDir, outputFilename).getPath();
            } else {
                // Check if we should use a suffix
                String jsonSuffix = properties.getProperty("output.jsonSuffix");
                if (jsonSuffix != null && !jsonSuffix.isEmpty()) {
                    // Extract base path without extension
                    String basePathWithoutExt = firstActualFilePath.replaceAll("\\.[^.]+$", "");
                    // Add suffix and extension
                    outputJsonPath = basePathWithoutExt + jsonSuffix + ".json";
                } else {
                    // Just replace extension with .json
                    outputJsonPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".json");
                }
            }

            jsonConverter.exportFromRepository(repository, outputJsonPath);
            System.out.println("Exported data to JSON: " + outputJsonPath);
        } else if ("csv".equals(outputFormat.toLowerCase())) {
            // Check if subset exports are configured
            String subsetConfig = properties.getProperty("output.csvSubsets");
            if (subsetConfig != null && !subsetConfig.trim().isEmpty()) {
                // Parse subset configuration
                Map<String, String> filterToSuffix = parseSubsetConfig(subsetConfig);

                if (!filterToSuffix.isEmpty()) {
                    System.out.println("Found " + filterToSuffix.size() + " subset filters for CSV export");

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
                    csvConverter.exportSubsetsFromRepository(repository, baseCsvPath, filterToSuffix);
                    return; // Skip standard export since we've done subset exports
                }
            }

            // Standard export (no subsets)
            String outputFilename = properties.getProperty("output.csv.filename");
            String outputCsvPath;

            if (outputFilename != null && !outputFilename.isEmpty()) {
                // If a specific output filename is provided in properties, use it
                File outputDir = new File(inputDirectory);
                outputCsvPath = new File(outputDir, outputFilename).getPath();
            } else {
                // Check if we should use a suffix
                String csvSuffix = properties.getProperty("output.csvSuffix");
                if (csvSuffix != null && !csvSuffix.isEmpty()) {
                    // Extract base path without extension
                    String basePathWithoutExt = firstActualFilePath.replaceAll("\\.[^.]+$", "");
                    // Add suffix and extension
                    outputCsvPath = basePathWithoutExt + csvSuffix + ".csv";
                } else {
                    // Just replace extension with .csv
                    outputCsvPath = firstActualFilePath.replaceAll("\\.[^.]+$", ".csv");
                }
            }

            csvConverter.exportFromRepository(repository, outputCsvPath);
            System.out.println("Exported data to CSV: " + outputCsvPath);
        } else {
            throw new IllegalArgumentException("Unsupported output format: " + outputFormat);
        }

        System.out.println("Conversion completed successfully.");
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
                        // Get compound expressions from properties
                        String expressions = properties.getProperty("applicable.format.compound.expressions", "");

                        // Create with expressions parameter if available
                        if (!expressions.isEmpty()) {
                            return (ConfigGenerator) generatorClass.getConstructor(String.class, Properties.class)
                                    .newInstance(expressions, properties);
                        }
                    }
                } catch (Exception ex) {
                    System.out.println("Could not instantiate with compound expressions: " + ex.getMessage());
                }

                // Fallback to default constructor
                ConfigGenerator generator = (ConfigGenerator) generatorClass.getConstructor().newInstance();

                // Set properties if the generator has a setProperties method
                try {
                    generatorClass.getMethod("setProperties", Properties.class).invoke(generator, properties);
                } catch (Exception ex) {
                    // Ignore if the method doesn't exist
                }

                return generator;
            }
        } catch (Exception e) {
            System.out.println("Error loading config generator class: " + e.getMessage());
            System.out.println("Falling back to StandardConfigGenerator");
            return new StandardConfigGenerator(properties);
        }
    }

    /**
     * Load or generate configuration
     */
    private void loadConfiguration(String configFilePath, String[] headers, String[] firstDataRow) throws Exception {
        System.out.println("Checking for configuration file: " + configFilePath);

        // Check if the file exists before trying to parse it
        File configFile = new File(configFilePath);
        if (!configFile.exists()) {
            System.out.println("Configuration file not found: " + configFilePath);
            System.out.println("Will generate a new configuration file.");

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
            System.out.println("Successfully parsed config file: " + configFilePath);

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
                System.out.println("Created config directory: " + configDirectory);
            }
            configFilePath = Paths.get(configDirectory, configFilename).toString();
        } else {
            configFilePath = Paths.get(inputDirectory, configFilename).toString();
        }

        // Write the config file with pretty printing
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        mapper.enable(com.fasterxml.jackson.databind.SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(new File(configFilePath), config);

        System.out.println("Generated configuration saved to: " + configFilePath);
    }
}