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

    /**
     * Check if a row matches a filter field
     */
    public boolean rowMatchesFilter(Map<String, Object> row, String filterField) {
        Object fieldValue = row.get(filterField);
        if (fieldValue == null) {
            return false;
        }

        // Check if the field has a boolean true value
        if (fieldValue instanceof Boolean) {
            return (Boolean) fieldValue;
        } else if (fieldValue instanceof String) {
            return Boolean.parseBoolean((String) fieldValue);
        } else if (fieldValue instanceof Integer) {
            return ((Integer) fieldValue) != 0;
        } else if (fieldValue instanceof Long) {
            return ((Long) fieldValue) != 0L;
        } else {
            // Try to interpret as boolean if possible
            return "true".equalsIgnoreCase(fieldValue.toString()) ||
                    "yes".equalsIgnoreCase(fieldValue.toString()) ||
                    "1".equals(fieldValue.toString());
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

    /**
     * Helper method to generate an output path with a suffix
     */
    public String getOutputPathWithSuffix(String basePath, String suffix, String extension) {
        // Extract base path without extension
        String basePathWithoutExt = basePath.replaceAll("\\.[^.]+$", "");

        // Add suffix and extension
        return basePathWithoutExt + suffix + extension;
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
