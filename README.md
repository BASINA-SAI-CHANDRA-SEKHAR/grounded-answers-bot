# 🧠 RAG-Powered GenAI Chat Assistant

A production-grade Retrieval-Augmented Generation (RAG) chat assistant built with React, Lovable Cloud, and real embedding-based document retrieval.

---

## 📐 Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                     │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ ChatInput│──│ Index Page   │──│ ChatMessage      │  │
│  └──────────┘  │ (Session Mgr)│  │ (Markdown render)│  │
│                └──────┬───────┘  └──────────────────┘  │
│                       │                                 │
│              ┌────────▼────────┐                        │
│              │  chatApi.ts     │                        │
│              │  (SSE Stream)   │                        │
│              └────────┬────────┘                        │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTPS POST (SSE streaming)
┌───────────────────────┼─────────────────────────────────┐
│              BACKEND (Edge Function)                    │
│                       │                                 │
│  ┌────────────────────▼─────────────────────────┐      │
│  │              /api/chat Handler                │      │
│  │                                               │      │
│  │  1. Validate input                            │      │
│  │  2. Generate query embedding (TF-IDF)         │      │
│  │  3. Cosine similarity search (top 3)          │      │
│  │  4. Apply similarity threshold (≥0.15)        │      │
│  │  5. Construct grounded RAG prompt             │      │
│  │  6. Stream LLM response via Lovable AI        │      │
│  └──────────────────────────────────────────────┘      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ docs.json    │  │ TF-IDF       │  │ Vector Store │  │
│  │ (10 docs)    │──│ Vectorizer   │──│ (in-memory)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 🔄 RAG Workflow Explanation

The RAG pipeline follows a strict **retrieve-then-generate** pattern to ensure grounded, hallucination-free responses:

```
User Query
    │
    ▼
┌─────────────────────┐
│ 1. TOKENIZE QUERY   │  Lowercase, remove punctuation, split into word tokens
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. GENERATE QUERY   │  Compute TF-IDF vector using pre-built vocabulary & IDF map
│    EMBEDDING         │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. SIMILARITY       │  Cosine similarity against all pre-computed chunk embeddings
│    SEARCH            │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. FILTER & RANK    │  Keep top-3 chunks with similarity ≥ 0.15 threshold
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 5. PROMPT           │  Inject retrieved chunks + conversation history
│    CONSTRUCTION      │  into structured system prompt
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 6. LLM GENERATION   │  Stream response from Lovable AI (Gemini Flash)
└─────────┬───────────┘
          ▼
   Grounded Response + Retrieval Metadata
```

### Step-by-Step

1. **User sends a message** → Frontend sends `{ message, sessionId, history }` to the edge function
2. **Query embedding** → The query is tokenized and converted to a TF-IDF vector
3. **Similarity search** → Cosine similarity computed against all document chunk embeddings
4. **Threshold filter** → Only chunks with similarity ≥ 0.15 are kept
5. **Context injection** → Top-3 relevant chunks injected into the LLM system prompt
6. **Grounded generation** → LLM generates a response strictly based on the provided context
7. **Fallback handling** → If no chunks pass threshold, LLM declines gracefully
8. **Streaming response** → Response streams token-by-token via SSE with retrieval metadata

---

## 📊 Embedding Strategy

### Why TF-IDF?

We use **Term Frequency–Inverse Document Frequency (TF-IDF)** embeddings — a proven, interpretable vectorization method that produces real numerical vectors suitable for cosine similarity search.

| Property | Details |
|----------|---------|
| **Method** | TF-IDF (Term Frequency × Inverse Document Frequency) |
| **Vector type** | Dense float array, one dimension per vocabulary term |
| **Normalization** | TF normalized by max term frequency per document |
| **IDF formula** | `log((N + 1) / (df + 1)) + 1` (smoothed) |
| **Storage** | In-memory at edge function cold start |
| **Chunking** | 400 tokens max per chunk, 50-token overlap |

### How It Works

```
Document: "Users can reset their password from Settings"

1. TOKENIZE     → ["users", "can", "reset", "their", "password", "from", "settings"]
2. TERM FREQ    → { users: 1/1, can: 1/1, reset: 1/1, ... }  (normalized by max)
3. IDF WEIGHT   → Each term weighted by rarity across all documents
4. TF-IDF VEC   → [0.0, 0.0, ..., 0.83, ..., 0.91, ...]  (sparse-ish float array)
```

### Chunking Strategy

- **Max chunk size:** 400 tokens (words)
- **Overlap:** 50 tokens between consecutive chunks
- **Rationale:** Keeps chunks semantically coherent while ensuring retrieval precision
- Documents shorter than 400 tokens remain as single chunks

---

## 🔍 Similarity Search Explanation

### Cosine Similarity Formula

```
                    A · B           Σ(Ai × Bi)
cos(θ) = ───────────────── = ─────────────────────
              ‖A‖ × ‖B‖      √Σ(Ai²) × √Σ(Bi²)
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Metric** | Cosine similarity | Scale-invariant, ideal for text vectors |
| **Top-K** | 3 | Balances context quality vs. prompt length |
| **Threshold** | 0.15 | Filters irrelevant matches while allowing partial matches |
| **Fallback** | Safe response | If no chunks pass threshold, LLM declines gracefully |

### Why Cosine Over Dot Product?

Cosine similarity normalizes for vector magnitude, making it robust when documents have different lengths. A short document about "password reset" will match a query about "resetting passwords" even though the raw dot product would favor longer documents.

### Retrieval Metadata Example

Every response includes transparency data:

```json
{
  "retrievedChunks": 3,
  "similarityScores": [
    { "title": "Reset Password", "score": 0.5877 },
    { "title": "Troubleshooting Login Issues", "score": 0.2134 },
    { "title": "Account Setup", "score": 0.1823 }
  ]
}
```

---

## 🎯 Prompt Design Reasoning

### System Prompt Structure

```
┌─────────────────────────────────────────────┐
│ SYSTEM PROMPT                               │
│                                             │
│ 1. Role definition (platform assistant)     │
│ 2. Strict grounding rules:                  │
│    - Answer ONLY from context               │
│    - No hallucination                       │
│    - Cite document titles                   │
│    - Graceful fallback if no context        │
│ 3. Retrieved context block:                 │
│    [Document 1: "Title" (relevance: X%)]    │
│    Content...                               │
│    [Document 2: "Title" (relevance: Y%)]    │
│    Content...                               │
├─────────────────────────────────────────────┤
│ CONVERSATION HISTORY (last 5 pairs)         │
├─────────────────────────────────────────────┤
│ CURRENT USER MESSAGE                        │
└─────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Reasoning |
|----------|-----------|
| **Temperature: 0.2** | Low creativity = more factual, grounded responses |
| **Context-first prompt** | Retrieved documents appear before the question, giving them higher attention weight |
| **Relevance percentages** | Included so LLM can weigh sources appropriately |
| **Explicit fallback instruction** | Prevents hallucination when no relevant context exists |
| **History limit: 5 pairs** | Keeps context window manageable while maintaining conversational coherence |
| **Document title citation** | Encourages the LLM to reference sources, improving trustworthiness |

---

## 🚀 Setup Instructions

### Prerequisites

- A [Lovable](https://lovable.dev) account
- Lovable Cloud enabled (backend is automatically provisioned)

### Quick Start

1. **Open the project** in Lovable editor
2. **Lovable Cloud** is already enabled — the edge function deploys automatically
3. **Click Preview** to see the chat interface
4. **Start chatting!** Try: _"How do I reset my password?"_

### Local Development

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm i

# Start the development server
npm run dev
```

### Knowledge Base Documents

The knowledge base is defined in the edge function (`supabase/functions/chat/index.ts`) and contains 10 documents:

| # | Document | Topic |
|---|----------|-------|
| 1 | Reset Password | Password recovery flow |
| 2 | Account Setup | New user registration |
| 3 | Billing and Subscriptions | Plan management |
| 4 | Two-Factor Authentication | 2FA setup |
| 5 | Data Export | Privacy data export |
| 6 | Team Management | Member roles & permissions |
| 7 | API Integration | REST API & rate limits |
| 8 | File Upload Limits | Size & format restrictions |
| 9 | Notification Settings | Alert preferences |
| 10 | Troubleshooting Login | Common login fixes |

### Adding New Documents

Edit the `docs` array in `supabase/functions/chat/index.ts`:

```json
{
  "title": "Your Document Title",
  "content": "Your document content here. Keep it focused and factual."
}
```

Documents are automatically chunked, embedded, and indexed on function cold start.

### API Endpoint

**`POST /functions/v1/chat`**

Request:
```json
{
  "sessionId": "abc123",
  "message": "How can I reset my password?",
  "history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ]
}
```

Response: Server-Sent Events (SSE) stream containing:
- First event: retrieval metadata (chunk count, similarity scores)
- Subsequent events: LLM response tokens
- Final event: `[DONE]`

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Tailwind CSS |
| **UI Components** | shadcn/ui + custom chat components |
| **Markdown** | react-markdown |
| **Backend** | Lovable Cloud Edge Functions (Deno) |
| **LLM** | Google Gemini 3 Flash (via Lovable AI Gateway) |
| **Embeddings** | TF-IDF vectorization (in-memory) |
| **Vector Storage** | In-memory array with cosine similarity |
| **Streaming** | Server-Sent Events (SSE) |
| **Session** | localStorage sessionId |

---

## 📸 Screenshots

> Launch the app to see:
> - **Empty state** with suggestion cards
> - **Active chat** with streaming responses and retrieval metadata
> - **Markdown rendering** in assistant responses
> - **New Chat** button for session reset

---

## 📁 Project Structure

```
src/
├── pages/
│   └── Index.tsx              # Main chat page with session management
├── components/
│   ├── ChatMessage.tsx        # Message bubble with markdown rendering
│   ├── ChatInput.tsx          # Input field with send button
│   ├── TypingIndicator.tsx    # Animated typing dots
│   └── RetrievalInfo.tsx      # RAG metadata display
├── lib/
│   └── chatApi.ts             # SSE streaming client
└── index.css                  # Design system tokens

supabase/
└── functions/
    └── chat/
        └── index.ts           # RAG pipeline + LLM integration
```

---

## 📝 License

MIT
