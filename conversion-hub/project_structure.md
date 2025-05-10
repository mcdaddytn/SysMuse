# Conversion Hub Project Setup

## Project Structure

```
conversion-hub/
├── pom.xml
├── src/
│   ├── main/
│   │   └── java/
│   │       └── com/
│   │           └── sysmuse/
│   │               ├── util/
│   │               │   ├── ConversionHub.java
│   │               │   ├── ConversionRepository.java
│   │               │   └── ... (other utility classes)
│   │               └── expr/
│   │                   ├── ExpressionManager.java
│   │                   └── CustomOperations.java
│   └── test/
│       ├── java/
│       │   └── com/
│       │       └── sysmuse/
│       │           └── util/
│       │               └── UserDataProcessingTest.java
│       └── resources/
│           └── users/
│               ├── users_base.csv
│               ├── users_roles.csv
│               ├── users_transactions.csv
│               ├── users_preferences.csv
│               ├── users_config.json
│               └── users_sysconfig.json
```

## Prerequisites

- Java 11 or higher
- Maven 3.6 or higher

## Setup Instructions

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/conversion-hub.git
   cd conversion-hub
   ```

2. Build the project
   ```bash
   mvn clean install
   ```

3. Run tests
   ```bash
   mvn test
   ```

## Configuration Files Explained

### Input CSV Files
- `users_base.csv`: Core user information
- `users_roles.csv`: User roles and access levels
- `users_transactions.csv`: Transaction history
- `users_preferences.csv`: User communication preferences

### Configuration Files
- `users_config.json`: Defines column types, derived fields, aggregations
- `users_sysconfig.json`: System-level configuration for input/output processing

## Key Features Demonstrated

- Multi-file data joining
- Derived boolean fields
- Complex boolean expressions
- Text field aggregation
- Subset generation
- Conditional field suppression

## Troubleshooting

- Ensure all CSV files are in the correct directory
- Check that file paths in configuration match your project structure
- Verify Java and Maven versions
- Run with `-X` flag for detailed Maven debugging

## Extending the Project

1. Add more input files
2. Create more complex derived field expressions
3. Implement additional custom operations in `CustomOperations.java`
