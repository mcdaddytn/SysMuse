# ExpressionManager

**ExpressionManager** is a Java-based expression evaluation framework that supports:
- Boolean, numeric, and string operations
- Functional and operational (infix) syntax modes
- Custom operations loaded dynamically
- Templated string generation with variable substitution
- Type mismatch handling modes (EXCEPTION, WARNING, ACCEPT)
- Dependency-based execution ordering

---

## Features

- **Flexible Expression Syntax**: Supports `equals(a, b)`, `a == b`, `not(flag)`, `score > 80`, etc.
- **Typed Operations**: Separate operation interfaces for boolean, numeric, and string returns.
- **Dependency Resolution**: Ensures expressions are evaluated in proper order.
- **Templating**: Generate dynamic output with `template("User {username} has score {score}")`.
- **Extensibility**: Register your own operations at runtime.

---

## Project Structure

expression-manager/
+-- src/
¦ +-- main/java/com/sysmuse/expr/
¦ +-- test/java/com/sysmuse/expr/
+-- lib/
+-- config/
+-- bin/
+-- pom.xml
+-- setup_project.bat



---

## Build and Run

### Requirements
- Java 11+
- Maven 3.6+

### Compile
```sh
mvn clean compile

Run Tests
mvn test


 Sample Expression Flow
 {
   "params": {
     "radius": 3,
     "height": 10,
     "pi": 3.14159
   },
   "expressions": {
     "circleArea": "mul(pi, mul(radius, radius))",
     "volume": "mul(circleArea, height)",
     "report": "template(\"Volume is {volume}\")"
   }
 }

Type Mismatch Modes
manager.setTypeMismatchMode(TypeMismatchMode.WARNING);

EXCEPTION: throws error on type mismatch
WARNING: logs a warning and continues
ACCEPT: attempts implicit conversion



Dependencies
Jackson Databind

JUnit 5 (for unit tests)


Custom Operations
manager.getRegistry().registerBoolean("isVIP", (args, ctx) ->
    List.of("admin", "ceo").contains(args.get("user")),
    List.of("user"));
    
    

