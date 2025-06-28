package com.sysmuse.util;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

/**
 * Utility class for deriving new text fields from existing fields
 * Provides operations like file path and name manipulations.
 */
public class TextFieldDerivation {

    /**
     * Supported text field derivation operations
     */
    public enum Operation {
        STRIP_EXTENSION,  // Remove file extension from filename
        GET_EXTENSION,    // Extract file extension
        GET_PATH,         // Extract path portion from full path
        GET_FILE_ROOT,    // Extract filename without extension
        GET_FILENAME      // Extract filename with extension
    }

    /**
     * Process a derived text field operation
     *
     * @param operation The operation to perform
     * @param sourceField The source field name
     * @param rowValues The row data
     * @return The result of the operation or null if operation failed
     */
    public static String processOperation(Operation operation, String sourceField, Map<String, Object> rowValues) {
        if (!rowValues.containsKey(sourceField) || rowValues.get(sourceField) == null) {
            LoggingUtil.debug("Source field '" + sourceField + "' not found or null for " + operation);
            return null;
        }

        String value = rowValues.get(sourceField).toString();

        switch (operation) {
            case STRIP_EXTENSION:
                return stripExtension(value);

            case GET_EXTENSION:
                return getExtension(value);

            case GET_PATH:
                return getPath(value);

            case GET_FILE_ROOT:
                return getFileRoot(value);

            case GET_FILENAME:
                return getFileName(value);

            default:
                LoggingUtil.warn("Unknown text field derivation operation: " + operation);
                return null;
        }
    }

    /**
     * Remove file extension from a filename
     * Example: "document.pdf" -> "document"
     */
    public static String stripExtension(String filename) {
        if (filename == null || filename.isEmpty()) {
            return filename;
        }

        int lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex <= 0) {
            return filename; // No extension found or filename starts with a dot
        }

        return filename.substring(0, lastDotIndex);
    }

    /**
     * Extract file extension from a filename
     * Example: "document.pdf" -> "pdf"
     */
    public static String getExtension(String filename) {
        if (filename == null || filename.isEmpty()) {
            return "";
        }

        int lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex < 0 || lastDotIndex == filename.length() - 1) {
            return ""; // No extension found or filename ends with a dot
        }

        return filename.substring(lastDotIndex + 1);
    }

    /**
     * Extract path portion from a full file path
     * Example: "/users/data/document.pdf" -> "/users/data"
     */
    public static String getPath(String filepath) {
        if (filepath == null || filepath.isEmpty()) {
            return "";
        }

        try {
            Path path = Paths.get(filepath);
            Path parent = path.getParent();
            return parent != null ? parent.toString() : "";
        } catch (Exception e) {
            // Fall back to File methods if Path fails
            File file = new File(filepath);
            String parent = file.getParent();
            return parent != null ? parent : "";
        }
    }

    /**
     * Extract filename without extension from a path
     * Example: "/users/data/document.pdf" -> "document"
     */
    public static String getFileRoot(String filepath) {
        if (filepath == null || filepath.isEmpty()) {
            return "";
        }

        String filename = getFileName(filepath);
        return stripExtension(filename);
    }

    /**
     * Extract filename with extension from a path
     * Example: "/users/data/document.pdf" -> "document.pdf"
     */
    public static String getFileName(String filepath) {
        if (filepath == null || filepath.isEmpty()) {
            return "";
        }

        try {
            Path path = Paths.get(filepath);
            return path.getFileName().toString();
        } catch (Exception e) {
            // Fall back to File methods if Path fails
            File file = new File(filepath);
            return file.getName();
        }
    }
}