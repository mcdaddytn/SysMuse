# Regular Expression Operations

## Overview

The Conversion Hub now supports regular expression-based string matching operations for use in boolean expressions. These operations extend the string matching capabilities with powerful pattern matching.

## New Regex Operations

### 1. String Regex Match (`STRING_REGEX_MATCH`)

This operation checks if a field value matches a specified regular expression pattern.

```json
{
  "type": "STRING_REGEX_MATCH",
  "field": "Email",
  "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
}
```

- `field`: The name of the field to check
- `pattern`: The regular expression pattern to match against the field value

This expression evaluates to `true` if the field value matches the regex pattern.

### 2. String In Regex Set (`STRING_IN_REGEXSET`)

This operation checks if a field value matches any of the regular expression patterns in a set.

```json
{
  "type": "STRING_IN_REGEXSET",
  "field": "FileExtension",
  "patterns": [
    "(?i)jpg",
    "(?i)jpeg",
    "(?i)png",
    "(?i)gif"
  ]
}
```

- `field`: The name of the field to check
- `patterns`: Array of regex patterns to match against the field value

This expression evaluates to `true` if the field value matches any of the patterns in the set.

## Regex Syntax

The regular expression syntax follows Java's implementation (`java.util.regex.Pattern`). Some common patterns:

| Pattern | Description | Example |
|---------|-------------|---------|
| `^` | Start of line | `^Start` matches strings beginning with "Start" |
| `$` | End of line | `End$` matches strings ending with "End" |
| `(?i)` | Case-insensitive | `(?i)test` matches "Test", "TEST", "test" |
| `.*` | Any characters | `A.*Z` matches strings with A and Z with anything between |
| `\\d` | Digit | `\\d{3}` matches exactly 3 digits |
| `\\w` | Word character | `\\w+` matches one or more letters, digits, or underscores |
| `[...]` | Character class | `[aeiou]` matches any vowel |
| `(...)` | Grouping | `(abc)+` matches one or more occurrences of "abc" |
| `\\s` | Whitespace | `\\s+` matches one or more whitespace characters |
| `?` | Optional | `colou?r` matches "color" or "colour" |
| `+` | One or more | `a+` matches one or more "a" characters |
| `*` | Zero or more | `a*` matches zero or more "a" characters |

## Escaping Special Characters

When writing regex patterns in JSON, backslashes must be double-escaped:

- In regex: `\d{3}-\d{2}-\d{4}` (matches SSN format)
- In JSON: `"\\d{3}-\\d{2}-\\d{4}"`

## Practical Examples

### Email Validation

```json
{
  "type": "STRING_REGEX_MATCH",
  "field": "Email",
  "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
}
```

### URL Validation

```json
{
  "type": "STRING_REGEX_MATCH",
  "field": "URL",
  "pattern": "^https?://(?:www\\.)?[\\w-]+(?:\\.[\\w-]+)+[\\w.,@?^=%&:/~+#-]*$"
}
```

### Date Format Validation

```json
{
  "type": "STRING_REGEX_MATCH",
  "field": "DateString",
  "pattern": "^(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/\\d{4}$"
}
```

### File Type Detection

```json
{
  "type": "STRING_IN_REGEXSET",
  "field": "FileExtension",
  "patterns": [
    "(?i)docx?",
    "(?i)xlsx?",
    "(?i)pptx?",
    "(?i)pdf"
  ]
}
```

### IP Address Range Detection

```json
{
  "type": "OR",
  "operands": [
    {
      "type": "STRING_REGEX_MATCH",
      "field": "IPAddress",
      "pattern": "^10\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$"
    },
    {
      "type": "STRING_REGEX_MATCH",
      "field": "IPAddress",
      "pattern": "^172\\.(1[6-9]|2[0-9]|3[0-1])\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$"
    },
    {
      "type": "STRING_REGEX_MATCH",
      "field": "IPAddress",
      "pattern": "^192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}$"
    }
  ]
}
```

## Combining with Other Operations

Regex operations can be combined with the other boolean operations:

### Complex Example

```json
{
  "type": "AND",
  "operands": [
    {
      "type": "STRING_REGEX_MATCH",
      "field": "Email",
      "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    },
    {
      "type": "OR",
      "operands": [
        {
          "type": "STRING_REGEX_MATCH",
          "field": "Domain",
          "pattern": ".*\\.edu$"
        },
        {
          "type": "STRING_REGEX_MATCH",
          "field": "Domain",
          "pattern": ".*\\.gov$"
        }
      ]
    }
  ]
}
```

This checks if the email is valid AND the domain ends with .edu or .gov.

## Performance Considerations

Regular expressions can be computationally intensive. Consider these tips:

1. **Avoid Catastrophic Backtracking**: Be careful with nested repetition operators
2. **Optimize Patterns**: Start with more specific anchors like `^` and `$`
3. **Use Character Classes**: `[a-z]` is faster than `(a|b|c|...)`
4. **Consider Alternatives**: For simple substring checks, `STRING_EXACT_MATCH` may be faster
5. **Test on Sample Data**: Verify regex performance on representative data

## Error Handling

If a regex pattern is invalid, the operation will return `false` and log a warning. The process will continue to evaluate other expressions.

## Use Cases

1. **Data Validation**: Validate emails, phone numbers, URLs, ID formats
2. **Content Classification**: Identify file types based on extensions or patterns
3. **Network Analysis**: Categorize IP addresses or domain patterns
4. **Text Mining**: Extract patterns from structured or semi-structured text
5. **Multi-format Detection**: Recognize variations of the same type of data