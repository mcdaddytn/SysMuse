package com.sysmuse.util;

import java.sql.*;
import java.sql.Date;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * SqlExporter - Utility class for exporting repository data to SQL databases
 * Supports MySQL with intelligent type mapping and schema generation
 */
public class SqlExporter {

    private final SystemConfig systemConfig;
    private final Properties connectionProperties;
    private Connection connection;

    // SQL type mapping constants
    private static final int VARCHAR_THRESHOLD = 255;
    private static final int TEXT_THRESHOLD = 65535;
    private static final int MEDIUMTEXT_THRESHOLD = 16777215;

    // Standard varchar sizes (powers of 2 - 1)
    private static final int[] VARCHAR_SIZES = {31, 63, 127, 255, 511, 1023, 2047, 4095};

    public SqlExporter(SystemConfig systemConfig, Properties connectionProperties) {
        this.systemConfig = systemConfig;
        this.connectionProperties = connectionProperties;
    }

    /**
     * Export repository data to SQL database
     */
    public void exportToDatabase(ConversionRepository repository) throws SQLException {
        try {
            // Establish connection
            connect();

            // Create schema if needed
            createSchemaIfNeeded();

            // Analyze string field lengths
            Map<String, Integer> stringFieldLengths = analyzeStringFieldLengths(repository);

            // Generate table structure
            String tableName = getTableName();
            String createTableSQL = generateCreateTableSQL(repository, stringFieldLengths, tableName);

            // Drop and recreate table if configured
            if (systemConfig.isSqlDropTableBeforeCreate()) {
                dropTableIfExists(tableName);
            }

            // Create table
            createTable(createTableSQL);

            // Insert data
            insertData(repository, tableName);

            LoggingUtil.info("Successfully exported " + repository.getDataRows().size() +
                    " rows to table: " + tableName);

        } finally {
            if (connection != null && !connection.isClosed()) {
                connection.close();
            }
        }
    }

    /**
     * Establish database connection
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
        LoggingUtil.info("Connected to database: " + url);
    }

    /**
     * Create schema if it doesn't exist
     */
    private void createSchemaIfNeeded() throws SQLException {
        String schemaName = systemConfig.getSqlSchemaName();
        if (schemaName != null && !schemaName.trim().isEmpty()) {
            String sql = "CREATE SCHEMA IF NOT EXISTS `" + schemaName + "`";
            try (Statement stmt = connection.createStatement()) {
                stmt.execute(sql);
                LoggingUtil.info("Ensured schema exists: " + schemaName);
            }

            // Switch to the schema
            sql = "USE `" + schemaName + "`";
            try (Statement stmt = connection.createStatement()) {
                stmt.execute(sql);
            }
        }
    }

    /**
     * Get the table name with optional date suffix
     */
    private String getTableName() {
        String baseName = systemConfig.getSqlTableName();
        if (baseName == null || baseName.trim().isEmpty()) {
            baseName = "exported_data";
        }

        if (systemConfig.isSqlUseDateSuffix()) {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss");
            String dateSuffix = LocalDateTime.now().format(formatter);
            return baseName + "_" + dateSuffix;
        }

        return baseName;
    }

    /**
     * Analyze string field lengths to determine optimal column sizes
     */
    private Map<String, Integer> analyzeStringFieldLengths(ConversionRepository repository) {
        Map<String, Integer> maxLengths = new HashMap<>();
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();
        String uniqueKeyField = repository.getUniqueKeyField();

        LoggingUtil.info("Analyzing string field lengths...");

        for (Map<String, Object> row : repository.getDataRows()) {
            for (Map.Entry<String, Object> entry : row.entrySet()) {
                String fieldName = entry.getKey();
                Object value = entry.getValue();

                // Only analyze STRING type fields that have non-null values
                if (columnTypes.get(fieldName) == ConversionRepository.DataType.STRING && value != null) {
                    String stringValue = value.toString();
                    int currentLength = stringValue.length();

                    // Update maximum length found so far
                    int previousMax = maxLengths.getOrDefault(fieldName, 0);
                    if (currentLength > previousMax) {
                        maxLengths.put(fieldName, currentLength);
                        //LoggingUtil.debug("Field '" + fieldName + "': new max length " + currentLength +
                        //        " (was " + previousMax + ")");
                        LoggingUtil.info("Field '" + fieldName + "': new max length " + currentLength +
                                " (was " + previousMax + ")");
                    }
                }
            }
        }

        // Second pass: Optimize the lengths with appropriate buffer
        Map<String, Integer> optimizedLengths = new HashMap<>();
        for (Map.Entry<String, Integer> entry : maxLengths.entrySet()) {
            String fieldName = entry.getKey();
            int actualMaxLength = entry.getValue();
            int optimizedLength = getOptimizedVarcharLength(actualMaxLength);

            // Special handling for unique key field - ensure it's not too large for indexing
            if (fieldName.equals(uniqueKeyField)) {
                if (optimizedLength > 255) {
                    LoggingUtil.warn("Unique key field '" + fieldName + "' has max length " + actualMaxLength +
                            ". Limiting to VARCHAR(255) for indexing performance.");
                    optimizedLength = Math.min(255, optimizedLength);
                } else if (actualMaxLength == 0) {
                    // Handle case where unique key field might be empty in sample data
                    optimizedLength = 50; // Default reasonable size for unique keys
                    LoggingUtil.warn("Unique key field '" + fieldName + "' appears empty in sample data. " +
                            "Setting default size of " + optimizedLength);
                }
            }

            optimizedLengths.put(fieldName, optimizedLength);

            LoggingUtil.info("Field '" + fieldName + "': actual max = " + actualMaxLength +
                    ", optimized = " + optimizedLength +
                    (fieldName.equals(uniqueKeyField) ? " (PRIMARY KEY)" : ""));
        }

        // Third pass: Handle string fields that weren't found in the data but are in column types
        for (String fieldName : columnTypes.keySet()) {
            if (columnTypes.get(fieldName) == ConversionRepository.DataType.STRING &&
                    !optimizedLengths.containsKey(fieldName)) {
                // This field exists in the schema but had no data, set a reasonable default
                int defaultLength = fieldName.equals(uniqueKeyField) ? 50 : 255;
                optimizedLengths.put(fieldName, defaultLength);
                LoggingUtil.warn("String field '" + fieldName + "' found no data. Setting default length: " + defaultLength);
            }
        }

        return optimizedLengths;
    }


    /**
     * Get optimized VARCHAR length based on actual usage with proper buffer
     */
    private int getOptimizedVarcharLength(int actualLength) {
        if (actualLength == 0) {
            return 50; // Minimum reasonable size for empty fields
        }

        // Add buffer: 25% extra or minimum 20 characters, whichever is larger
        int buffer = Math.max(20, actualLength / 4);
        int bufferedLength = actualLength + buffer;

        // Find the next standard size that accommodates the buffered length
        for (int size : VARCHAR_SIZES) {
            if (bufferedLength <= size) {
                return size;
            }
        }

        // If larger than largest VARCHAR size, determine TEXT type
        if (bufferedLength <= VARCHAR_THRESHOLD) {
            return VARCHAR_THRESHOLD; // Use largest VARCHAR
        } else if (bufferedLength <= TEXT_THRESHOLD) {
            return TEXT_THRESHOLD; // Will be converted to TEXT type
        } else if (bufferedLength <= MEDIUMTEXT_THRESHOLD) {
            return MEDIUMTEXT_THRESHOLD; // Will be converted to MEDIUMTEXT
        } else {
            return Integer.MAX_VALUE; // Will be converted to LONGTEXT
        }
    }

    /**
     * Generate CREATE TABLE SQL statement
     */
    private String generateCreateTableSQL(ConversionRepository repository,
                                          Map<String, Integer> stringFieldLengths,
                                          String tableName) {
        StringBuilder sql = new StringBuilder();
        sql.append("CREATE TABLE `").append(tableName).append("` (\n");

        List<String> visibleFields = repository.getVisibleFieldNames();
        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();
        Map<String, String> columnFormats = repository.getColumnFormats();
        String uniqueKeyField = repository.getUniqueKeyField();

        List<String> columnDefinitions = new ArrayList<>();

        for (String fieldName : visibleFields) {
            ConversionRepository.DataType type = columnTypes.getOrDefault(fieldName,
                    ConversionRepository.DataType.STRING);
            // Check if this field is the unique key (primary key)
            boolean isPrimaryKey = fieldName.equals(uniqueKeyField);
            String columnDef = generateColumnDefinition(fieldName, type, stringFieldLengths.get(fieldName), isPrimaryKey);
            columnDefinitions.add(columnDef);
        }

        sql.append(String.join(",\n", columnDefinitions));
        sql.append("\n");

        if (uniqueKeyField != null && visibleFields.contains(uniqueKeyField)) {
            sql.append(",\nPRIMARY KEY (`").append(uniqueKeyField).append("`)");
        }

        sql.append("\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        //LoggingUtil.debug("Generated CREATE TABLE SQL:\n" + sql.toString());
        LoggingUtil.info("Generated CREATE TABLE SQL:\n" + sql.toString());
        return sql.toString();
    }

    /**
     * Generate column definition for a specific field
     */
    private String generateColumnDefinition(String fieldName, ConversionRepository.DataType type, Integer maxLength, boolean isPrimaryKey) {
        StringBuilder def = new StringBuilder();
        def.append("  `").append(escapeFieldName(fieldName)).append("` ");

        switch (type) {
            case INTEGER:
                if (isPrimaryKey) {
                    def.append("INT NOT NULL AUTO_INCREMENT");
                } else {
                    def.append("INT");
                }
                break;

            case FLOAT:
                def.append("DOUBLE");
                break;

            case BOOLEAN:
                def.append("BOOLEAN");
                break;

            case DATE:
                def.append("DATE");
                break;

            case DATETIME:
                def.append("DATETIME");
                break;

            case STRING:
            default:
                if (maxLength == null || maxLength <= VARCHAR_THRESHOLD) {
                    int length = maxLength != null ? maxLength : 255;
                    def.append("VARCHAR(").append(length).append(")");
                } else if (maxLength <= TEXT_THRESHOLD) {
                    def.append("TEXT");
                } else if (maxLength <= MEDIUMTEXT_THRESHOLD) {
                    def.append("MEDIUMTEXT");
                } else {
                    def.append("LONGTEXT");
                }
                break;
        }

        // Add NULL/NOT NULL constraint
        if (isPrimaryKey) {
            // Primary key is already NOT NULL, don't add it again
        } else {
            def.append(" NULL");
        }

        return def.toString();
    }

    /**
     * Escape field names to handle special characters and reserved words
     */
    private String escapeFieldName(String fieldName) {
        // Remove or replace problematic characters
        return fieldName.replaceAll("[^a-zA-Z0-9_]", "_")
                .replaceAll("^([0-9])", "_$1"); // Prefix with underscore if starts with number
    }

    /**
     * Drop table if it exists
     */
    private void dropTableIfExists(String tableName) throws SQLException {
        String sql = "DROP TABLE IF EXISTS `" + tableName + "`";
        try (Statement stmt = connection.createStatement()) {
            stmt.execute(sql);
            LoggingUtil.info("Dropped existing table: " + tableName);
        }
    }

    /**
     * Create the table using the generated SQL
     */
    private void createTable(String createTableSQL) throws SQLException {
        try (Statement stmt = connection.createStatement()) {
            stmt.execute(createTableSQL);
            LoggingUtil.info("Created table successfully");
        }
    }

    /**
     * Insert data into the created table
     */
    private void insertData(ConversionRepository repository, String tableName) throws SQLException {
        List<String> visibleFields = repository.getVisibleFieldNames();

        // Generate INSERT SQL with placeholders
        StringBuilder sql = new StringBuilder();
        sql.append("INSERT INTO `").append(tableName).append("` (");
        sql.append(visibleFields.stream()
                .map(field -> "`" + escapeFieldName(field) + "`")
                .collect(Collectors.joining(", ")));
        sql.append(") VALUES (");
        sql.append(visibleFields.stream()
                .map(field -> "?")
                .collect(Collectors.joining(", ")));
        sql.append(")");

        Map<String, ConversionRepository.DataType> columnTypes = repository.getColumnTypes();

        try (PreparedStatement pstmt = connection.prepareStatement(sql.toString())) {
            connection.setAutoCommit(false); // Use transaction for better performance

            int batchCount = 0;
            int totalRows = repository.getDataRows().size();

            for (Map<String, Object> row : repository.getDataRows()) {
                for (int i = 0; i < visibleFields.size(); i++) {
                    String fieldName = visibleFields.get(i);
                    Object value = row.get(fieldName);
                    ConversionRepository.DataType type = columnTypes.getOrDefault(fieldName,
                            ConversionRepository.DataType.STRING);

                    setPreparedStatementValue(pstmt, i + 1, value, type);
                }

                pstmt.addBatch();
                batchCount++;

                // Execute batch every 1000 rows for better memory management
                if (batchCount % 1000 == 0) {
                    pstmt.executeBatch();
                    connection.commit();
                    LoggingUtil.debug("Inserted " + batchCount + " / " + totalRows + " rows");
                }
            }

            // Execute remaining batch
            if (batchCount % 1000 != 0) {
                pstmt.executeBatch();
                connection.commit();
            }

            LoggingUtil.info("Inserted all " + totalRows + " rows successfully");
        }
    }

    /**
     * Set value in PreparedStatement based on data type
     */
    private void setPreparedStatementValue(PreparedStatement pstmt, int index, Object value,
                                           ConversionRepository.DataType type) throws SQLException {
        if (value == null) {
            pstmt.setNull(index, getSqlType(type));
            return;
        }

        switch (type) {
            case INTEGER:
                pstmt.setInt(index, (Integer) value);
                break;

            case FLOAT:
                pstmt.setDouble(index, (Double) value);
                break;

            case BOOLEAN:
                pstmt.setBoolean(index, (Boolean) value);
                break;

            case DATE:
                if (value instanceof LocalDate) {
                    pstmt.setDate(index, Date.valueOf((LocalDate) value));
                } else {
                    pstmt.setString(index, value.toString());
                }
                break;

            case DATETIME:
                if (value instanceof LocalDateTime) {
                    pstmt.setTimestamp(index, Timestamp.valueOf((LocalDateTime) value));
                } else {
                    pstmt.setString(index, value.toString());
                }
                break;

            case STRING:
            default:
                pstmt.setString(index, value.toString());
                break;
        }
    }

    /**
     * Get SQL type constant for NULL values
     */
    private int getSqlType(ConversionRepository.DataType type) {
        switch (type) {
            case INTEGER: return Types.INTEGER;
            case FLOAT: return Types.DOUBLE;
            case BOOLEAN: return Types.BOOLEAN;
            case DATE: return Types.DATE;
            case DATETIME: return Types.TIMESTAMP;
            case STRING:
            default: return Types.VARCHAR;
        }
    }

    /**
     * Test database connection
     */
    public void testConnection() throws SQLException {
        connect();
        try {
            DatabaseMetaData metaData = connection.getMetaData();
            LoggingUtil.info("Connected to: " + metaData.getDatabaseProductName() +
                    " " + metaData.getDatabaseProductVersion());
        } finally {
            if (connection != null && !connection.isClosed()) {
                connection.close();
            }
        }
    }
}