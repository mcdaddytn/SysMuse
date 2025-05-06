package com.sysmuse.util;

import java.io.*;
import java.util.*;
import org.json.simple.*;
import org.json.simple.parser.*;
import java.nio.file.*;

/**
 * Utility class to convert JSON files back to CSV format
 */
public class JSONToCSVConverter {

    private String jsonFilePath;
    private String csvFilePath;
    private List<String> columnOrder;

    /**
     * Constructor
     *
     * @param jsonFilePath Path to the JSON file to convert
     * @param csvFilePath Path to the output CSV file
     */
    public JSONToCSVConverter(String jsonFilePath, String csvFilePath) {
        this.jsonFilePath = jsonFilePath;
        this.csvFilePath = csvFilePath;
        this.columnOrder = new ArrayList<>();
    }

    /**
     * Set the column order for the output CSV
     *
     * @param columnOrder List of column names in the desired order
     */
    public void setColumnOrder(List<String> columnOrder) {
        this.columnOrder = columnOrder;
    }

    /**
     * Convert the JSON file to CSV
     */
    public void convert() throws Exception {
        // Parse the JSON file
        JSONParser parser = new JSONParser();
        JSONArray jsonArray = (JSONArray) parser.parse(new FileReader(jsonFilePath));

        // If no column order specified, extract it from the first JSON object
        if (columnOrder.isEmpty() && !jsonArray.isEmpty()) {
            JSONObject firstRow = (JSONObject) jsonArray.get(0);
            for (Object key : firstRow.keySet()) {
                columnOrder.add((String) key);
            }
        }

        // Open the CSV file for writing
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(csvFilePath))) {
            // Write the header row
            writer.write(String.join(",", escapeColumns(columnOrder)));
            writer.newLine();

            // Write each data row
            for (Object obj : jsonArray) {
                JSONObject jsonObj = (JSONObject) obj;
                List<String> rowValues = new ArrayList<>();

                // Extract values in the order specified by columnOrder
                for (String column : columnOrder) {
                    Object value = jsonObj.get(column);
                    rowValues.add(escapeValue(value));
                }

                writer.write(String.join(",", rowValues));
                writer.newLine();
            }
        }

        System.out.println("CSV conversion completed. Output file: " + csvFilePath);
    }

    /**
     * Escape a list of column names for CSV format
     */
    private List<String> escapeColumns(List<String> columns) {
        List<String> escaped = new ArrayList<>();
        for (String column : columns) {
            escaped.add(escapeValue(column));
        }
        return escaped;
    }

    /**
     * Escape a value for CSV format
     */
    private String escapeValue(Object value) {
        if (value == null) {
            return "";
        }

        String stringValue = value.toString();

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
}
