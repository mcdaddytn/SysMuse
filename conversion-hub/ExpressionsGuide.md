# Expression Language Guide

# Expression Language Guide for ExpressionManager

This guide provides documentation for using the expression evaluation system powered by `ExpressionManager`.

---

## Expression Syntax

- Use named operations like `equals(a, b)`, `gt(x, 100)`
- Combine conditions with boolean logic: `&&`, `||`, `!`
- Nest conditions and group with parentheses: `(a == b) && !c`
- Ternary expressions supported: `condition ? trueExpr : falseExpr`
- Support for stateful custom operations like `isVIP(email)`

---

## Supported Types

| Type     | Syntax Examples              |
|----------|------------------------------|
| String   | `"hello"`                    |
| Boolean  | `true`, `false`              |
| Number   | `100`, `3.14`                |
| List     | `["a", "b", "c"]` (in `oneOf`) |

---

## Built-in Operations

### String Ops

```text
equals(a, b)
contains(a, b)
isSubstringOf(sub, full)
oneOf(val, ["a", "b", "c"])

Numeric Ops:
gt(a, b), a > b
lt(a, b), a < b
ge(a, b), a >= b
le(a, b), a <= b
eq(a, b), a == b
ne(a, b), a != b


Boolean Logic:
not(a), !a
and(a, b), a && b
or(a, b), a || b


Example Expressions:
equals(username, "admin") && not(isGuest)
price > 100 && price < 500
isVIP(email) || isFlaggedOrAdmin(user, role)
isAdmin ? equals(role, "admin") : equals(role, "user")


Custom Stateful Operations
You can register operations like:

manager.registeredOps.put("isVIP", new IsVIP(List.of("ceo@corp.com")));
manager.opArgOrder.put("isVIP", List.of("email"));

And use them simply:
isVIP(email)


