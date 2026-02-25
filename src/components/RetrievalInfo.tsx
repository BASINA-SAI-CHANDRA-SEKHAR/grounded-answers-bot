import { Database, Zap } from "lucide-react";
import type { ChatMeta } from "@/lib/chatApi";

const RetrievalInfo = ({ meta }: { meta: ChatMeta }) => (
  <div className="flex items-center gap-4 text-xs text-muted-foreground animate-slide-up font-mono">
    <span className="flex items-center gap-1">
      <Database className="h-3 w-3" />
      {meta.retrievedChunks} chunks retrieved
    </span>
    {meta.similarityScores.length > 0 && (
      <span className="flex items-center gap-1">
        <Zap className="h-3 w-3" />
        Top: {(meta.similarityScores[0].score * 100).toFixed(1)}% — &quot;{meta.similarityScores[0].title}&quot;
      </span>
    )}
  </div>
);

export default RetrievalInfo;
