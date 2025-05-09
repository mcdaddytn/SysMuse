// ExpressionManagerDemo.java
package com.sysmuse.expr;

import java.util.*;
import com.sysmuse.util.LoggingUtil;

public class ExpressionManagerDemo {
    public static void main(String[] args) {
        test1();
        //test2();
    }

    public static void test2() {
        //LoggingUtil.init("INFO", true, false);

        ExpressionManager manager = ExpressionManager.getInstance();
        manager.registerDefaultOps();

        LinkedHashMap<String, Object> inputParams = new LinkedHashMap<>();
        inputParams.put("username", "admin");
        inputParams.put("role", "moderator");
        inputParams.put("price", 120);
        inputParams.put("isGuest", false);

        LinkedHashMap<String, String> expressions = new LinkedHashMap<>();
        expressions.put("isUserAdmin", "equals(username, \"admin\")");
        expressions.put("isMod", "contains(role, \"mod\")");
        expressions.put("inPriceRange", "price > 100 && price < 200");
        expressions.put("notAGuest", "not(isGuest)");
        expressions.put("finalCheck", "isUserAdmin && isMod && inPriceRange && notAGuest");

        Map<String, Boolean> results = manager.evaluateExpressions(expressions, inputParams);

        System.out.println("\n=== Evaluation Results ===");
        for (Map.Entry<String, Boolean> entry : results.entrySet()) {
            System.out.printf("%-20s : %s%n", entry.getKey(), entry.getValue());
        }
    }

    public static void test1() {
        ExpressionManager manager = ExpressionManager.getInstance();
        manager.registerDefaultOps();
        CustomOperations.registerCustom(manager);

        LinkedHashMap<String, Object> inputParams = new LinkedHashMap<>();
        inputParams.put("username", "admin");
        inputParams.put("role", "moderator");
        inputParams.put("price", 120);
        inputParams.put("isAdmin", true);
        inputParams.put("isGuest", false);
        inputParams.put("email", "jim@domain.com");
        inputParams.put("user", "fraudster");

        LinkedHashMap<String, String> expressions = new LinkedHashMap<>();
        expressions.put("isUserAdmin", "equals(username, \"admin\")");
        //expressions.put("isUserAdmin", "username == \"admin\"");
        //expressions.put("isUserAdmin", "equals(username, \\\"admin\\\")");
        expressions.put("isMod", "contains(role, \"mod\")");
        expressions.put("inPriceRange", "price > 100 && price < 200");
        expressions.put("notAGuest", "not(isGuest)");
        expressions.put("vipCheck", "isVIP(email)");
        expressions.put("flaggedOrAdmin", "isFlaggedOrAdmin(user, role)");
        expressions.put("finalCheck", "vipCheck && flaggedOrAdmin && notAGuest");

        Map<String, Boolean> results = manager.evaluateExpressions(expressions, inputParams);

        for (Map.Entry<String, Boolean> entry : results.entrySet()) {
            System.out.printf("%-20s : %s%n", entry.getKey(), entry.getValue());
        }
    }
}
