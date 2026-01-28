# Focus Area Chat Feature Design

## Overview

A conversational interface within each focus area that enables users to explore, analyze, and expand their patent portfolios through natural language queries. The chat has full context of the focus area's patents, analyses, summaries, and can discover relevant patents from the broader portfolio.

---

## Context Layers

The chat operates with multiple context layers, prioritized by relevance:

### Layer 1: Focus Area Core
- **Focus area metadata**: name, description, target industry/competitors
- **Member patents**: Full patent data + all prompt template results
- **Strategic summaries**: Most recent collective template outputs (e.g., the strategic analysis JSON)

### Layer 2: Patent Analyses
- **Per-patent template results**: All STRUCTURED template outputs for member patents
- **LLM enrichment data**: technology_category, likely_implementers, market_segment, summaries
- **Scoring data**: POS relevance scores, licensing potential, claim strength assessments

### Layer 3: Peripheral Context (for expansion)
- **Candidate patents**: Patents matching focus area criteria but not yet members
  - Same technology_category as existing members
  - Similar likely_implementers
  - Matching keywords in summaries
  - Same CPC code prefixes
- **Portfolio-wide statistics**: Distribution by sector, technology category, etc.

### Layer 4: Historical Context
- **Previous chat sessions**: Continuity across conversations
- **Previous template executions**: How analyses have evolved as focus area expanded
- **Expansion history**: Which patents were added and why

---

## Data Model Changes

### New Prisma Models

```prisma
model FocusAreaChatSession {
  id            String   @id @default(cuid())

  focusAreaId   String   @map("focus_area_id")
  focusArea     FocusArea @relation(fields: [focusAreaId], references: [id], onDelete: Cascade)

  title         String?  // Auto-generated or user-provided session title
  status        ChatSessionStatus @default(ACTIVE)

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  messages      FocusAreaChatMessage[]

  @@map("focus_area_chat_sessions")
  @@index([focusAreaId])
}

model FocusAreaChatMessage {
  id            String   @id @default(cuid())

  sessionId     String   @map("session_id")
  session       FocusAreaChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  role          ChatRole // USER, ASSISTANT, SYSTEM
  content       String   @db.Text

  // Metadata for assistant messages
  tokensUsed    Int?     @map("tokens_used")
  modelUsed     String?  @map("model_used")

  // Actions suggested/taken
  suggestedPatents  String[] @map("suggested_patents") // Patent IDs suggested for addition
  addedPatents      String[] @map("added_patents")     // Patent IDs actually added

  createdAt     DateTime @default(now()) @map("created_at")

  @@map("focus_area_chat_messages")
  @@index([sessionId])
}

enum ChatSessionStatus {
  ACTIVE
  ARCHIVED
}

enum ChatRole {
  USER
  ASSISTANT
  SYSTEM
}
```

Add to FocusArea model:
```prisma
chatSessions  FocusAreaChatSession[]
```

---

## Backend Service: `focus-area-chat-service.ts`

### Context Builder

```typescript
interface FocusAreaChatContext {
  focusArea: {
    id: string;
    name: string;
    description: string | null;
    targetIndustry?: string;
    targetCompetitors?: string[];
  };

  memberPatents: {
    patent: PatentWithEnrichment;
    templateResults: Record<string, any>; // templateId -> result
  }[];

  strategicSummary: {
    templateId: string;
    templateName: string;
    executedAt: string;
    response: any; // The JSON response from collective template
  } | null;

  portfolioStats: {
    totalPatents: number;
    byTechnologyCategory: Record<string, number>;
    byMarketSegment: Record<string, number>;
  };

  candidatePatents?: {
    patent: PatentWithEnrichment;
    relevanceReason: string;
    matchScore: number;
  }[];
}

async function buildChatContext(
  focusAreaId: string,
  includePeripheralPatents: boolean = true,
  maxCandidates: number = 20
): Promise<FocusAreaChatContext>;
```

### Candidate Patent Discovery

```typescript
interface CandidateDiscoveryParams {
  focusAreaId: string;
  // Discovery methods (can combine multiple)
  byTechnologyCategory?: boolean;  // Same tech category as existing patents
  byLikelyImplementers?: boolean;  // Similar implementers
  byKeywords?: string[];           // Search terms in summaries
  byCpcPrefix?: boolean;           // Same CPC code families
  // Filters
  excludeExisting?: boolean;       // Don't include current members
  minScore?: number;               // Minimum portfolio score
  maxResults?: number;
}

async function discoverCandidatePatents(
  params: CandidateDiscoveryParams
): Promise<CandidatePatent[]>;
```

### Chat Execution

```typescript
interface ChatRequest {
  sessionId?: string;      // Continue existing session or create new
  focusAreaId: string;
  message: string;
  // Options
  includePeripheralContext?: boolean;  // Include candidate patents in context
  allowPatentActions?: boolean;        // Allow adding patents via chat
}

interface ChatResponse {
  sessionId: string;
  messageId: string;
  content: string;
  suggestedPatents?: {
    patentId: string;
    reason: string;
    relevanceScore: number;
  }[];
  tokensUsed: number;
}

async function chat(request: ChatRequest): Promise<ChatResponse>;
```

### System Prompt Template

```typescript
const FOCUS_AREA_CHAT_SYSTEM_PROMPT = `
You are a patent portfolio analyst assistant helping evaluate and expand a focus area for licensing/enforcement strategy.

## Focus Area Context
Name: {focusArea.name}
Description: {focusArea.description}
Member Patents: {memberPatents.length}

## Current Strategic Summary
{strategicSummary.response | json}

## Member Patent Analyses
{memberPatents | forEach: patent analysis summary}

## Your Capabilities
1. Answer questions about the current focus area patents and their analyses
2. Identify gaps in the portfolio coverage
3. Suggest patents from the broader portfolio that could strengthen the focus area
4. Compare and contrast patents within the focus area
5. Provide strategic recommendations based on the collective analysis

## When Suggesting Patents to Add
- Explain why each patent would strengthen the focus area
- Provide a relevance score (1-5)
- Note any potential concerns or limitations
- Format suggestions as: **Patent [ID]**: [Title] - [Reason]

## Available Candidate Patents (for expansion)
{candidatePatents | top 20 by relevance}

Respond conversationally but be precise with patent IDs and technical details.
`;
```

---

## API Endpoints

### Chat Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/focus-areas/:id/chat/sessions` | List chat sessions for focus area |
| `POST` | `/api/focus-areas/:id/chat/sessions` | Create new chat session |
| `GET` | `/api/focus-areas/:id/chat/sessions/:sid` | Get session with messages |
| `DELETE` | `/api/focus-areas/:id/chat/sessions/:sid` | Archive/delete session |

### Chat Messages

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/focus-areas/:id/chat` | Send message (creates session if needed) |
| `GET` | `/api/focus-areas/:id/chat/sessions/:sid/messages` | Get session messages |

### Candidate Discovery

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/focus-areas/:id/candidates` | Get candidate patents for expansion |
| `POST` | `/api/focus-areas/:id/candidates/search` | Search for candidates with custom criteria |

### Quick Actions (from chat suggestions)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/focus-areas/:id/chat/add-patents` | Add suggested patents to focus area |

---

## Frontend Components

### FocusAreaChatPanel.vue

```
┌─────────────────────────────────────────────────────────────┐
│ 💬 Focus Area Chat                              [Sessions ▾]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 Based on your strategic summary, this focus     │   │
│  │    area has strong coverage in payment security    │   │
│  │    but gaps in restaurant-specific workflows.      │   │
│  │                                                     │   │
│  │    The highest licensing potential patents are:    │   │
│  │    • **10460314** (4/5) - Session key pre-gen     │   │
│  │    • **10325262** (3/5) - POS risk scoring        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 👤 Find patents related to order management that   │   │
│  │    could fill the gaps                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 I found 3 patents in the portfolio that could   │   │
│  │    address order management:                       │   │
│  │                                                     │   │
│  │    **Patent 10892341**: "Order queue management    │   │
│  │    system for food service" - Directly addresses   │   │
│  │    kitchen order workflows (Relevance: 5/5)        │   │
│  │    [+ Add to Focus Area]                           │   │
│  │                                                     │   │
│  │    **Patent 10234567**: "Real-time inventory..."   │   │
│  │    ...                                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [📎 Context: 13 patents, latest summary from 10m ago]      │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Ask about patents, gaps, or request expansion...       ││
│ └─────────────────────────────────────────────────────────┘│
│                                               [Send 📤]    │
└─────────────────────────────────────────────────────────────┘
```

### Key UI Elements

1. **Session Selector**: Switch between chat sessions or start new
2. **Message Thread**: Scrollable conversation with user/assistant messages
3. **Patent Suggestion Cards**: Inline cards with [+ Add] buttons
4. **Context Indicator**: Shows how many patents and when last summary ran
5. **Input Area**: Text input with send button

### Integration with FocusAreaDetailPage

Add as a collapsible panel or tab alongside:
- Patents tab (existing grid)
- LLM Prompts tab (template editor)
- **Chat tab** (new conversational interface)

---

## Example Interactions

### Query: Gap Analysis
**User**: "What are the main gaps in our restaurant POS coverage?"

**Assistant**: Based on the strategic summary (executed 10 minutes ago), your portfolio has significant gaps in:

1. **Order Management & Kitchen Workflows** - No patents covering order routing, kitchen display systems, or ticket management
2. **Table Management** - Missing reservation systems and table status tracking
3. **Menu Management** - No coverage for dynamic pricing or menu configuration
4. **Delivery Integration** - No patents for third-party delivery platform connections

Your strongest coverage is in payment security (10460314, 8295484) and wireless infrastructure (8554137, 9929849).

### Query: Expansion Request
**User**: "Find patents that would help with kitchen display systems"

**Assistant**: I searched the portfolio for patents related to kitchen display systems. I found 2 potential candidates:

**Patent 10892341**: "Order queue management system for food service"
- Technology: Enterprise software
- Summary: Covers systems for routing orders to kitchen stations and tracking preparation status
- Relevance: 5/5 - Directly addresses kitchen workflows
- [+ Add to Focus Area]

**Patent 10123456**: "Real-time status display for distributed operations"
- Technology: IoT
- Summary: Generic status display system that could apply to kitchen environments
- Relevance: 3/5 - Would need claim mapping to confirm applicability
- [+ Add to Focus Area]

### Query: Competitive Analysis
**User**: "Which of our patents would be strongest against Square?"

**Assistant**: For enforcement against Square (payment processing focus), I'd prioritize:

1. **10460314** (Licensing potential: 4/5) - Session key pre-generation
   - Square uses offline-capable payment processing
   - Strong overlap with their reader hardware

2. **10467687** (Licensing potential: 3/5) - Fraud detection for infrequent users
   - Square explicitly listed as likely implementer in LLM analysis
   - Their fraud detection for small merchants matches this patent's focus

3. **10325262** (Licensing potential: 3/5) - Location-based POS risk scoring
   - Square's mobile payment features likely use location data

Note: For restaurant-specific Square features (Square for Restaurants), our coverage is weaker. Consider expanding with order management patents.

---

## Implementation Order

1. **Database schema** - Add chat session and message models
2. **Context builder service** - Aggregate focus area data for chat context
3. **Candidate discovery** - Find peripheral patents matching focus area criteria
4. **Chat service** - LLM integration with context injection
5. **API endpoints** - Chat CRUD and candidate discovery
6. **Frontend chat panel** - Conversational UI with patent suggestion cards
7. **Action integration** - Add patents from chat suggestions

---

## Future Enhancements

1. **Cross-focus-area chat**: Compare multiple focus areas
2. **Sector-level summaries**: Roll up to broader categories via tournament prompts
3. **Automated expansion suggestions**: Proactively suggest patents based on gap analysis
4. **Export conversations**: Generate reports from chat insights
5. **Citation graph navigation**: "Show patents cited by members of this focus area"
