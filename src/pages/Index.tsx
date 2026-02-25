import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Plus, Sparkles } from "lucide-react";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import RetrievalInfo from "@/components/RetrievalInfo";
import { streamChat, type Msg, type ChatMeta } from "@/lib/chatApi";
import { toast } from "sonner";

function getSessionId(): string {
  let id = localStorage.getItem("rag-session-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("rag-session-id", id);
  }
  return id;
}

const SUGGESTIONS = [
  "How do I reset my password?",
  "What are the file upload limits?",
  "How do I enable two-factor authentication?",
  "Tell me about team management",
];

const Index = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [metas, setMetas] = useState<Record<number, ChatMeta>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(getSessionId);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const handleNewChat = () => {
    const id = crypto.randomUUID();
    localStorage.setItem("rag-session-id", id);
    setSessionId(id);
    setMessages([]);
    setMetas({});
  };

  const handleSend = async (input: string) => {
    const userMsg: Msg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    let assistantSoFar = "";
    const assistantIndex = messages.length + 1; // index of the assistant message

    try {
      await streamChat({
        message: input,
        sessionId,
        history: messages.slice(-10),
        onMeta: (meta) => {
          setMetas((prev) => ({ ...prev, [assistantIndex]: meta }));
        },
        onDelta: (chunk) => {
          assistantSoFar += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
              );
            }
            return [...prev, { role: "assistant", content: assistantSoFar }];
          });
        },
        onDone: () => setIsLoading(false),
        onError: (error) => {
          setIsLoading(false);
          toast.error(error);
        },
      });
    } catch (e) {
      console.error(e);
      setIsLoading(false);
      toast.error("Failed to send message");
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">RAG Assistant</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Retrieval-Augmented Generation
            </p>
          </div>
        </div>
        <button
          onClick={handleNewChat}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary glow-primary">
              <MessageSquare className="h-8 w-8" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold">How can I help you?</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-md">
                Ask me anything about our platform — I'll search the knowledge base and give you grounded answers.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-w-lg w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-xl border bg-card px-4 py-3 text-left text-sm transition-all hover:border-primary/30 hover:glow-border"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-1 px-4 py-6">
            {messages.map((m, i) => (
              <div key={i} className="space-y-1">
                <ChatMessage role={m.role} content={m.content} />
                {m.role === "assistant" && metas[i] && (
                  <div className={`${i % 2 === 0 ? "" : "pl-11"}`}>
                    <RetrievalInfo meta={metas[i]} />
                  </div>
                )}
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <TypingIndicator />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-4 md:px-6">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
          <p className="mt-2 text-center text-[10px] text-muted-foreground font-mono">
            Powered by RAG · TF-IDF Embeddings · Cosine Similarity · Session: {sessionId.slice(0, 8)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
