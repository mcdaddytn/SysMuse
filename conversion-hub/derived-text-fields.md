# Derived Text Fields

## Overview

Derived Text Fields are a powerful feature that allows you to create new string fields derived from existing fields. These operations are performed before derived boolean fields and aggregate text fields, allowing you to build complex transformation pipelines.

## Processing Order

The processing order is important to understand how data flows:

1. **Derived Text Fields**: Text manipulations and transformations
2. **Derived Boolean Fields**: Boolean expressions and conditions
3. **Aggregate Text Fields**: Text aggregations based on conditions
4. **Field Suppression**: Conditional field hiding

This sequence allows you to use the output of one stage as input for the next.

## Supported Operations

The following operations are supported for derived text fields:

| Operation | Description | Example Input | Example Output |
|-----------|-------------|---------------|----------------|
| `STRIP_EXTENSION` | Remove file extension | "document.pdf" | "document" |
| `GET_EXTENSION` | Extract file extension | "document.pdf" | "pdf" |
| `GET_PATH` | Extract path portion | "/users/data/document.pdf" | "/users/data" |
| `GET_FILE_ROOT` | Extract filename without extension | "/users/data/document.pdf" | "document" |
| `GET_FILENAME` | Extract filename with extension | "/users/data/document.pdf" | "document.pdf" |

## Configuration

### In Configuration File (config.json)

Add a `derivedTextFields` section to your configuration:

```json
"derivedTextFields": {
  "FileDirectory": {
    "operation": "GET_PATH",
    "sourceField": "FilePath",
    "visible": true
  },
  "FileName": {
    "operation": "GET_FILENAME",
    "sourceField": "FilePath",
    "visible": true
  },
  "FileExtension": {
    "operation": "GET_EXTENSION",
    "sourceField": "FilePath",
    "visible": true
  }
}
```

Each derived field has:
- A unique field name (key)
- `operation`: The operation to perform (from supported operations)
- `sourceField`: The field containing the source data
- `visible` (optional): Whether the field should be visible in output (default: true)

### In System Configuration (sysconfig.json)

You can also define common derived text field operations:

```json
"derivedTextOperations": {
  "FileDirectory": "GET_PATH",
  "FileName": "GET_FILENAME",
  "FileRoot": "GET_FILE_ROOT",
  "FileExtension": "GET_EXTENSION",
  "BaseFileName": "STRIP_EXTENSION"
}
```

## Usage Examples

### Example 1: File Path Processing

Starting with a `FilePath` field containing "/data/users/john/documents/report.pdf":

```json
"derivedTextFields": {
  "FileDirectory": {
    "operation": "GET_PATH",
    "sourceField": "FilePath"
  },
  "FileName": {
    "operation": "GET_FILENAME",
    "sourceField": "FilePath"
  },
  "FileRoot": {
    "operation": "GET_FILE_ROOT",
    "sourceField": "FilePath"
  },
  "FileExtension": {
    "operation": "GET_EXTENSION",
    "sourceField": "FilePath"
  }
}
```

This would create:
- `FileDirectory`: "/data/users/john/documents"
- `FileName`: "report.pdf"
- `FileRoot`: "report"
- `FileExtension`: "pdf"

### Example 2: Chaining Operations

You can chain operations by using the output of one derived field as input for another:

```json
"derivedTextFields": {
  "FileName": {
    "operation": "GET_FILENAME",
    "sourceField": "FilePath" 
  },
  "RawName": {
    "operation": "STRIP_EXTENSION",
    "sourceField": "FileName"
  }
}
```

### Example 3: Using with Derived Boolean Fields

The derived text fields can be used in boolean expressions:

```json
"derivedTextFields": {
  "FileExtension": {
    "operation": "GET_EXTENSION",
    "sourceField": "FilePath"
  }
},
"derivedBooleanFields": {
  "IsPdfDocument": {
    "type": "STRING_CASE_INSENSITIVE_MATCH",
    "field": "FileExtension",
    "value": "pdf"
  }
}
```

### Example 4: Complete Pipeline

```json
"derivedTextFields": {
  "FileName": {
    "operation": "GET_FILENAME",
    "sourceField": "FilePath"
  },
  "FileExtension": {
    "operation": "GET_EXTENSION",
    "sourceField": "FilePath"
  }
},
"derivedBooleanFields": {
  "IsDocument": {
    "type": "STRING_IN_SET",
    "field": "FileExtension",
    "values": ["pdf", "doc", "docx", "txt"],
    "ignoreCase": true
  }
},
"aggregateTextFields": {
  "DocumentInfo": {
    "condition": "IsDocument",
    "sourceFields": ["FileName", "Category", "Size"],
    "separator": " | "
  }
}
```

## Best Practices

1. **Processing Order**: Remember that derived text fields are processed first, before derived boolean fields and aggregations.

2. **Chain Dependencies**: When chaining operations, ensure source fields are defined before derived fields that depend on them.

3. **Reusable Operations**: Define common operations in `sysconfig.json` for reuse across multiple conversions.

4. **Validate Paths**: For path operations, ensure file paths use consistent separators for reliable results.

5. **Field Visibility**: Use the `visible` property to control which derived fields appear in output formats.

## Technical Details

- **Null Handling**: If a source field is null, the derived field will also be null.
- **Error Handling**: Errors during processing set the field to an empty string and log the error.
- **Path Separators**: Path operations work with both forward (/) and backslash (\\) separators.
- **Performance**: Text field processing is generally fast and has minimal impact on overall performance.

## Limitations

- Operations are currently limited to file path manipulations.
- Only string fields are supported as both input and output.
- No regular expression or complex string manipulation is supported yet.
