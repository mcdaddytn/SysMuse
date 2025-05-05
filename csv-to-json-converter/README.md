# Enhanced CSV to JSON Converter

This project provides a robust tool for converting CSV files to JSON format with advanced options for data transformation and field derivation.

## Features

- Automatic data type inference for CSV columns
- Support for configurable data types (STRING, INTEGER, FLOAT, BOOLEAN)
- Boolean expression evaluation with AND, OR, and NOT operations
- Derived boolean fields based on complex boolean logic
- Text field aggregation based on boolean conditions
- Conditional field suppression based on boolean values
- Row count limiting with maxImportRows parameter
- Automatic configuration file generation
- Pretty printing for JSON output
- Property-based configuration

## Project Structure

```
csv-to-json-converter/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── sysmuse/
│   │   │           └── util/
│   │   │               ├── CSVToJSONConverter.java
│   │   │               ├── BooleanExpressionEvaluator.java
│   │   │               └── TextFieldProcessor.java
│   │   └── resources/
│   │       └── application.properties
│   └── test/
│       ├── java/
│       │   └── com/
│       │       └── sysmuse/
│       │           └── util/
│       │               └── CSVToJSONConverterTest.java
│       └── resources/
│           ├── sample.csv
│           └── config.json
├── config/
│   └── config.json
├── pom.xml
└── README.md
```

## Building the Project

### Prerequisites

- Java 8 or higher
- Maven 3.5 or higher

### Build Commands

```bash
# Clone the repository
git clone https://github.com/yourusername/csv-to-json-converter.git

# Navigate to the project directory
cd csv-to-json-converter

# Build the project
mvn clean package
```

## Usage

```bash
# Basic usage with default configuration directory
java -jar target/csv-to-json-converter-1.0.0-jar-with-dependencies.jar input.csv

# Specify a custom configuration directory
java -jar target/csv-to-json-converter-1.0.0-jar-with-dependencies.jar /path/to/config input.csv

# Explicitly specify a configuration file
java -jar target/csv-to-json-converter-1.0.0-jar-with-dependencies.jar /path/to/config input.csv custom-config.json
```

## Configuration

### Property-Based Configuration (application.properties)

The application uses an `application.properties` file for default settings:

```properties
# Default configuration directory (relative to application directory)
config.directory=config

# Default configuration file name
config.filename=config.json

# Maximum rows to process (0 for unlimited)
maxImportRows=0

# Default separator for text aggregation
default.text.separator= 

# Logging configuration
logging.level=INFO
logging.console=true
logging.file=false
logging.filename=converter.log

# Output formatting
output.pretty=true
output.indent=2
```

### JSON Configuration Format

The configuration file is in JSON format and supports the following sections:

#### 1. Parameters

```json
"parameters": {
  "maxImportRows": 1000
}
```

- `maxImportRows`: Maximum number of rows to import (optional)

#### 2. Column Definitions

```json
"columns": {
  "ColumnName": {
    "type": "BOOLEAN"
  }
}
```

Supported types: `STRING`, `INTEGER`, `FLOAT`, `BOOLEAN`

#### 3. Derived Boolean Fields

```json
"derivedBooleanFields": {
  "NewBooleanField": {
    "type": "AND",
    "operands": [
      {
        "type": "FIELD",
        "field": "ExistingBoolField1"
      },
      {
        "type": "FIELD",
        "field": "ExistingBoolField2"
      }
    ]
  }
}
```

Operations:
- `FIELD`: Direct reference to a boolean field
- `AND`: Logical AND of multiple operands
- `OR`: Logical OR of multiple operands
- `NOT`: Logical negation of an operand

#### 4. Aggregate Text Fields

```json
"aggregateTextFields": {
  "NewTextField": {
    "condition": "BooleanFieldName",
    "sourceFields": ["Field1", "Field2", "Field3"],
    "separator": " - "
  }
}
```

- `condition`: Boolean field that must be true for aggregation
- `sourceFields`: Array of field names to concatenate
- `separator`: String to insert between fields (optional, default is space)

#### 5. Suppressed Fields

```json
"suppressedFields": {
  "FieldToSuppress": "ConditionalBoolField"
}
```

- If the value of `ConditionalBoolField` is false, `FieldToSuppress` will be set to null in the output.

## Example Configuration

See the sample `config/config.json` file in the repository for a complete example with all features.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

