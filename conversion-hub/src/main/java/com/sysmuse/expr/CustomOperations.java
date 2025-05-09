// CustomOperations.java
package com.sysmuse.expr;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.function.BiFunction;

public class CustomOperations {

    // Base class for all custom operations
    public static abstract class CustomOp implements ExpressionManager.Operation {
        protected final List<String> argNames;
        public CustomOp(List<String> argNames) { this.argNames = argNames; }
        public List<String> getArgNames() { return argNames; }
    }

    // Constant literal (boolean, number, etc.)
    public static class LiteralOp extends CustomOp {
        private final Object value;
        public LiteralOp(Object value) { super(List.of()); this.value = value; }
        public Boolean apply(Map<String, Object> vars, Map<String, Boolean> ctx) {
            return (Boolean) value;
        }
    }

    // Checks if a single input is in a fixed set
    public static class SetMembershipOp extends CustomOp {
        private final Set<Object> values;
        public SetMembershipOp(String argName, Collection<Object> values) {
            super(List.of(argName));
            this.values = new HashSet<>(values);
        }
        public Boolean apply(Map<String, Object> vars, Map<String, Boolean> ctx) {
            return values.contains(vars.get(argNames.get(0)));
        }
    }

    // Loads custom ops from JSON file
    public static void loadFromJson(String path, ExpressionManager manager) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(new File(path));
        for (JsonNode op : root.get("customOps")) {
            String name = op.get("name").asText();
            String type = op.get("type").asText();

            switch (type) {
                case "literal":
                    boolean val = op.get("value").asBoolean();
                    manager.registeredOps.put(name, new LiteralOp(val));
                    manager.opArgOrder.put(name, List.of());
                    break;

                case "setMembership": {
                    List<Object> set = mapper.convertValue(op.get("set"), new TypeReference<List<Object>>() {});
                    String argName = op.get("args").get(0).asText();
                    manager.registeredOps.put(name, new SetMembershipOp(argName, set));
                    manager.opArgOrder.put(name, List.of(argName));
                    break;
                }

                default:
                    throw new RuntimeException("Unsupported custom op type: " + type);
            }
        }
    }

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


