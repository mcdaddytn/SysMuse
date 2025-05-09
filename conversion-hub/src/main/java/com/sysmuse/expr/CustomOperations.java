// CustomOperations.java
package com.sysmuse.expr;

import java.util.*;
import java.util.function.BiFunction;

public class CustomOperations {

    public static class IsVIP implements ExpressionManager.Operation {
        private final Set<String> vipEmails;

        public IsVIP(Collection<String> emails) {
            this.vipEmails = new HashSet<>(emails);
        }

        @Override
        public Boolean apply(Map<String, Object> args, Map<String, Boolean> context) {
            Object val = args.get("email");
            return val != null && vipEmails.contains(val.toString());
        }
    }

    public static class FlaggedUserCheck implements ExpressionManager.Operation {
        private final Set<String> flaggedUsers;
        private final ExpressionManager.Operation fallbackOp;

        public FlaggedUserCheck(Set<String> users, ExpressionManager.Operation fallback) {
            this.flaggedUsers = users;
            this.fallbackOp = fallback;
        }

        @Override
        public Boolean apply(Map<String, Object> args, Map<String, Boolean> context) {
            String user = Objects.toString(args.get("user"), "");
            if (flaggedUsers.contains(user)) return true;
            return fallbackOp.apply(args, context);
        }
    }

    public static void registerCustom(ExpressionManager manager) {
        // Prepopulate a set of VIP emails
        manager.registeredOps.put("isVIP", new IsVIP(List.of(
            "jim@domain.com", "mary@domain.com", "ceo@corp.com"
        )));
        manager.opArgOrder.put("isVIP", List.of("email"));

        // Create a compound operator that flags certain users OR checks for admin
        manager.registeredOps.put("isFlaggedOrAdmin",
            new FlaggedUserCheck(Set.of("bannedUser1", "fraudster"),
                (args, ctx) -> "admin".equals(args.get("role"))));
        manager.opArgOrder.put("isFlaggedOrAdmin", List.of("user", "role"));
    }
}


