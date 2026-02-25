const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-4 py-3">
    <div className="h-2 w-2 rounded-full bg-primary animate-typing-dot-1" />
    <div className="h-2 w-2 rounded-full bg-primary animate-typing-dot-2" />
    <div className="h-2 w-2 rounded-full bg-primary animate-typing-dot-3" />
  </div>
);

export default TypingIndicator;
