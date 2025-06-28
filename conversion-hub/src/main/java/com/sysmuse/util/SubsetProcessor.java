package com.sysmuse.util;

import java.util.*;
import java.io.*;
import java.nio.file.*;

/**
 * Utility class for processing data subsets for both CSV and JSON formats.
 * Handles the subset filtering, tracking, and configuration.
 * Updated to use SystemConfig exclusively and proper logging.
 */
public class SubsetProcessor {

    private SystemConfig systemConfig;
    private Map<String, String> filterToSuffix = new LinkedHashMap<>();
    private boolean exclusiveSubsets = false;
    private String uniqueKeyField = null;

    /**
     * Constructor with SystemConfig and repository
     */
    public SubsetProcessor(SystemConfig config, ConversionRepository repository) {
        this.systemConfig = config;

        // Get subset configuration from system config
        this.filterToSuffix = systemConfig.getSubsets();

        // Check if exclusive subsets are enabled
        this.exclusiveSubsets = systemConfig.isExclusiveSubsets();

        // Get the unique key field from the repository if exclusive subsets are enabled
        if (exclusiveSubsets) {
            this.uniqueKeyField = repository.getUniqueKeyField();

            if (uniqueKeyField == null) {
                LoggingUtil.warn("Exclusive subsets is enabled but no uniqueKey field is defined. " +
                        "Subsets will not be processed exclusively.");
                this.exclusiveSubsets = false;
            } else {
                LoggingUtil.info("Exclusive subsets enabled with unique key field: " + uniqueKeyField);
            }
        }
    }

    public boolean rowMatchesFilter(Map<String, Object> row, String filterField) {
        // Log detailed information about filter check
        LoggingUtil.debug("Checking filter field: " + filterField);
        LoggingUtil.debug("Available row fields: " + row.keySet());

        Object fieldValue = row.get(filterField);
        LoggingUtil.debug("Field value for '" + filterField + "': " + fieldValue);

        if (fieldValue == null) {
            LoggingUtil.debug("Filter field '" + filterField + "' is null. Returning false.");
            return false;
        }

        // Check if the field has a boolean true value
        if (fieldValue instanceof Boolean) {
            LoggingUtil.debug("Boolean filter: " + fieldValue);
            return (Boolean) fieldValue;
        } else if (fieldValue instanceof String) {
            boolean booleanValue = Boolean.parseBoolean((String) fieldValue);
            LoggingUtil.debug("String parsed to boolean: " + booleanValue);
            return booleanValue;
        } else if (fieldValue instanceof Integer) {
            boolean intValue = ((Integer) fieldValue) != 0;
            LoggingUtil.debug("Integer converted to boolean: " + intValue);
            return intValue;
        } else if (fieldValue instanceof Long) {
            boolean longValue = ((Long) fieldValue) != 0L;
            LoggingUtil.debug("Long converted to boolean: " + longValue);
            return longValue;
        } else {
            // Try to interpret as boolean if possible
            boolean interpretedValue = "true".equalsIgnoreCase(fieldValue.toString()) ||
                    "yes".equalsIgnoreCase(fieldValue.toString()) ||
                    "1".equals(fieldValue.toString());

            LoggingUtil.debug("Interpreted value: " + interpretedValue + " from string: " + fieldValue);
            return interpretedValue;
        }
    }

    /**
     * Get a map of filter field to suffix mapping
     */
    public Map<String, String> getFilterToSuffix() {
        return filterToSuffix;
    }

    /**
     * Check if a row has already been exported to a subset
     */
    public boolean isRowKeyInExportedSet(Map<String, Object> row, Set<String> exportedKeys) {
        if (!exclusiveSubsets || uniqueKeyField == null) {
            return false;
        }

        // Get the unique key value
        Object keyValue = row.get(uniqueKeyField);
        if (keyValue == null) {
            return false;
        }

        String rowKey = keyValue.toString();
        return exportedKeys.contains(rowKey);
    }

    /**
     * Add a row key to the exported set
     */
    public void addRowKeyToExportedSet(Map<String, Object> row, Set<String> exportedKeys) {
        if (!exclusiveSubsets || uniqueKeyField == null) {
            return;
        }

        // Get the unique key value
        Object keyValue = row.get(uniqueKeyField);
        if (keyValue == null) {
            return;
        }

        String rowKey = keyValue.toString();
        exportedKeys.add(rowKey);
    }

// In SubsetProcessor.java, find the getOutputPathWithSuffix method and modify it:

    public String getOutputPathWithSuffix(String basePath, String suffix, String extension) {
        // Extract base path without extension
        String basePathWithoutExt = basePath.replaceAll("\\.[^.]+$", "");

        // Get the output suffix from systemConfig
        String outputSuffix = systemConfig.getOutputSuffix();

        // Add output suffix and filter suffix and extension
        return basePathWithoutExt + suffix + extension;
        //return basePathWithoutExt + outputSuffix + suffix + extension;
    }

    /**
     * Check if exclusive subsets are enabled
     */
    public boolean isExclusiveSubsets() {
        return exclusiveSubsets;
    }

    /**
     * Get unique key field
     */
    public String getUniqueKeyField() {
        return uniqueKeyField;
    }

    /**
     * Check if the data has subsets configured
     */
    public boolean hasSubsets() {
        return !filterToSuffix.isEmpty();
    }
}
