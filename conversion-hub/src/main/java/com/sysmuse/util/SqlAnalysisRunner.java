package com.sysmuse.util;

import java.sql.SQLException;
import java.io.IOException;
import java.util.Properties;

/**
 * Integration class for performing SQL aggregation analysis
 * after data has been exported to a SQL database.
 */
public class SqlAnalysisRunner {

    /**
     * Perform nested aggregation analysis on exported data
     *
     * @param systemConfig The system configuration
     * @param connectionProperties Database connection properties
     * @param maxDepth Maximum depth for nested aggregation (default: 1)
     * @param subsetThreshold Minimum count threshold for drilling down (default: 500)
     * @param maxAggregateRecords Maximum number of aggregate records to generate (default: 200)
     */
    public static void performBooleanAggregationAnalysis(
            SystemConfig systemConfig,
            Properties connectionProperties,
            int maxDepth,
            int subsetThreshold,
            int maxAggregateRecords) throws SQLException, IOException {

        LoggingUtil.info("Starting nested boolean aggregation analysis...");

        // Create and configure query builder
        SqlQueryBuilder queryBuilder = new SqlQueryBuilder(systemConfig, connectionProperties);
        queryBuilder.setAnalysisParameters(maxDepth, subsetThreshold, maxAggregateRecords);

        // Perform the analysis
        queryBuilder.performNestedAggregation();
        queryBuilder.printAnalysisSummary();

        LoggingUtil.info("Nested boolean aggregation analysis completed");
    }

    /**
     * Convenience method with default parameters
     */
    public static void performBooleanAggregationAnalysis(
            SystemConfig systemConfig,
            Properties connectionProperties) throws SQLException, IOException {

        performBooleanAggregationAnalysis(systemConfig, connectionProperties, 1, 500, 200);
    }
}