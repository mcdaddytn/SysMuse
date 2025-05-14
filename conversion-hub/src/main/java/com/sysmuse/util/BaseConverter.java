package com.sysmuse.util;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;

/**
 * Base class for all data format converters.
 * Contains common functionality for type conversion, date/datetime handling,
 * and field processing shared between different converter implementations.
 */
public abstract class BaseConverter {

    protected SystemConfig systemConfig;
    protected int maxTextLength;

    /**
     * Constructor with SystemConfig
     */
    public BaseConverter(SystemConfig config) {
        this.systemConfig = config;
        this.maxTextLength = config.getMaxTextLength();

        // Ensure date and datetime formats are initialized
        initializeDefaultFormats();
    }

    /**
     * Process a single row of data, converting string values to appropriate types
     * based on the repository's column type configuration.
     */
    protected Map<String, Object> processRow(String[] headers, String[] values, ConversionRepository repository) {
        Map<String, Object> rowValues = new LinkedHashMap<>();

        for (int colIndex = 0; colIndex < headers.length && colIndex < values.length; colIndex++) {
            String columnName = headers[colIndex];

            // Skip empty column names
            if (columnName == null || columnName.trim().isEmpty()) {
                continue;
            }

            String value = colIndex < values.length ? values[colIndex] : "";

            // Get the data type from repository
            ConversionRepository.DataType type = repository.getColumnTypes().getOrDefault(
                    columnName, ConversionRepository.DataType.STRING);

            // Convert value based on column type
            Object convertedValue = convertValue(value, type, columnName, repository);
            rowValues.put(columnName, convertedValue);
        }

        return rowValues;
    }

    /**
     * Convert a string value to the appropriate type based on the specified data type
     * and column context from the repository.
     */
    protected Object convertValue(String value, ConversionRepository.DataType type, String columnName, ConversionRepository repository) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }

        value = value.trim();

        switch (type) {
            case INTEGER:
                try {
                    return Integer.parseInt(value);
                } catch (NumberFormatException e) {
                    LoggingUtil.debug("Could not convert '" + value + "' to INTEGER for field '" +
                            columnName + "', defaulting to 0");
                    return 0;
                }

            case FLOAT:
                try {
                    return Double.parseDouble(value);
                } catch (NumberFormatException e) {
                    LoggingUtil.debug("Could not convert '" + value + "' to FLOAT for field '" +
                            columnName + "', defaulting to 0.0");
                    return 0.0;
                }

            case BOOLEAN:
                return Boolean.parseBoolean(value);

            case DATE:
                return convertToDate(value, columnName, repository);

            case DATETIME:
                return convertToDateTime(value, columnName, repository);

            case STRING:
            default:
                // Apply text truncation if needed
                if (maxTextLength > 0) {
                    return truncateText(value, maxTextLength);
                } else {
                    return value;
                }
        }
    }

    /**
     * Convert value to Date using configured format for specific column
     */
    private Object convertToDate(String value, String columnName, ConversionRepository repository) {
        // First try to get the specific format for this column
        String format = repository.getColumnFormats().get(columnName);

        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return LocalDate.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse date '" + value + "' with configured format '" + format + "' for column '" + columnName + "'");
            }
        }

        // If no specific format or parsing failed, try all configured DATE formats
        String foundFormat = findFormatForColumn(ConversionRepository.DataType.DATE, value);
        if (foundFormat != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(foundFormat);
                LocalDate parsedDate = LocalDate.parse(value, formatter);
                // Store the successful format for this column for future use
                repository.getColumnFormats().put(columnName, foundFormat);
                return parsedDate;
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse date '" + value + "' with format '" + foundFormat + "'");
            }
        }

        // If parsing fails, return as string
        LoggingUtil.warn("Could not parse date '" + value + "' for column '" + columnName + "', returning as string");
        return value;
    }

    /**
     * Convert value to DateTime using configured format for specific column
     */
    private Object convertToDateTime(String value, String columnName, ConversionRepository repository) {
        // First try to get the specific format for this column
        String format = repository.getColumnFormats().get(columnName);

        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return LocalDateTime.parse(value, formatter);
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse datetime '" + value + "' with configured format '" + format + "' for column '" + columnName + "'");
            }
        }

        // If no specific format or parsing failed, try all configured DATETIME formats
        String foundFormat = findFormatForColumn(ConversionRepository.DataType.DATETIME, value);
        if (foundFormat != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(foundFormat);
                LocalDateTime parsedDateTime = LocalDateTime.parse(value, formatter);
                // Store the successful format for this column for future use
                repository.getColumnFormats().put(columnName, foundFormat);
                return parsedDateTime;
            } catch (DateTimeParseException e) {
                LoggingUtil.warn("Failed to parse datetime '" + value + "' with format '" + foundFormat + "'");
            }
        }

        // If parsing fails, return as string
        LoggingUtil.warn("Could not parse datetime '" + value + "' for column '" + columnName + "', returning as string");
        return value;
    }

    /**
     * Find the appropriate format for a column of the given type
     */
    private String findFormatForColumn(ConversionRepository.DataType type, String value) {
        if (systemConfig == null) {
            return null;
        }

        List<String> formats = type == ConversionRepository.DataType.DATE ?
                systemConfig.getDateFormats() : systemConfig.getDateTimeFormats();

        for (String format : formats) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                if (type == ConversionRepository.DataType.DATE) {
                    LocalDate.parse(value, formatter);
                } else {
                    LocalDateTime.parse(value, formatter);
                }
                return format;
            } catch (DateTimeParseException e) {
                // Try next format
            }
        }
        return null;
    }

    /**
     * Truncate text to a maximum length
     */
    protected String truncateText(String text, int maxLength) {
        if (text == null || text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength);
    }

    /**
     * Format a value for output based on its type
     */
    protected String formatValueForOutput(Object value, ConversionRepository.DataType type, String columnName, ConversionRepository repository) {
        if (value == null) {
            return "";
        }

        switch (type) {
            case DATE:
                if (value instanceof LocalDate) {
                    // Get the format for this column, or use default
                    String format = repository.getColumnFormats().get(columnName);
                    if (format != null) {
                        DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                        return ((LocalDate) value).format(formatter);
                    } else {
                        // Use default ISO format
                        return value.toString();
                    }
                }
                break;

            case DATETIME:
                if (value instanceof LocalDateTime) {
                    // Get the format for this column, or use default
                    String format = repository.getColumnFormats().get(columnName);
                    if (format != null) {
                        DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                        return ((LocalDateTime) value).format(formatter);
                    } else {
                        // Use default ISO format
                        return value.toString();
                    }
                }
                break;

            default:
                // For all other types, use the toString method
                break;
        }

        return value.toString();
    }

    /**
     * Get a formatted date string for output
     */
    protected String formatDateForOutput(LocalDate date, String columnName, ConversionRepository repository) {
        String format = repository.getColumnFormats().get(columnName);
        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return date.format(formatter);
            } catch (Exception e) {
                LoggingUtil.warn("Failed to format date with pattern '" + format + "', using default");
            }
        }
        return date.toString(); // ISO format by default
    }

    /**
     * Get a formatted datetime string for output
     */
    protected String formatDateTimeForOutput(LocalDateTime dateTime, String columnName, ConversionRepository repository) {
        String format = repository.getColumnFormats().get(columnName);
        if (format != null) {
            try {
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(format);
                return dateTime.format(formatter);
            } catch (Exception e) {
                LoggingUtil.warn("Failed to format datetime with pattern '" + format + "', using default");
            }
        }
        return dateTime.toString(); // ISO format by default
    }

    /**
     * Initialize default date and datetime formats if not already configured
     */
    protected void initializeDefaultFormats() {
        // Initialize with common date formats if not already set
        List<String> defaultDateFormats = Arrays.asList(
                "yyyy-MM-dd",
                "MM/dd/yyyy",
                "dd/MM/yyyy",
                "MM-dd-yyyy",
                "dd-MM-yyyy",
                "yyyy/MM/dd",
                "M/d/yyyy",
                "d/M/yyyy"
        );

        // Initialize with common datetime formats if not already set
        List<String> defaultDateTimeFormats = Arrays.asList(
                "yyyy-MM-dd HH:mm:ss",
                "yyyy-MM-dd'T'HH:mm:ss",
                "yyyy-MM-dd HH:mm:ss.SSS",
                "yyyy-MM-dd'T'HH:mm:ss.SSS",
                "yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
                "MM/dd/yyyy HH:mm:ss",
                "dd/MM/yyyy HH:mm:ss",
                "MM-dd-yyyy HH:mm:ss",
                "dd-MM-yyyy HH:mm:ss",
                "M/d/yyyy H:mm:ss",
                "d/M/yyyy H:mm:ss",
                "M/d/yyyy h:mm:ss a",
                "d/M/yyyy h:mm:ss a"
        );

        // If SystemConfig doesn't have formats initialized, we need to make sure they are
        // This is a safety check since the formats should ideally be set in SystemConfig
        LoggingUtil.debug("Initializing default date/datetime formats for converter");
    }

    /**
     * Process all rows in the repository to apply derived fields and transformations
     */
    protected void processRepositoryRows(ConversionRepository repository) {
        List<Map<String, Object>> rows = repository.getDataRows();

        LoggingUtil.info("Processing derived fields, aggregation, and suppression for " + rows.size() + " rows");
        int processedCount = 0;

        for (Map<String, Object> row : rows) {
            // Apply derived boolean fields
            repository.processDerivedFields(row);

            // Apply aggregate text fields
            repository.processAggregateFields(row);

            // Apply field suppression
            repository.applySuppression(row);

            processedCount++;
            if (processedCount % 100 == 0) {
                LoggingUtil.debug("Processed transformations for " + processedCount + " rows");
            }
        }

        LoggingUtil.info("Completed processing of transformations for all rows");
    }

    /**
     * Escape a value for CSV format
     */
    protected String escapeValue(Object value, ConversionRepository.DataType type, String columnName, ConversionRepository repository) {
        if (value == null) {
            return "";
        }

        // Format the value based on its type
        String stringValue = formatValueForOutput(value, type, columnName, repository);

        // Check if the value needs to be quoted
        boolean needsQuoting = stringValue.contains(",") ||
                stringValue.contains("\"") ||
                stringValue.contains("\n") ||
                stringValue.contains("\r");

        if (needsQuoting) {
            // Escape quotes by doubling them
            stringValue = stringValue.replace("\"", "\"\"");
            // Wrap in quotes
            return "\"" + stringValue + "\"";
        } else {
            return stringValue;
        }
    }

    /**
     * Escape a list of column names for CSV format
     */
    protected List<String> escapeColumns(List<String> columns) {
        List<String> escaped = new ArrayList<>();
        for (String column : columns) {
            escaped.add(escapeColumnName(column));
        }
        return escaped;
    }

    /**
     * Escape a column name for CSV format
     */
    protected String escapeColumnName(String columnName) {
        if (columnName == null) {
            return "";
        }

        // Check if the column name needs to be quoted
        boolean needsQuoting = columnName.contains(",") ||
                columnName.contains("\"") ||
                columnName.contains("\n") ||
                columnName.contains("\r");

        if (needsQuoting) {
            // Escape quotes by doubling them
            columnName = columnName.replace("\"", "\"\"");
            // Wrap in quotes
            return "\"" + columnName + "\"";
        } else {
            return columnName;
        }
    }
}