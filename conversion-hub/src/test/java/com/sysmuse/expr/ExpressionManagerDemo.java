// ExpressionManagerDemo.java
package com.sysmuse.expr;

import java.io.IOException;
import java.util.*;
import com.sysmuse.util.LoggingUtil;

public class ExpressionManagerDemo {
    public static void main(String[] args) {
        try {
            test1();
            //test2();
            //test3();
        } catch (Exception e) {
            LoggingUtil.error(e.getMessage());
            throw new RuntimeException(e);
        }
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
        // this one throwing an exception
        //expressions.put("finalCheck", "vipCheck && flaggedOrAdmin && notAGuest");

        expressions.put("textMatch", "equals(role, \"moderator\")");
        expressions.put("textIncludes", "contains(role, \"mod\")");
        expressions.put("mathEqual", "price == 120");
        expressions.put("mathNotEqual", "price != 999");
        expressions.put("mathGT", "price > 100");
        expressions.put("mathLT", "price < 200");

        //gm: these not yet working
        expressions.put("inOneOf", "oneOf(username, [\"admin\", \"superuser\"])");
        //expressions.put("notAdmin", "not(username == \"guest\")");

        Map<String, Boolean> results = manager.evaluateExpressions(expressions, inputParams);

        for (Map.Entry<String, Boolean> entry : results.entrySet()) {
            System.out.printf("%-20s : %s%n", entry.getKey(), entry.getValue());
        }
    }

    public static void test3() throws IOException {
        LoggingUtil.info("Starting JSON-based demo");

        ExpressionManager manager = ExpressionManager.getInstance();
        manager.registerDefaultOps();

        // Load custom ops from JSON file
        //CustomOperations.loadFromJson("custom_ops.json", manager);
        CustomOperations.loadFromJson("F:\\syscode\\SysMuse\\conversion-hub\\config\\custom_ops.json", manager);

        // Simulate input data
        LinkedHashMap<String, Object> inputParams = new LinkedHashMap<>();
        inputParams.put("email", "jim@domain.com");
        inputParams.put("user", "fraudster");
        inputParams.put("username", "admin");
        inputParams.put("role", "moderator");
        inputParams.put("price", 120);
        inputParams.put("isGuest", false);

        // Define expressions that use custom ops from JSON
        LinkedHashMap<String, String> expressions = new LinkedHashMap<>();
        expressions.put("vipCheck", "isVIP(email)");
        expressions.put("notAGuest", "not(isGuest)");

        // either of these should work now
        expressions.put("ceoFlag", "ceoIsVIP && notAGuest");
        //expressions.put("ceoFlag", "ceoIsVIP() && notAGuest");

        Map<String, Boolean> results = manager.evaluateExpressions(expressions, inputParams);

        System.out.println("\n=== Evaluation Results ===");
        for (Map.Entry<String, Boolean> entry : results.entrySet()) {
            System.out.printf("%-20s : %s%n", entry.getKey(), entry.getValue());
        }
    }
}
