import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Knowledge Base ──────────────────────────────────────────────────────
interface Doc {
  title: string;
  content: string;
}

const docs: Doc[] = [
  {
    title: "Reset Password",
    content:
      "Users can reset their password by navigating to Settings > Security > Reset Password. They will receive a verification email with a link to create a new password. The link expires after 24 hours. If the link expires, users must request a new reset.",
  },
  {
    title: "Account Setup",
    content:
      "New users can create an account by clicking Sign Up on the homepage. They need to provide their email, full name, and a password with at least 8 characters including one uppercase letter and one number. After submitting, a confirmation email is sent.",
  },
  {
    title: "Billing and Subscriptions",
    content:
      "Billing is managed under Settings > Billing. Users can view their current plan, upgrade or downgrade their subscription, and update payment methods. Invoices are generated monthly and can be downloaded as PDF. Cancellation takes effect at the end of the billing period.",
  },
  {
    title: "Two-Factor Authentication",
    content:
      "Two-factor authentication (2FA) can be enabled from Settings > Security > Two-Factor Authentication. Users can choose between SMS verification or an authenticator app like Google Authenticator. Recovery codes are provided during setup and should be stored securely.",
  },
  {
    title: "Data Export",
    content:
      "Users can export their data by going to Settings > Privacy > Export Data. The export includes all personal information, activity logs, and uploaded files. The export is prepared as a ZIP file and a download link is sent via email within 24 hours.",
  },
  {
    title: "Team Management",
    content:
      "Team administrators can manage members from the Dashboard > Team section. They can invite new members via email, assign roles (Admin, Editor, Viewer), and remove members. Each role has specific permissions: Admins have full access, Editors can modify content, and Viewers have read-only access.",
  },
  {
    title: "API Integration",
    content:
      "Our platform provides a RESTful API for third-party integrations. API keys can be generated from Settings > Developer > API Keys. The API supports CRUD operations on all major resources. Rate limits are set at 1000 requests per minute for standard plans and 5000 for enterprise plans.",
  },
  {
    title: "File Upload Limits",
    content:
      "The maximum file upload size is 50MB for free accounts and 500MB for premium accounts. Supported file formats include PDF, DOCX, XLSX, PNG, JPG, and MP4. Files are scanned for viruses upon upload. Storage quota is 5GB for free and 100GB for premium accounts.",
  },
  {
    title: "Notification Settings",
    content:
      "Users can customize their notification preferences in Settings > Notifications. Options include email notifications, in-app notifications, and push notifications. Users can set preferences for each notification category: account alerts, team updates, billing reminders, and marketing communications.",
  },
  {
    title: "Troubleshooting Login Issues",
    content:
      "If users cannot log in, they should first check if their account is verified by looking for the confirmation email. Common issues include expired sessions, incorrect passwords, and browser cache problems. Clearing browser cookies and cache often resolves login issues. If problems persist, users should contact support.",
  },
];

// ── Chunking ────────────────────────────────────────────────────────────
interface Chunk {
  title: string;
  content: string;
  embedding: number[];
}

function chunkDocument(doc: Doc, maxTokens = 400): { title: string; content: string }[] {
  const words = doc.content.split(/\s+/);
  if (words.length <= maxTokens) return [{ title: doc.title, content: doc.content }];

  const chunks: { title: string; content: string }[] = [];
  for (let i = 0; i < words.length; i += maxTokens - 50) {
    const slice = words.slice(i, i + maxTokens).join(" ");
    if (slice.trim()) chunks.push({ title: doc.title, content: slice });
  }
  return chunks;
}

// ── TF-IDF Embedding ────────────────────────────────────────────────────
// Build vocabulary from all chunks
function buildVocabulary(chunks: { content: string }[]): string[] {
  const vocab = new Set<string>();
  for (const c of chunks) {
    for (const w of tokenize(c.content)) vocab.add(w);
  }
  return Array.from(vocab).sort();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) tf.set(k, v / max);
  return tf;
}

function computeIDF(chunks: { content: string }[], vocab: string[]): Map<string, number> {
  const N = chunks.length;
  const idf = new Map<string, number>();
  for (const term of vocab) {
    const df = chunks.filter((c) => tokenize(c.content).includes(term)).length;
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

function toTFIDFVector(text: string, vocab: string[], idf: Map<string, number>): number[] {
  const tokens = tokenize(text);
  const tf = termFrequency(tokens);
  return vocab.map((term) => (tf.get(term) || 0) * (idf.get(term) || 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Pre-compute embeddings at cold start ────────────────────────────────
const rawChunks = docs.flatMap((d) => chunkDocument(d));
const vocabulary = buildVocabulary(rawChunks);
const idfMap = computeIDF(rawChunks, vocabulary);

const embeddedChunks: Chunk[] = rawChunks.map((c) => ({
  ...c,
  embedding: toTFIDFVector(c.content, vocabulary, idfMap),
}));

console.log(`[RAG] Indexed ${embeddedChunks.length} chunks, vocabulary size: ${vocabulary.length}`);

// ── Similarity Search ───────────────────────────────────────────────────
function searchSimilar(query: string, topK = 3, threshold = 0.15): { chunk: Chunk; score: number }[] {
  const queryVec = toTFIDFVector(query, vocabulary, idfMap);
  const scored = embeddedChunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryVec, chunk.embedding) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}

// ── Handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, sessionId, history } = await req.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (message.length > 2000) {
      return new Response(JSON.stringify({ error: "Message too long (max 2000 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve relevant chunks
    const results = searchSimilar(message.trim());
    const retrievedChunks = results.length;

    console.log(`[RAG] Query: "${message.trim().slice(0, 60)}..." → ${retrievedChunks} chunks, scores: [${results.map((r) => r.score.toFixed(3)).join(", ")}]`);

    // Build context
    let contextBlock = "";
    if (results.length > 0) {
      contextBlock = results
        .map((r, i) => `[Document ${i + 1}: "${r.chunk.title}" (relevance: ${(r.score * 100).toFixed(1)}%)]\n${r.chunk.content}`)
        .join("\n\n");
    }

    // Build conversation history (last 5 pairs)
    const recentHistory = Array.isArray(history) ? history.slice(-10) : [];

    const systemPrompt = `You are a knowledgeable AI assistant for a software platform. Your role is to help users with their questions by using the provided documentation context.

RULES:
- Answer ONLY based on the provided context documents below.
- If the context does not contain relevant information to answer the question, clearly state: "I don't have enough information in my knowledge base to answer that question. Please try rephrasing or ask about a different topic."
- Do NOT hallucinate or make up information not present in the context.
- Be concise, helpful, and professional.
- Use markdown formatting for clarity when appropriate.
- Reference the document title when citing information.

${contextBlock ? `RETRIEVED CONTEXT:\n${contextBlock}` : "NO RELEVANT CONTEXT FOUND - inform the user you cannot answer this question from your knowledge base."}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const messages = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        stream: true,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    // Prepend metadata as first SSE event
    const metaEvent = `data: ${JSON.stringify({ meta: { retrievedChunks, sessionId, similarityScores: results.map((r) => ({ title: r.chunk.title, score: parseFloat(r.score.toFixed(4)) })) } })}\n\n`;
    const encoder = new TextEncoder();
    const metaStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(metaEvent));
        const reader = response.body!.getReader();
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) { controller.close(); return; }
            controller.enqueue(value);
            pump();
          }).catch((e) => controller.error(e));
        }
        pump();
      },
    });

    return new Response(metaStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
