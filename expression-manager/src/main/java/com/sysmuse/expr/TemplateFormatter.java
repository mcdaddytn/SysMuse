package com.sysmuse.expr;

import java.util.Map;

public class TemplateFormatter {

    /**
     * Format a string with placeholders like {name}, {value}, etc.,
     * replacing them using entries from the context map.
     */
    public static String format(String template, Map<String, Object> context, String start, String end) {
        StringBuilder result = new StringBuilder();
        int cursor = 0;

        while (cursor < template.length()) {
            int startIdx = template.indexOf(start, cursor);
            if (startIdx < 0) {
                result.append(template.substring(cursor));
                break;
            }

            result.append(template, cursor, startIdx);
            int endIdx = template.indexOf(end, startIdx + start.length());
            if (endIdx < 0) {
                result.append(template.substring(startIdx)); // unmatched brace
                break;
            }

            String key = template.substring(startIdx + start.length(), endIdx).trim();
            Object value = context.getOrDefault(key, start + key + end);
            result.append(value != null ? value.toString() : "");
            cursor = endIdx + end.length();
        }

        return result.toString();
    }

    public static String format(String template, Map<String, Object> context) {
        return format(template, context, "{", "}");
    }
}
