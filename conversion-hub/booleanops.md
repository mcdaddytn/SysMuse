# String Matching Operations in Conversion Hub

The Conversion Hub supports various string matching operations for use in boolean expressions. These operations allow you to perform different types of string comparisons that can be used in:

1. Derived boolean fields
2. Condition fields for text aggregation
3. Field suppression logic

## Available String Operations

### 1. Exact String Match (`STRING_EXACT_MATCH`)

This operation performs a case-sensitive exact match between a field value and a specified string.

```json
{
  "type": "STRING_EXACT_MATCH",
  "field": "AccountType",
  "value": "Premium"
}
```

- `field`: The name of the field to compare
- `value`: The exact string to match

This expression evaluates to `true` only if the field value matches the specified string exactly, including case.

### 2. Case-Insensitive Match (`STRING_CASE_INSENSITIVE_MATCH`)

This operation performs a case-insensitive match between a field value and a specified string.

```json
{
  "type": "STRING_CASE_INSENSITIVE_MATCH",
  "field": "PreferredContact",
  "value": "email"
}
```

- `field`: The name of the field to compare
- `value`: The string to match (case doesn't matter)

This expression evaluates to `true` if the field value matches the specified string when both are converted to lowercase.

### 3. Set Membership Test (`STRING_IN_SET`)

This operation checks if a field value is a member of a specified set of strings.

```json
{
  "type": "STRING_IN_SET",
  "field": "PaymentMethod",
  "values": ["Credit Card", "PayPal", "Bank Transfer"],
  "ignoreCase": true
}
```

- `field`: The name of the field to check
- `values`: Array of strings that define the set of allowed values
- `ignoreCase`: (Optional) Boolean flag indicating whether to perform case-insensitive comparison

This expression evaluates to `true` if the field value matches any of the strings in the `values` array.

### 4. Regular Expression Match (`STRING_REGEX_MATCH`)

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

### 5. Regular Expression Set Test (`STRING_IN_REGEXSET`)

This operation checks if a field value matches any of the regular expression patterns in a specified set.

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

## Combining with Other Boolean Operations

The string matching operations can be combined with standard boolean operations:

### AND Operation Example

```json
{
  "type": "AND",
  "operands": [
    {
      "type": "STRING_EXACT_MATCH",
      "field": "AccountType",
      "value": "Premium"
    },
    {
      "type": "STRING_REGEX_MATCH",
      "field": "Email",
      "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    }
  ]
}
```

### NOT Operation Example

```json
{
  "type": "NOT",
  "operand": {
    "type": "STRING_CASE_INSENSITIVE_MATCH",
    "field": "AccountType",
    "value": "premium"
  }
}
```

### Complex Example

```json
{
  "type": "AND",
  "operands": [
    {
      "type": "STRING_IN_SET", 
      "field": "PaymentMethod",
      "values": ["Credit Card", "PayPal"],
      "ignoreCase": true
    },
    {
      "type": "OR",
      "operands": [
        {
          "type": "STRING_EXACT_MATCH",
          "field": "AccountType",
          "value": "Premium"
        },
        {
          "type": "STRING_EXACT_MATCH",
          "field": "AccountType",
          "value": "Business"
        }
      ]
    },
    {
      "type": "STRING_REGEX_MATCH",
      "field": "PhoneNumber",
      "pattern": "^\\+1-\\d{3}-\\d{3}-\\d{4}$"
    }
  ]
}
```

## Using String Operations for Derived Fields

String operations can be used to create derived boolean fields:

```json
"derivedBooleanFields": {
  "IsPremiumUser": {
    "type": "AND",
    "operands": [
      {
        "type": "STRING_EXACT_MATCH",
        "field": "AccountType",
        "value": "Premium"
      },
      {
        "type": "STRING_EXACT_MATCH",
        "field": "SubscriptionStatus",
        "value": "Active"
      }
    ],
    "visible": true
  },
  "HasValidEmail": {
    "type": "STRING_REGEX_MATCH",
    "field": "Email",
    "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
    "visible": true
  }
}
```

## Using String Operations for Text Aggregation

These derived fields can then be used as conditions for text aggregation:

```json
"aggregateTextFields": {
  "ContactInfo": {
    "condition": "HasValidEmail",
    "sourceFields": ["Email", "PhoneNumber"],
    "separator": " | ",
    "visible": true
  }
}
```

## Using String Operations for Field Suppression

Similarly, derived boolean fields can be used for field suppression:

```json
"suppressedFields": {
  "BillingAddress": "UsesPopularPayment",
  "PhoneNumber": "NOT:HasValidEmail"
}
```

## Implementation Notes

- String operations are evaluated at runtime for each row of data.
- For performance reasons, it's recommended to use the simplest expressions that meet your needs.
- When working with potentially null values, the operations handle them safely (null doesn't match any string)
- Regex operations may be more computationally intensive; use them only when necessary.