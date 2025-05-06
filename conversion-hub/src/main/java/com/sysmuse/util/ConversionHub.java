package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * ConversionHub - Main application class that coordinates the conversion process
 * between different data formats like CSV and JSON.
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

            // If no output format specified, determine from input file extension
            if (outputFormat == null) {
                if (inputFilePath.toLowerCase().endsWith(".csv")) {
                    outputFormat = "json";
                } else if (inputFilePath.toLowerCase().endsWith(".json")) {
                    outputFormat = "csv";
                } else {
                    // Default to JSON if can't determine
                    outputFormat = "json";
                }
                System.out.println("Output format determined from input file: " + outputFormat);
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
        
        // Load the appropriate converter based on the input format
        if ("csv".equals(inputFormat)) {
            CsvConverter csvConverter = new CsvConverter(properties);
            
            // Parse the CSV header and first data row for initial configuration
            String[] headers = csvConverter.parseCSVHeader(inputFilePath);
            String[] firstDataRow = csvConverter.parseFirstDataRow(inputFilePath);
            
            // Initialize the repository with header information
            repository.setHeaders(headers);
            
            // Infer data types from the first row
            repository.inferTypes(headers, firstDataRow);
            
            // Load or generate configuration
            configGenerator = loadConfigGenerator();
            loadConfiguration(configFilePath, headers, firstDataRow);
            
            // Import the data into the repository
            csvConverter.importToRepository(inputFilePath, repository);
        } else if ("json".equals(inputFormat)) {
            JsonConverter jsonConverter = new JsonConverter(properties);
            
            // Import the data into the repository
            jsonConverter.importToRepository(inputFilePath, repository);
            
            // Configuration should be embedded in the JSON file
            // No need to load separately
        }
        
        // Export to the desired output format
        if ("json".equals(outputFormat)) {
            JsonConverter jsonConverter = new JsonConverter(properties);
            String outputJsonPath = inputFilePath.replaceAll("\\.[^.]+$", ".json");
            jsonConverter.exportFromRepository(repository, outputJsonPath);
            System.out.println("Exported data to JSON: " + outputJsonPath);
        } else if ("csv".equals(outputFormat)) {
            CsvConverter csvConverter = new CsvConverter(properties);
            
            // Check if we should use a specific suffix for the output CSV
            String outputCsvSuffix = properties.getProperty("output.csvSuffix");
            String outputCsvPath;
            
            if (outputCsvSuffix != null && !outputCsvSuffix.isEmpty()) {
                outputCsvPath = inputFilePath.replaceAll("\\.[^.]+$", outputCsvSuffix);
            } else {
                outputCsvPath = inputFilePath.replaceAll("\\.[^.]+$", ".csv");
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
