package com.sysmuse.util;

import java.sql.*;
import java.util.*;
import java.util.stream.Collectors;
import java.io.*;
import java.nio.file.Paths;

/**
 * SQL Query Builder for performing nested aggregation analysis on boolean fields.
 * Creates hierarchical subsets based on boolean field combinations.
 */
public class SqlQueryBuilder {

    private SystemConfig systemConfig;
    private Properties connectionProperties;
    private Connection connection;
    private String schemaName;
    private String tableName;

    // Configuration parameters
    private int maxDepth = 1;
    private int subsetThreshold = 500;
    private int maxAggregateRecords = 200;

    // Results storage
    private List<AggregationResult> allResults = new ArrayList<>();
    private List<String> booleanFields = new ArrayList<>();

    /**
     * Represents a single aggregation result with depth and constraints
     */
    public static class AggregationResult {
        private int depth;
        private Map<String, Integer> aggregates;
        private Map<String, Boolean> constraints;
        private int totalCount;

        public AggregationResult(int depth) {
            this.depth = depth;
            this.aggregates = new LinkedHashMap<>();
            this.constraints = new LinkedHashMap<>();
        }

        // Getters and setters
        public int getDepth() { return depth; }
        public Map<String, Integer> getAggregates() { return aggregates; }
        public Map<String, Boolean> getConstraints() { return constraints; }
        public int getTotalCount() { return totalCount; }
        public void setTotalCount(int totalCount) { this.totalCount = totalCount; }

        @Override
        public String toString() {
            return String.format("Depth %d, Constraints: %s, Aggregates: %s, Total: %d",
                    depth, constraints, aggregates, totalCount);
        }
    }

    public SqlQueryBuilder(SystemConfig systemConfig, Properties connectionProperties) {
        this.systemConfig = systemConfig;
        this.connectionProperties = connectionProperties;
        this.schemaName = systemConfig.getSqlSchemaName();
        this.tableName = systemConfig.getSqlTableName();
    }

    /**
     * Set analysis parameters
     */
    public void setAnalysisParameters(int maxDepth, int subsetThreshold, int maxAggregateRecords) {
        this.maxDepth = maxDepth;
        this.subsetThreshold = subsetThreshold;
        this.maxAggregateRecords = maxAggregateRecords;
    }

    /**
     * Perform nested aggregation analysis on boolean fields
     */
    public void performNestedAggregation() throws SQLException, IOException {
        try {
            connect();

            // Get all boolean fields from the table
            booleanFields = getBooleanFields();
            LoggingUtil.info("Found " + booleanFields.size() + " boolean fields: " + booleanFields);

            if (booleanFields.isEmpty()) {
                LoggingUtil.warn("No boolean fields found in table. Cannot perform aggregation analysis.");
                return;
            }

            // Perform depth 0 aggregation (no constraints)
            AggregationResult depthZero = performAggregation(0, new HashMap<>());
            allResults.add(depthZero);
            LoggingUtil.info("Depth 0 aggregation completed. Total count: " + depthZero.getTotalCount());

            // Perform nested aggregations
            performNestedAggregations(1, depthZero);

            // Export results to CSV
            exportResultsToCSV();

            LoggingUtil.info("Nested aggregation analysis completed. Total results: " + allResults.size());

        } finally {
            if (connection != null && !connection.isClosed()) {
                connection.close();
            }
        }
    }

    /**
     * Connect to the database
     */
    private void connect() throws SQLException {
        String url = connectionProperties.getProperty("database.url");
        String username = connectionProperties.getProperty("database.username");
        String password = connectionProperties.getProperty("database.password");
        String driver = connectionProperties.getProperty("database.driver", "com.mysql.cj.jdbc.Driver");

        try {
            Class.forName(driver);
        } catch (ClassNotFoundException e) {
            throw new SQLException("Database driver not found: " + driver, e);
        }

        connection = DriverManager.getConnection(url, username, password);
        LoggingUtil.info("Connected to database for query analysis");

        // Switch to schema if specified
        if (schemaName != null && !schemaName.trim().isEmpty()) {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("USE `" + schemaName + "`");
            }
        }
    }

    /**
     * Get all boolean fields from the table
     */
    private List<String> getBooleanFields() throws SQLException {
        List<String> fields = new ArrayList<>();
        String sql = "SHOW COLUMNS FROM `" + tableName + "` WHERE Type = 'tinyint(1)'";

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {

            while (rs.next()) {
                String fieldName = rs.getString("Field");
                fields.add(fieldName);
            }
        }

        // If no BOOLEAN/TINYINT fields found, try to find fields with only 0/1 values
        if (fields.isEmpty()) {
            LoggingUtil.info("No explicit boolean fields found. Checking for binary (0/1) fields...");
            fields = detectBinaryFields();
        }

        return fields;
    }

    /**
     * Detect fields that contain only 0/1 values (likely boolean fields)
     */
    private List<String> detectBinaryFields() throws SQLException {
        List<String> binaryFields = new ArrayList<>();

        // Get all column names
        String sql = "SHOW COLUMNS FROM `" + tableName + "`";
        List<String> allColumns = new ArrayList<>();

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {

            while (rs.next()) {
                String columnName = rs.getString("Field");
                String columnType = rs.getString("Type");

                // Skip non-numeric types
                if (columnType.contains("int") || columnType.contains("decimal") ||
                        columnType.contains("float") || columnType.contains("double")) {
                    allColumns.add(columnName);
                }
            }
        }

        // Check each numeric column for binary values
        for (String column : allColumns) {
            String checkSql = String.format(
                    "SELECT COUNT(DISTINCT `%s`) as distinct_count, " +
                            "MIN(`%s`) as min_val, MAX(`%s`) as max_val " +
                            "FROM `%s` WHERE `%s` IS NOT NULL",
                    column, column, column, tableName, column
            );

            try (Statement stmt = connection.createStatement();
                 ResultSet rs = stmt.executeQuery(checkSql)) {

                if (rs.next()) {
                    int distinctCount = rs.getInt("distinct_count");
                    int minVal = rs.getInt("min_val");
                    int maxVal = rs.getInt("max_val");

                    // If field has only 2 distinct values (0 and 1), consider it boolean
                    if (distinctCount == 2 && minVal == 0 && maxVal == 1) {
                        binaryFields.add(column);
                        LoggingUtil.info("Detected binary field: " + column);
                    }
                }
            }
        }

        return binaryFields;
    }

    /**
     * Perform aggregation with given constraints
     */
    private AggregationResult performAggregation(int depth, Map<String, Boolean> constraints) throws SQLException {
        StringBuilder sql = new StringBuilder();

        // Build SELECT clause with SUM aggregates and NULLs for constrained fields
        sql.append("SELECT ");

        List<String> selectClauses = new ArrayList<>();
        for (String field : booleanFields) {
            if (constraints.containsKey(field)) {
                selectClauses.add("NULL AS `" + field + "`");
            } else {
                selectClauses.add("SUM(`" + field + "`) AS `" + field + "`");
            }
        }

        sql.append(String.join(", ", selectClauses));
        sql.append(" FROM `").append(tableName).append("`");

        // Build WHERE clause
        if (!constraints.isEmpty()) {
            sql.append(" WHERE ");
            List<String> whereConditions = new ArrayList<>();
            for (Map.Entry<String, Boolean> constraint : constraints.entrySet()) {
                whereConditions.add("`" + constraint.getKey() + "` = " + (constraint.getValue() ? "1" : "0"));
            }
            sql.append(String.join(" AND ", whereConditions));

            // Build GROUP BY clause for constrained fields
            sql.append(" GROUP BY ");
            sql.append(constraints.keySet().stream()
                    .map(field -> "`" + field + "`")
                    .collect(Collectors.joining(", ")));
        }

        LoggingUtil.debug("Executing aggregation query: " + sql.toString());

        AggregationResult result = new AggregationResult(depth);
        result.constraints.putAll(constraints);

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql.toString())) {

            if (rs.next()) {
                int totalCount = 0;
                for (String field : booleanFields) {
                    Object value = rs.getObject(field);
                    if (value != null && value instanceof Number) {
                        int count = ((Number) value).intValue();
                        result.aggregates.put(field, count);
                        if (!constraints.containsKey(field)) {
                            totalCount += count; // Only count non-constrained fields
                        }
                    } else {
                        result.aggregates.put(field, null);
                    }
                }

                // Calculate total count more accurately
                if (constraints.isEmpty()) {
                    // For depth 0, total is the sum of all boolean fields
                    result.setTotalCount(totalCount);
                } else {
                    // For deeper levels, count all records matching constraints
                    result.setTotalCount(countRecordsWithConstraints(constraints));
                }
            }
        }

        return result;
    }

    /**
     * Count total records matching the given constraints
     */
    private int countRecordsWithConstraints(Map<String, Boolean> constraints) throws SQLException {
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT COUNT(*) as total FROM `").append(tableName).append("`");

        if (!constraints.isEmpty()) {
            sql.append(" WHERE ");
            List<String> whereConditions = new ArrayList<>();
            for (Map.Entry<String, Boolean> constraint : constraints.entrySet()) {
                whereConditions.add("`" + constraint.getKey() + "` = " + (constraint.getValue() ? "1" : "0"));
            }
            sql.append(String.join(" AND ", whereConditions));
        }

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql.toString())) {

            if (rs.next()) {
                return rs.getInt("total");
            }
        }

        return 0;
    }

    /**
     * Perform nested aggregations recursively
     */
    private void performNestedAggregations(int currentDepth, AggregationResult parentResult) throws SQLException {
        if (currentDepth > maxDepth || allResults.size() >= maxAggregateRecords) {
            return;
        }

        // Find fields with counts above threshold that can be drilled down
        List<String> candidateFields = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : parentResult.getAggregates().entrySet()) {
            String field = entry.getKey();
            Integer count = entry.getValue();

            // Only drill down on fields that:
            // 1. Have a count above threshold
            // 2. Are not already constrained
            // 3. Have a non-null value (not constrained in parent)
            if (count != null && count >= subsetThreshold && !parentResult.getConstraints().containsKey(field)) {
                candidateFields.add(field);
            }
        }

        // Sort by count (highest first)
        candidateFields.sort((a, b) -> {
            Integer countA = parentResult.getAggregates().get(a);
            Integer countB = parentResult.getAggregates().get(b);
            return countB.compareTo(countA);
        });

        LoggingUtil.info("Depth " + currentDepth + " - Found " + candidateFields.size() +
                " candidate fields above threshold");

        // Create aggregations for each candidate field
        for (String field : candidateFields) {
            if (allResults.size() >= maxAggregateRecords) {
                LoggingUtil.info("Reached maximum aggregate records limit (" + maxAggregateRecords + ")");
                break;
            }

            // Create new constraints by adding this field as TRUE
            Map<String, Boolean> newConstraints = new HashMap<>(parentResult.getConstraints());
            newConstraints.put(field, true);

            // Perform aggregation with new constraints
            AggregationResult result = performAggregation(currentDepth, newConstraints);
            allResults.add(result);

            LoggingUtil.info("Depth " + currentDepth + " - Added constraint: " + field + " = true. " +
                    "Result count: " + result.getTotalCount());

            // Recursively drill down further
            performNestedAggregations(currentDepth + 1, result);
        }
    }

    /**
     * Export all results to CSV file
     */
    private void exportResultsToCSV() throws IOException {
        String outputPath = Paths.get(systemConfig.getInputPath(),
                tableName + "_nested_aggregation.csv").toString();

        try (BufferedWriter writer = new BufferedWriter(new FileWriter(outputPath))) {
            // Write header
            List<String> headers = new ArrayList<>();
            headers.add("Depth");
            headers.add("TotalCount");

            // Add constraint columns
            for (String field : booleanFields) {
                headers.add("Constraint_" + field);
            }

            // Add aggregate columns
            for (String field : booleanFields) {
                headers.add("Sum_" + field);
            }

            writer.write(String.join(",", headers));
            writer.newLine();

            // Write data rows
            for (AggregationResult result : allResults) {
                List<String> row = new ArrayList<>();

                // Depth and total count
                row.add(String.valueOf(result.getDepth()));
                row.add(String.valueOf(result.getTotalCount()));

                // Constraint values (1 for true constraint, 0 for false, empty for no constraint)
                for (String field : booleanFields) {
                    Boolean constraint = result.getConstraints().get(field);
                    if (constraint != null) {
                        row.add(constraint ? "1" : "0");
                    } else {
                        row.add("");
                    }
                }

                // Aggregate values (null becomes empty string)
                for (String field : booleanFields) {
                    Integer aggregate = result.getAggregates().get(field);
                    row.add(aggregate != null ? aggregate.toString() : "");
                }

                writer.write(String.join(",", row));
                writer.newLine();
            }
        }

        LoggingUtil.info("Exported nested aggregation results to: " + outputPath);
        LoggingUtil.info("Total results exported: " + allResults.size());
    }

    /**
     * Get summary of analysis results
     */
    public void printAnalysisSummary() {
        Map<Integer, Integer> depthCounts = new HashMap<>();

        for (AggregationResult result : allResults) {
            depthCounts.put(result.getDepth(),
                    depthCounts.getOrDefault(result.getDepth(), 0) + 1);
        }

        LoggingUtil.info("=== Nested Aggregation Analysis Summary ===");
        LoggingUtil.info("Total boolean fields analyzed: " + booleanFields.size());
        LoggingUtil.info("Total aggregation results: " + allResults.size());
        LoggingUtil.info("Results by depth:");

        for (Map.Entry<Integer, Integer> entry : depthCounts.entrySet()) {
            LoggingUtil.info("  Depth " + entry.getKey() + ": " + entry.getValue() + " results");
        }

        LoggingUtil.info("Parameters used:");
        LoggingUtil.info("  Max Depth: " + maxDepth);
        LoggingUtil.info("  Subset Threshold: " + subsetThreshold);
        LoggingUtil.info("  Max Aggregate Records: " + maxAggregateRecords);
        LoggingUtil.info("==========================================");
    }

    /**
     * Main method for testing
     */
    public static void main(String[] args) {
        try {
            // Load configuration
            SystemConfig systemConfig = new SystemConfig();
            Properties connectionProperties = new Properties();

            // Load connection properties from file or set manually
            // connectionProperties.setProperty("database.url", "jdbc:mysql://localhost:3306/conversion_hub");
            // connectionProperties.setProperty("database.username", "conversion_user");
            // connectionProperties.setProperty("database.password", "your_password");

            SqlQueryBuilder queryBuilder = new SqlQueryBuilder(systemConfig, connectionProperties);

            // Set analysis parameters
            queryBuilder.setAnalysisParameters(
                    2,      // maxDepth
                    500,    // subsetThreshold
                    200     // maxAggregateRecords
            );

            // Perform analysis
            queryBuilder.performNestedAggregation();
            queryBuilder.printAnalysisSummary();

        } catch (Exception e) {
            LoggingUtil.error("Error during nested aggregation analysis", e);
        }
    }
}