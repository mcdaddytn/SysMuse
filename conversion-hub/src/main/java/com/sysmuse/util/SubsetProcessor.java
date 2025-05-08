package com.sysmuse.util;

import java.util.*;
import java.io.*;
import java.nio.file.*;

/**
 * Utility class for processing data subsets for both CSV and JSON formats.
 * Handles the subset filtering, tracking, and configuration parsing.
 * Updated to work with SystemConfig directly.
 */
public class SubsetProcessor {

    private Properties properties; // For backward compatibility
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
                System.out.println("Warning: exclusiveSubsets is enabled but no uniqueKey field is defined. " +
                        "Subsets will not be processed exclusively.");
                this.exclusiveSubsets = false;
            } else {
                System.out.println("Exclusive subsets enabled with unique key field: " + uniqueKeyField);
            }
        }
    }

    /**
     * Constructor with properties and repository (for backward compatibility)
     */
    public SubsetProcessor(Properties properties, ConversionRepository repository) {
        this.properties = properties;

        // Check if exclusive subsets are enabled
        this.exclusiveSubsets = Boolean.parseBoolean(
                properties.getProperty("exclusiveSubsets", "false"));

        // Parse the subset configuration
        String subsetConfig = properties.getProperty("output.subsets");
        this.filterToSuffix = parseSubsetConfig(subsetConfig);

        // Get the unique key field from the repository if exclusive subsets are enabled
        if (exclusiveSubsets) {
            this.uniqueKeyField = repository.getUniqueKeyField();

            if (uniqueKeyField == null) {
                System.out.println("Warning: exclusiveSubsets is enabled but no uniqueKey field is defined. " +
                        "Subsets will not be processed exclusively.");
                this.exclusiveSubsets = false;
            } else {
                System.out.println("Exclusive subsets enabled with unique key field: " + uniqueKeyField);
            }
        }
    }

    /**
     * Parse subset configuration from properties
     */
    public Map<String, String> parseSubsetConfig(String subsetConfig) {
        Map<String, String> filterToSuffix = new LinkedHashMap<>();

        if (subsetConfig == null || subsetConfig.trim().isEmpty()) {
            return filterToSuffix;
        }

        System.out.println("Parsing subset configuration: " + subsetConfig);

        // Track current parsing state
        StringBuilder currentFilter = new StringBuilder();
        StringBuilder currentSuffix = new StringBuilder();
        boolean inQuotes = false;
        boolean foundColon = false;

        for (int i = 0; i < subsetConfig.length(); i++) {
            char c = subsetConfig.charAt(i);

            if (c == '"') {
                inQuotes = !inQuotes;
                // When leaving quotes, check if we're in filter or suffix part
                if (!inQuotes && !foundColon) {
                    // Finished parsing filter name in quotes
                    continue;
                } else if (!inQuotes && foundColon) {
                    // Finished parsing suffix in quotes
                    continue;
                }
            } else if (c == ':' && !inQuotes) {
                // Found the separator between filter and suffix
                foundColon = true;
                continue;
            } else if (c == ',' && !inQuotes) {
                // Found end of a pair, add to map and reset
                if (foundColon && currentFilter.length() > 0 && currentSuffix.length() > 0) {
                    String filter = currentFilter.toString().trim();
                    String suffix = currentSuffix.toString().trim();

                    // Remove quotes if present
                    if (filter.startsWith("\"") && filter.endsWith("\"")) {
                        filter = filter.substring(1, filter.length() - 1);
                    }
                    if (suffix.startsWith("\"") && suffix.endsWith("\"")) {
                        suffix = suffix.substring(1, suffix.length() - 1);
                    }

                    System.out.println("Parsed subset filter: '" + filter + "' with suffix: '" + suffix + "'");
                    filterToSuffix.put(filter, suffix);

                    // Reset for next pair
                    currentFilter = new StringBuilder();
                    currentSuffix = new StringBuilder();
                    foundColon = false;
                }
                continue;
            }

            // Add character to current part
            if (!foundColon) {
                currentFilter.append(c);
            } else {
                currentSuffix.append(c);
            }
        }

        // Process the last pair if any
        if (foundColon && currentFilter.length() > 0 && currentSuffix.length() > 0) {
            String filter = currentFilter.toString().trim();
            String suffix = currentSuffix.toString().trim();

            // Remove quotes if present
            if (filter.startsWith("\"") && filter.endsWith("\"")) {
                filter = filter.substring(1, filter.length() - 1);
            }
            if (suffix.startsWith("\"") && suffix.endsWith("\"")) {
                suffix = suffix.substring(1, suffix.length() - 1);
            }

            System.out.println("Parsed subset filter: '" + filter + "' with suffix: '" + suffix + "'");
            filterToSuffix.put(filter, suffix);
        }

        // Output the complete map
        System.out.println("Parsed " + filterToSuffix.size() + " subset filters:");
        for (Map.Entry<String, String> entry : filterToSuffix.entrySet()) {
            System.out.println("  - '" + entry.getKey() + "': '" + entry.getValue() + "'");
        }

        return filterToSuffix;
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