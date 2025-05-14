package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.util.Properties;

/**
 * Standalone runner for SQL Boolean Aggregation Analysis
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

            // Parse command line arguments for analysis parameters
            int maxDepth = 2;
            int subsetThreshold = 500;
            int maxAggregateRecords = 200;

            if (args.length > 0) {
                maxDepth = Integer.parseInt(args[0]);
            }
            if (args.length > 1) {
                subsetThreshold = Integer.parseInt(args[1]);
            }
            if (args.length > 2) {
                maxAggregateRecords = Integer.parseInt(args[2]);
            }

            // Initialize logging
            /*
            LoggingUtil.initialize(
                    defaultProps.getProperty("logging.level", "INFO"),
                    Boolean.parseBoolean(defaultProps.getProperty("logging.console", "true")),
                    Boolean.parseBoolean(defaultProps.getProperty("logging.file", "false")),
                    defaultProps.getProperty("logging.filename", "aggregation_analysis.log")
            );
             */

            LoggingUtil.info("=== SQL Boolean Aggregation Analysis ===");
            LoggingUtil.info("Analysis Parameters:");
            LoggingUtil.info("  Max Depth: " + maxDepth);
            LoggingUtil.info("  Subset Threshold: " + subsetThreshold);
            LoggingUtil.info("  Max Aggregate Records: " + maxAggregateRecords);
            LoggingUtil.info("  Schema: " + systemConfig.getSqlSchemaName());
            LoggingUtil.info("  Table: " + systemConfig.getSqlTableName());

            // Perform the analysis
            SqlAnalysisRunner.performBooleanAggregationAnalysis(
                    systemConfig,
                    connectionProperties,
                    maxDepth,
                    subsetThreshold,
                    maxAggregateRecords
            );

            LoggingUtil.info("=== Analysis Complete ===");

        } catch (Exception e) {
            System.err.println("Error during SQL aggregation analysis: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
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
        System.out.println("Usage: SqlAggregationAnalysisRunner [maxDepth] [subsetThreshold] [maxAggregateRecords]");
        System.out.println("  maxDepth: Maximum depth for nested aggregation (default: 1)");
        System.out.println("  subsetThreshold: Minimum count for drilling down (default: 500)");
        System.out.println("  maxAggregateRecords: Maximum number of results (default: 200)");
        System.out.println();
        System.out.println("Example: SqlAggregationAnalysisRunner 3 500 200");
    }
}