package com.sysmuse.util;

import java.io.*;
import java.nio.file.Paths;
import java.util.*;

/**
 * Standalone runner for SQL Aggregation Analysis with support for custom field sets and where clauses
 * Can be used to analyze existing exported data in SQL database
 */
public class SqlAggregationAnalysisRunner {

    public static void main(String[] args) {
        try {
            // Load default properties
            Properties defaultProps = loadDefaultProperties();

            // Load system configuration
            String sysConfigDir = defaultProps.getProperty("sysconfig.directory", "");
            String sysConfigFile = defaultProps.getProperty("sysconfig.filename", "sysconfig.json");
            String sysConfigPath = Paths.get(sysConfigDir, sysConfigFile).toString();

            SystemConfig systemConfig = new SystemConfig();
            systemConfig.loadFromFile(sysConfigPath);

            // Extract database connection properties
            Properties connectionProperties = new Properties();
            connectionProperties.setProperty("database.driver",
                    defaultProps.getProperty("database.driver", "com.mysql.cj.jdbc.Driver"));
            connectionProperties.setProperty("database.url",
                    defaultProps.getProperty("database.url"));
            connectionProperties.setProperty("database.username",
                    defaultProps.getProperty("database.username"));
            connectionProperties.setProperty("database.password",
                    defaultProps.getProperty("database.password"));

            Set<String> customFields = null;
            Set<String> fieldsToAdd = null;
            Set<String> fieldsToRemove = null;

/*
Communications_with_Counsel
11685
Customer_Partner_Correspondence
7613
Financial_Records
7142
Internal_Wiki_Knowledge_Base
7934
Inventor_Communications
4894
Investor_Updates
9626
Marketing_and_Sales
10489
News_and_Newsletters
10722
Other_Patents_and_Applications
6284
Press_and_Media
10078
Prior_Art_Analysis
4941
Spam
11430

 */

            Map<String, Object> whereClause = null;
            //String applicBool = "Communications_with_Counsel";
            //String applicBool = "Marketing_and_Sales";
            //String applicBool = "News_and_Newsletters";
            //String applicBool = "Press_and_Media";
            //String applicBool = "Internal_Wiki_Knowledge_Base";
            //String applicBool = "Agreements_and_Licenses";
            //String applicBool = "Board_Communications";
            //String applicBool = "Corporate_Records";
            //String applicBool = "Customer_Partner_Correspondence";
            //String applicBool = "Financial_Records";
            //String applicBool = "Investor_Updates";
            String applicBool = "Inventor_Communications";

            whereClause = new HashMap<>();
            //whereClause.put("Spam", 1);
            //whereClause.put("RJ_FILE_TYPE", "Email");
            whereClause.put(applicBool, 1);

            fieldsToRemove = new HashSet<String>();
            //fieldsToRemove.add("Spam");
            fieldsToRemove.add(applicBool);

            SqlQueryBuilder tempQB = new SqlQueryBuilder(systemConfig, connectionProperties);
            Set<String> allBoolFields = tempQB.getAllBooleanFields();

            customFields = SqlQueryBuilder.modifyFieldSet(allBoolFields, fieldsToAdd, fieldsToRemove);

            // Parse command line arguments
            //AnalysisConfig config = parseCommandLineArgs(args);
            AnalysisConfig config = new AnalysisConfig();
            //config.maxDepth = 1;
            //config.maxDepth = 2;
            config.maxDepth = 4;
            //config.subsetThreshold = 500;
            config.subsetThreshold = 50;
            config.maxAggregateRecords = 200;
            config.customFields = customFields;
            config.whereClause = whereClause;

            // Initialize logging
            /*
            LoggingUtil.initialize(
                    defaultProps.getProperty("logging.level", "INFO"),
                    Boolean.parseBoolean(defaultProps.getProperty("logging.console", "true")),
                    Boolean.parseBoolean(defaultProps.getProperty("logging.file", "false")),
                    defaultProps.getProperty("logging.filename", "aggregation_analysis.log")
            );
             */

            LoggingUtil.info("=== SQL Nested Aggregation Analysis ===");
            LoggingUtil.info("Analysis Parameters:");
            LoggingUtil.info("  Max Depth: " + config.maxDepth);
            LoggingUtil.info("  Subset Threshold: " + config.subsetThreshold);
            LoggingUtil.info("  Max Aggregate Records: " + config.maxAggregateRecords);
            LoggingUtil.info("  Schema: " + systemConfig.getSqlSchemaName());
            LoggingUtil.info("  Table: " + systemConfig.getSqlTableName());

            if (config.customFields != null) {
                LoggingUtil.info("  Custom Fields: " + config.customFields);
            }
            if (config.whereClause != null && !config.whereClause.isEmpty()) {
                LoggingUtil.info("  Base Where Clause: " + config.whereClause);
            }

            // Perform the analysis
            if (config.customFields != null || config.whereClause != null) {
                SqlAnalysisRunner.performNestedAggregationAnalysis(
                        systemConfig,
                        connectionProperties,
                        config.maxDepth,
                        config.subsetThreshold,
                        config.maxAggregateRecords,
                        config.customFields,
                        config.whereClause
                );
            } else {
                SqlAnalysisRunner.performBooleanAggregationAnalysis(
                        systemConfig,
                        connectionProperties,
                        config.maxDepth,
                        config.subsetThreshold,
                        config.maxAggregateRecords
                );
            }

            LoggingUtil.info("=== Analysis Complete ===");

        } catch (Exception e) {
            System.err.println("Error during SQL aggregation analysis: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    /**
     * Configuration class for analysis parameters
     */
    private static class AnalysisConfig {
        int maxDepth = 1;
        int subsetThreshold = 500;
        int maxAggregateRecords = 200;
        Set<String> customFields = null;
        Map<String, Object> whereClause = null;
    }

    /**
     * Parse command line arguments for configuration
     */
    private static AnalysisConfig parseCommandLineArgs(String[] args) {
        AnalysisConfig config = new AnalysisConfig();

        for (int i = 0; i < args.length; i++) {
            String arg = args[i];

            switch (arg) {
                case "--help":
                case "-h":
                    printUsage();
                    System.exit(0);
                    break;

                case "--maxDepth":
                case "-d":
                    if (i + 1 < args.length) {
                        config.maxDepth = Integer.parseInt(args[++i]);
                    }
                    break;

                case "--threshold":
                case "-t":
                    if (i + 1 < args.length) {
                        config.subsetThreshold = Integer.parseInt(args[++i]);
                    }
                    break;

                case "--maxRecords":
                case "-r":
                    if (i + 1 < args.length) {
                        config.maxAggregateRecords = Integer.parseInt(args[++i]);
                    }
                    break;

                case "--fields":
                case "-f":
                    if (i + 1 < args.length) {
                        config.customFields = parseFieldList(args[++i]);
                    }
                    break;

                case "--where":
                case "-w":
                    if (i + 1 < args.length) {
                        config.whereClause = parseWhereClause(args[++i]);
                    }
                    break;

                default:
                    // Try to parse as positional arguments for backward compatibility
                    if (i == 0 && arg.matches("\\d+")) {
                        config.maxDepth = Integer.parseInt(arg);
                    } else if (i == 1 && arg.matches("\\d+")) {
                        config.subsetThreshold = Integer.parseInt(arg);
                    } else if (i == 2 && arg.matches("\\d+")) {
                        config.maxAggregateRecords = Integer.parseInt(arg);
                    }
                    break;
            }
        }

        return config;
    }

    /**
     * Parse comma-separated field list
     */
    private static Set<String> parseFieldList(String fieldListStr) {
        Set<String> fields = new LinkedHashSet<>();
        if (fieldListStr != null && !fieldListStr.trim().isEmpty()) {
            String[] fieldArray = fieldListStr.split(",");
            for (String field : fieldArray) {
                String trimmedField = field.trim();
                if (!trimmedField.isEmpty()) {
                    fields.add(trimmedField);
                }
            }
        }
        return fields;
    }

    /**
     * Parse where clause string into map
     * Format: "field1=value1,field2=value2"
     */
    private static Map<String, Object> parseWhereClause(String whereStr) {
        Map<String, Object> whereClause = new HashMap<>();
        if (whereStr != null && !whereStr.trim().isEmpty()) {
            String[] clauses = whereStr.split(",");
            for (String clause : clauses) {
                String[] parts = clause.split("=", 2);
                if (parts.length == 2) {
                    String field = parts[0].trim();
                    String value = parts[1].trim();

                    // Try to determine the value type
                    Object parsedValue = parseValue(value);
                    whereClause.put(field, parsedValue);
                }
            }
        }
        return whereClause;
    }

    /**
     * Parse a value string to appropriate type
     */
    private static Object parseValue(String value) {
        if (value == null || value.trim().isEmpty()) {
            return value;
        }

        value = value.trim();

        // Remove quotes if present
        if ((value.startsWith("'") && value.endsWith("'")) ||
                (value.startsWith("\"") && value.endsWith("\""))) {
            return value.substring(1, value.length() - 1);
        }

        // Try to parse as number
        try {
            if (value.contains(".")) {
                return Double.parseDouble(value);
            } else {
                return Integer.parseInt(value);
            }
        } catch (NumberFormatException e) {
            // Not a number, treat as string
        }

        // Check for boolean values
        if ("true".equalsIgnoreCase(value) || "false".equalsIgnoreCase(value)) {
            return Boolean.parseBoolean(value);
        }

        return value;
    }

    /**
     * Load default properties from application.properties
     */
    private static Properties loadDefaultProperties() {
        Properties defaultProps = new Properties();
        try (InputStream in = SqlAggregationAnalysisRunner.class.getClassLoader()
                .getResourceAsStream("application.properties")) {
            if (in != null) {
                defaultProps.load(in);
                LoggingUtil.info("Loaded default properties");
            } else {
                System.out.println("Default properties file not found, using built-in defaults");
            }
        } catch (IOException e) {
            System.err.println("Error loading default properties: " + e.getMessage());
        }
        return defaultProps;
    }

    /**
     * Print usage information
     */
    private static void printUsage() {
        System.out.println("SQL Nested Aggregation Analysis Runner");
        System.out.println("=====================================");
        System.out.println();
        System.out.println("Usage: SqlAggregationAnalysisRunner [options]");
        System.out.println();
        System.out.println("Options:");
        System.out.println("  --maxDepth, -d <number>     Maximum depth for nested aggregation (default: 1)");
        System.out.println("  --threshold, -t <number>    Minimum count for drilling down (default: 500)");
        System.out.println("  --maxRecords, -r <number>   Maximum number of results (default: 200)");
        System.out.println("  --fields, -f <list>         Comma-separated list of fields to aggregate");
        System.out.println("                              (default: all boolean fields)");
        System.out.println("  --where, -w <clause>        Base where clause in format 'field1=value1,field2=value2'");
        System.out.println("  --help, -h                  Show this help message");
        System.out.println();
        System.out.println("Backward compatible positional arguments:");
        System.out.println("  SqlAggregationAnalysisRunner [maxDepth] [threshold] [maxRecords]");
        System.out.println();
        System.out.println("Examples:");
        System.out.println("  # Basic analysis with custom depth and threshold");
        System.out.println("  SqlAggregationAnalysisRunner --maxDepth 3 --threshold 500");
        System.out.println();
        System.out.println("  # Analysis with custom fields");
        System.out.println("  SqlAggregationAnalysisRunner --fields \"Spam,Newsletter,Promotional\"");
        System.out.println();
        System.out.println("  # Analysis with base where clause");
        System.out.println("  SqlAggregationAnalysisRunner --where \"Category=Email,Active=1\"");
        System.out.println();
        System.out.println("  # Combined example");
        System.out.println("  SqlAggregationAnalysisRunner -d 3 -t 500 -f \"Spam,Newsletter\" -w \"Active=1\"");
        System.out.println();
        System.out.println("  # Backward compatible");
        System.out.println("  SqlAggregationAnalysisRunner 3 500 200");
    }
}