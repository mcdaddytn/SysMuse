package com.sysmuse.util;

import java.sql.SQLException;
import java.io.IOException;
import java.util.*;

/**
 * Integration class for performing SQL aggregation analysis
 * after data has been exported to a SQL database.
 * Updated to support custom field sets and where clauses.
 */
public class SqlAnalysisRunner {

    /**
     * Perform nested aggregation analysis on exported data with custom configuration
     *
     * @param systemConfig The system configuration
     * @param connectionProperties Database connection properties
     * @param maxDepth Maximum depth for nested aggregation (default: 1)
     * @param subsetThreshold Minimum count threshold for drilling down (default: 500)
     * @param maxAggregateRecords Maximum number of aggregate records to generate (default: 200)
     * @param aggregationFields Custom set of fields to aggregate (null for all boolean fields)
     * @param baseWhereClause Base where clause constraints (null for no base constraints)
     */
    public static void performNestedAggregationAnalysis(
            SystemConfig systemConfig,
            Properties connectionProperties,
            int maxDepth,
            int subsetThreshold,
            int maxAggregateRecords,
            Set<String> aggregationFields,
            Map<String, Object> baseWhereClause) throws SQLException, IOException {

        LoggingUtil.info("Starting nested aggregation analysis...");

        if (aggregationFields != null) {
            LoggingUtil.info("Using custom aggregation fields: " + aggregationFields);
        } else {
            LoggingUtil.info("Using all boolean fields for aggregation");
        }

        if (baseWhereClause != null && !baseWhereClause.isEmpty()) {
            LoggingUtil.info("Using base where clause: " + baseWhereClause);
        }

        // Create and configure query builder
        SqlQueryBuilder queryBuilder = new SqlQueryBuilder(systemConfig, connectionProperties);
        queryBuilder.setAnalysisParameters(maxDepth, subsetThreshold, maxAggregateRecords);

        // Set custom aggregation fields if provided
        if (aggregationFields != null) {
            queryBuilder.setAggregationFields(aggregationFields);
        }

        // Set base where clause if provided
        if (baseWhereClause != null) {
            queryBuilder.setBaseWhereClause(baseWhereClause);
        }

        // Perform the analysis
        queryBuilder.performNestedAggregation();
        queryBuilder.printAnalysisSummary();

        LoggingUtil.info("Nested aggregation analysis completed");
    }

    /**
     * Perform boolean aggregation analysis using all boolean fields
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

        performNestedAggregationAnalysis(systemConfig, connectionProperties,
                maxDepth, subsetThreshold, maxAggregateRecords,
                null, null);
    }

    /**
     * Convenience method with default parameters for boolean analysis
     */
    public static void performBooleanAggregationAnalysis(
            SystemConfig systemConfig,
            Properties connectionProperties) throws SQLException, IOException {

        performBooleanAggregationAnalysis(systemConfig, connectionProperties, 1, 500, 200);
    }

    /**
     * Create a custom field set from all boolean fields with modifications
     *
     * @param systemConfig The system configuration
     * @param connectionProperties Database connection properties
     * @param fieldsToAdd Additional fields to include (can be null)
     * @param fieldsToRemove Fields to exclude from boolean set (can be null)
     * @return Set of field names for aggregation
     */
    public static Set<String> createCustomFieldSet(
            SystemConfig systemConfig,
            Properties connectionProperties,
            Set<String> fieldsToAdd,
            Set<String> fieldsToRemove) throws SQLException, IOException {

        // Get all boolean fields as base
        SqlQueryBuilder queryBuilder = new SqlQueryBuilder(systemConfig, connectionProperties);
        Set<String> booleanFields = queryBuilder.getAllBooleanFields();

        // Modify the set using the helper method
        return SqlQueryBuilder.modifyFieldSet(booleanFields, fieldsToAdd, fieldsToRemove);
    }

    /**
     * Perform aggregation analysis with field modifications
     *
     * @param systemConfig The system configuration
     * @param connectionProperties Database connection properties
     * @param maxDepth Maximum depth for nested aggregation
     * @param subsetThreshold Minimum count threshold for drilling down
     * @param maxAggregateRecords Maximum number of aggregate records to generate
     * @param fieldsToAdd Additional fields to include in aggregation
     * @param fieldsToRemove Fields to exclude from aggregation
     * @param baseWhereClause Base where clause constraints
     */
    public static void performCustomAggregationAnalysis(
            SystemConfig systemConfig,
            Properties connectionProperties,
            int maxDepth,
            int subsetThreshold,
            int maxAggregateRecords,
            Set<String> fieldsToAdd,
            Set<String> fieldsToRemove,
            Map<String, Object> baseWhereClause) throws SQLException, IOException {

        // Create custom field set
        Set<String> customFields = createCustomFieldSet(systemConfig, connectionProperties,
                fieldsToAdd, fieldsToRemove);

        // Perform analysis with custom configuration
        performNestedAggregationAnalysis(systemConfig, connectionProperties,
                maxDepth, subsetThreshold, maxAggregateRecords,
                customFields, baseWhereClause);
    }
}