# Conversion Hub

A flexible and extensible data conversion utility that provides bidirectional transformation between different data formats (currently CSV and JSON). The application features derived fields, text aggregation, and conditional field suppression based on configuration.

## Features

- **Format Conversion**: Convert between CSV and JSON formats with preserved data types
- **Type Inference**: Automatic data type detection for CSV columns
- **Bidirectional Conversion**: Import from and export to multiple formats
- **Configuration-Based Transformation**:
  - Derived boolean fields based on logical expressions
  - Text field aggregation based on conditions
  - Conditional field suppression
  - Column visibility control
- **Automatic Configuration Generation**: Generate configuration files based on data structure
- **Specialized Processors**: Handle specific data structures (e.g., "Applicable Format" with related text fields)
- **Extensible Architecture**: Add new format converters easily

## Project Structure

```
conversion-hub/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── sysmuse/
│   │   │           └── util/
│   │   │               ├── ConversionHub.java            # Main application class
│   │   │               ├── ConversionRepository.java     # Core data storage
│   │   │               ├── CsvConverter.java             # CSV format handler
│   │   │               ├── JsonConverter.java            # JSON format handler
│   │   │               ├── ConfigGenerator.java          # Configuration generator interface
│   │   │               ├── StandardConfigGenerator.java  # Standard configuration generator
│   │   │               ├── ApplicableFormatConfigGenerator.java  # Specialized config generator
│   │   │               ├── BooleanExpressionEvaluator.java # Expression evaluator
│   │   │               └── TextFieldProcessor.java       # Text field processor
│   │   └── resources/
│   │       └── application.properties                   # Default application properties
│   └── test/
│       ├── java/
│       │   └── com/
│       │       └── sysmuse/
│       │           └── util/
│       │               └── [Test classes]
│       └── resources/
│           ├── sample.csv
│           └── sample-config.json
├── config/
│   └── config.json                                      # Default configuration
├── pom.xml                                              # Maven project file
└── README.md                                            # This file
```

## Building the Project

### Prerequisites

- Java 8 or higher
- Maven 3.5 or higher

### Build Commands

```bash
# Clone the repository
git clone https://github.com/yourusername/conversion-hub.git

# Navigate to the project directory
cd conversion-hub

# Build the project
mvn clean package
```

## Usage

### Basic Usage

```bash
# Convert from CSV to JSON (default behavior)
java -jar target/conversion-hub-1.0.0-jar-with-dependencies.jar input.csv

# Convert from JSON to CSV
java -jar target/conversion-hub-1.0.0-jar-with-dependencies.jar input.json

# Specify a configuration file
java -jar target/conversion-hub-1.0.0-jar-with-dependencies.jar input.csv config.json

# Specify a config directory and input file
java -jar target/conversion-hub-1.0.0-jar-with-dependencies.jar /path/to/config input.csv

# Specify a config directory, input file, config file, and output format
java -jar target/conversion-hub-1.0.0-jar-with-dependencies.jar /path/to/config input.csv custom-config.json json
```

### Configuration Options

The application can be configured using:

1. **Command-line arguments**: As shown in the usage examples
2. **application.properties file**: Default settings for the application
3. **JSON configuration file**: Advanced transformation settings

#### Property-Based Configuration (application.properties)

```properties
# Input file configuration
input.csv.path=/path/to/directory
input.csv.filename=input.csv

# Configuration directory and file
config.directory=/path/to/config
config.filename=config.json

# Configuration generator class
config.generator.class=com.sysmuse.util.StandardConfigGenerator
# For specialized formats use: com.sysmuse.util.ApplicableFormatConfigGenerator

# Applicable format configuration
applicable.format.compound.expressions=Field1 AND Field2,Field3 OR Field4

# Maximum rows to process (0 for unlimited)
maxImportRows=1000

# Set maximum text length (0 for unlimited)
maxTextLength=1000

# Enable conversion back to CSV with a specific suffix
output.csvSuffix=_converted.csv

# Logging configuration
logging.level=INFO
logging.console=true
logging.file=false
logging.filename=converter.log

# Output formatting
output.pretty=true
output.indent=2
```

#### JSON Configuration Format

The configuration file is in JSON format and supports the following sections:

##### 1. Parameters

```json
"parameters": {
  "maxImportRows": 1000
}
```

##### 2. Column Definitions

```json
"columns": {
  "ColumnName": {
    "type": "BOOLEAN",
    "visible": true
  }
}
```

Supported types: `STRING`, `INTEGER`, `FLOAT`, `BOOLEAN`

##### 3. Derived Boolean Fields

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
    ],
    "visible": true
  }
}
```

Operations:
- `FIELD`: Direct reference to a boolean field
- `AND`: Logical AND of multiple operands
- `OR`: Logical OR of multiple operands
- `NOT`: Logical negation of an operand

##### 4. Aggregate Text Fields

```json
"aggregateTextFields": {
  "NewTextField": {
    "condition": "BooleanFieldName",
    "sourceFields": ["Field1", "Field2", "Field3"],
    "separator": " - ",
    "visible": true
  }
}
```

##### 5. Suppressed Fields

```json
"suppressedFields": {
  "FieldToSuppress": "ConditionalBoolField"
}
```

## Architecture

### Key Components

1. **ConversionHub**: The main application class that coordinates the conversion process. It handles command-line arguments, loads configuration, and orchestrates the process.

2. **ConversionRepository**: The core data storage class that maintains data in memory with type information and configuration settings. It manages derived fields, aggregation, and field suppression.

3. **Format Converters**: Classes that handle specific data formats:
   - **CsvConverter**: Imports from and exports to CSV format
   - **JsonConverter**: Imports from and exports to JSON format using Jackson library

4. **Configuration Generators**:
   - **ConfigGenerator**: Interface for configuration generation
   - **StandardConfigGenerator**: Basic implementation for simple configurations
   - **ApplicableFormatConfigGenerator**: Specialized implementation for formats with related fields

5. **Utility Classes**:
   - **BooleanExpressionEvaluator**: Evaluates boolean expressions for derived fields
   - **TextFieldProcessor**: Processes text fields based on conditions

### Data Flow

1. **Import Phase**:
   - Parse input file (CSV or JSON)
   - Infer data types if needed
   - Load or generate configuration
   - Apply configuration to data
   - Store in ConversionRepository

2. **Processing Phase**:
   - Apply derived boolean fields
   - Process text field aggregation
   - Apply field suppression
   - Filter based on visibility settings

3. **Export Phase**:
   - Get data from ConversionRepository
   - Format according to output format
   - Write to output file

## Extending the Project

### Adding a New Format Converter

To add support for a new data format (e.g., XML, YAML):

1. Create a new converter class implementing similar methods to CsvConverter or JsonConverter:
   ```java
   public class XmlConverter {
       // Import methods
       public void importToRepository(String xmlFilePath, ConversionRepository repository) { ... }
       
       // Export methods
       public void exportFromRepository(ConversionRepository repository, String xmlFilePath) { ... }
   }
   ```

2. Update ConversionHub to recognize and handle the new format.

### Adding New Transformation Features

To add new data transformation capabilities:

1. Add new configuration sections to the JSON config format
2. Implement the processing logic in ConversionRepository
3. Update existing converters to support the new features

## License

This project is licensed under the MIT License - see the LICENSE file for details.
