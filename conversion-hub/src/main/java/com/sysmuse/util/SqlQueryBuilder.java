package com.sysmuse.util;

import java.sql.*;
import java.util.*;
import java.util.stream.Collectors;
import java.io.*;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * SQL Query Builder for performing nested aggregation analysis on specified field sets.
 * Creates hierarchical subsets based on field combinations with configurable constraints.
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

    // Field configuration
    private Set<String> aggregationFields = new LinkedHashSet<>();
    private Map<String, Object> baseWhereClause = new HashMap<>();
    private Map<String, String> fieldTypes = new HashMap<>();

    // Results storage
    private List<AggregationResult> allResults = new ArrayList<>();

    /**
     * Represents a single aggregation result with depth and constraints
     */
    public static class AggregationResult {
        private int depth;
        private Map<String, Integer> aggregates;
        private Map<String, Boolean> constraints;
        private Map<String, Object> baseConstraints;
        private int totalCount;

        public AggregationResult(int depth) {
            this.depth = depth;
            this.aggregates = new LinkedHashMap<>();
            this.constraints = new LinkedHashMap<>();
            this.baseConstraints = new LinkedHashMap<>();
        }

        // Getters and setters
        public int getDepth() { return depth; }
        public Map<String, Integer> getAggregates() { return aggregates; }
        public Map<String, Boolean> getConstraints() { return constraints; }
        public Map<String, Object> getBaseConstraints() { return baseConstraints; }
        public int getTotalCount() { return totalCount; }
        public void setTotalCount(int totalCount) { this.totalCount = totalCount; }

        @Override
        public String toString() {
            return String.format("Depth %d, Base: %s, Constraints: %s, Aggregates: %s, Total: %d",
                    depth, baseConstraints, constraints, aggregates, totalCount);
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
     * Set the fields to use for aggregation
     */
    public void setAggregationFields(Set<String> fields) {
        this.aggregationFields = new LinkedHashSet<>(fields);
    }

    /**
     * Set base where clause constraints
     */
    public void setBaseWhereClause(Map<String, Object> whereClause) {
        this.baseWhereClause = new HashMap<>(whereClause);
    }

    /**
     * Helper method to get all boolean fields
     */
    public Set<String> getAllBooleanFields() throws SQLException {
        if (connection == null || connection.isClosed()) {
            connect();
        }
        return new LinkedHashSet<>(getBooleanFields());
    }

    /**
     * Helper method to create a new field collection by adding/removing fields
     */
    public static Set<String> modifyFieldSet(Set<String> baseFields,
                                             Set<String> fieldsToAdd,
                                             Set<String> fieldsToRemove) {
        Set<String> result = new LinkedHashSet<>(baseFields);

        if (fieldsToAdd != null) {
            result.addAll(fieldsToAdd);
        }

        if (fieldsToRemove != null) {
            result.removeAll(fieldsToRemove);
        }

        return result;
    }

    /**
     * Convenience method for adding fields only
     */
    public static Set<String> addFields(Set<String> baseFields, Set<String> fieldsToAdd) {
        return modifyFieldSet(baseFields, fieldsToAdd, null);
    }

    /**
     * Convenience method for removing fields only
     */
    public static Set<String> removeFields(Set<String> baseFields, Set<String> fieldsToRemove) {
        return modifyFieldSet(baseFields, null, fieldsToRemove);
    }

    /**
     * Perform nested aggregation analysis
     */
    public void performNestedAggregation() throws SQLException, IOException {
        try {
            connect();

            // If no aggregation fields specified, use all boolean fields
            if (aggregationFields.isEmpty()) {
                aggregationFields = getAllBooleanFields();
                LoggingUtil.info("No aggregation fields specified, using all boolean fields");
            }

            LoggingUtil.info("Using " + aggregationFields.size() + " fields for aggregation: " + aggregationFields);

            if (aggregationFields.isEmpty()) {
                LoggingUtil.warn("No aggregation fields available. Cannot perform analysis.");
                return;
            }

            // Get field types for proper where clause formatting
            loadFieldTypes();

            // Perform depth 0 aggregation (no constraints beyond base where clause)
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
     * Load field types from the database
     */
    private void loadFieldTypes() throws SQLException {
        String sql = "SHOW COLUMNS FROM `" + tableName + "`";

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {

            while (rs.next()) {
                String fieldName = rs.getString("Field");
                String fieldType = rs.getString("Type").toLowerCase();

                // Simplify type classification
                if (fieldType.contains("int") || fieldType.contains("decimal") ||
                        fieldType.contains("float") || fieldType.contains("double")) {
                    fieldTypes.put(fieldName, "NUMERIC");
                } else if (fieldType.contains("date") || fieldType.contains("time")) {
                    fieldTypes.put(fieldName, "DATE");
                } else if (fieldType.contains("char") || fieldType.contains("text")) {
                    fieldTypes.put(fieldName, "STRING");
                } else {
                    fieldTypes.put(fieldName, "OTHER");
                }
            }
        }

        LoggingUtil.debug("Loaded types for " + fieldTypes.size() + " fields");
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
     * Format a value for SQL where clause based on field type
     */
    private String formatValueForWhereClause(String fieldName, Object value) {
        if (value == null) {
            return "NULL";
        }

        String fieldType = fieldTypes.getOrDefault(fieldName, "OTHER");

        switch (fieldType) {
            case "NUMERIC":
                return value.toString();

            case "DATE":
                if (value instanceof LocalDate) {
                    return "'" + ((LocalDate) value).format(DateTimeFormatter.ofPattern("yyyy-MM-dd")) + "'";
                } else if (value instanceof LocalDateTime) {
                    return "'" + ((LocalDateTime) value).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")) + "'";
                } else {
                    // Assume string representation of date
                    return "'" + value.toString() + "'";
                }

            case "STRING":
                // Escape single quotes in string values
                String stringValue = value.toString().replace("'", "''");
                return "'" + stringValue + "'";

            default:
                // For other types, try to determine if it's numeric
                try {
                    Double.parseDouble(value.toString());
                    return value.toString();
                } catch (NumberFormatException e) {
                    // Treat as string
                    String otherValue = value.toString().replace("'", "''");
                    return "'" + otherValue + "'";
                }
        }
    }

    /**
     * Build where clause from base constraints and depth constraints
     */
    private String buildWhereClause(Map<String, Boolean> depthConstraints) {
        List<String> whereConditions = new ArrayList<>();

        // Add base where clause conditions
        for (Map.Entry<String, Object> entry : baseWhereClause.entrySet()) {
            String field = entry.getKey();
            Object value = entry.getValue();
            String formattedValue = formatValueForWhereClause(field, value);
            whereConditions.add("`" + field + "` = " + formattedValue);
        }

        // Add depth-specific constraints
        for (Map.Entry<String, Boolean> constraint : depthConstraints.entrySet()) {
            whereConditions.add("`" + constraint.getKey() + "` = " + (constraint.getValue() ? "1" : "0"));
        }

        return whereConditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", whereConditions);
    }

    /**
     * Perform aggregation with given constraints
     */
    private AggregationResult performAggregation(int depth, Map<String, Boolean> constraints) throws SQLException {
        StringBuilder sql = new StringBuilder();

        // Build SELECT clause with SUM aggregates and NULLs for constrained fields
        sql.append("SELECT ");

        List<String> selectClauses = new ArrayList<>();
        for (String field : aggregationFields) {
            if (constraints.containsKey(field)) {
                selectClauses.add("NULL AS `" + field + "`");
            } else {
                selectClauses.add("SUM(`" + field + "`) AS `" + field + "`");
            }
        }

        sql.append(String.join(", ", selectClauses));
        sql.append(" FROM `").append(tableName).append("`");

        // Build WHERE clause combining base where clause and constraints
        String whereClause = buildWhereClause(constraints);
        sql.append(whereClause);

        // Build GROUP BY clause for constrained fields
        if (!constraints.isEmpty()) {
            sql.append(" GROUP BY ");
            sql.append(constraints.keySet().stream()
                    .map(field -> "`" + field + "`")
                    .collect(Collectors.joining(", ")));
        }

        LoggingUtil.debug("Executing aggregation query: " + sql.toString());

        AggregationResult result = new AggregationResult(depth);
        result.constraints.putAll(constraints);
        result.baseConstraints.putAll(baseWhereClause);

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery(sql.toString())) {

            if (rs.next()) {
                int totalCount = 0;
                for (String field : aggregationFields) {
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
                    // For depth 0, total is the sum of all aggregation fields
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
     * Count total records matching the given constraints and base where clause
     */
    private int countRecordsWithConstraints(Map<String, Boolean> constraints) throws SQLException {
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT COUNT(*) as total FROM `").append(tableName).append("`");

        String whereClause = buildWhereClause(constraints);
        sql.append(whereClause);

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
        boolean includeConstraints = false;

        try (BufferedWriter writer = new BufferedWriter(new FileWriter(outputPath))) {
            // Write header
            List<String> headers = new ArrayList<>();
            headers.add("Depth");
            headers.add("TotalCount");

            // Add base constraint columns
            for (String field : baseWhereClause.keySet()) {
                headers.add("BaseConstraint_" + field);
            }

            // Add constraint columns for aggregation fields
            if (includeConstraints) {
                for (String field : aggregationFields) {
                    headers.add("Constraint_" + field);
                }
            }

            // Add aggregate columns
            for (String field : aggregationFields) {
                //headers.add("Sum_" + field);
                headers.add(field);
            }

            writer.write(String.join(",", headers));
            writer.newLine();

            // Write data rows
            for (AggregationResult result : allResults) {
                List<String> row = new ArrayList<>();

                // Depth and total count
                row.add(String.valueOf(result.getDepth()));
                row.add(String.valueOf(result.getTotalCount()));

                // Base constraint values
                for (String field : baseWhereClause.keySet()) {
                    Object value = result.getBaseConstraints().get(field);
                    row.add(value != null ? value.toString() : "");
                }

                // Constraint values (1 for true constraint, 0 for false, empty for no constraint)
                if (includeConstraints) {
                    for (String field : aggregationFields) {
                        Boolean constraint = result.getConstraints().get(field);
                        if (constraint != null) {
                            row.add(constraint ? "1" : "0");
                        } else {
                            row.add("");
                        }
                    }
                }

                // Aggregate values (null becomes empty string)
                for (String field : aggregationFields) {
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
        LoggingUtil.info("Total aggregation fields analyzed: " + aggregationFields.size());
        LoggingUtil.info("Aggregation fields: " + aggregationFields);
        LoggingUtil.info("Base where clause: " + baseWhereClause);
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
     * Get the current aggregation fields
     */
    public Set<String> getAggregationFields() {
        return new LinkedHashSet<>(aggregationFields);
    }

    /**
     * Get the current base where clause
     */
    public Map<String, Object> getBaseWhereClause() {
        return new HashMap<>(baseWhereClause);
    }

    /**
     * Main method for testing
     */
    public static void main(String[] args) {
        try {
            // Load configuration
            SystemConfig systemConfig = new SystemConfig();
            Properties connectionProperties = new Properties();

            // Example usage
            SqlQueryBuilder queryBuilder = new SqlQueryBuilder(systemConfig, connectionProperties);

            // Set analysis parameters
            queryBuilder.setAnalysisParameters(2, 500, 200);

            // Example 1: Use all boolean fields (default behavior)
            queryBuilder.performNestedAggregation();

            // Example 2: Use custom field set
            Set<String> customFields = Set.of("Spam", "Newsletter", "Promotional");
            queryBuilder.setAggregationFields(customFields);

            // Example 3: Add base where clause
            Map<String, Object> whereClause = new HashMap<>();
            whereClause.put("Category", "Email");
            whereClause.put("Active", 1);
            queryBuilder.setBaseWhereClause(whereClause);

            queryBuilder.performNestedAggregation();
            queryBuilder.printAnalysisSummary();

        } catch (Exception e) {
            LoggingUtil.error("Error during nested aggregation analysis", e);
        }
    }
}