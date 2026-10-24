import React from "react";
import { Message } from "@shared/schema";
import { format } from "date-fns";
import { User, Sparkles, Code, Network, MessageSquare, Lightbulb, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";

interface MessageFeedProps {
  messages: Message[];
}

export function MessageFeed({ messages }: MessageFeedProps) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = React.useState<number | null>(null);

  // Detect interview type from transcription
  const detectType = (transcription: string) => {
    const text = transcription.toLowerCase();
    if (text.includes("code") || text.includes("algorithm") || text.includes("function") || text.includes("implement")) return "coding";
    if (text.includes("system") || text.includes("design") || text.includes("architecture") || text.includes("scale")) return "system-design";
    if (text.includes("tell me about") || text.includes("describe a time") || text.includes("experience")) return "behavioral";
    return "general";
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "coding": return <Code className="w-3.5 h-3.5" />;
      case "system-design": return <Network className="w-3.5 h-3.5" />;
      case "behavioral": return <MessageSquare className="w-3.5 h-3.5" />;
      default: return <Lightbulb className="w-3.5 h-3.5" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "coding": return "text-blue-400 bg-blue-500/20 border-blue-500/30";
      case "system-design": return "text-purple-400 bg-purple-500/20 border-purple-500/30";
      case "behavioral": return "text-green-400 bg-green-500/20 border-green-500/30";
      default: return "text-amber-400 bg-amber-500/20 border-amber-500/30";
    }
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      title: "Copied to clipboard",
      description: "AI response copied successfully",
    });
  };
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 text-center border-2 border-dashed border-border/50 rounded-2xl m-6">
        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
        <h3 className="text-xl font-display font-medium text-foreground mb-2">No History Yet</h3>
        <p className="max-w-md">Start the audio capture to begin generating real-time transcription and AI hints.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
      <AnimatePresence initial={false}>
        {messages.map((msg, i) => {
          const interviewType = detectType(msg.transcription);
          return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i === messages.length - 1 ? 0 : 0.1 }}
            className="flex flex-col gap-4 max-w-4xl mx-auto w-full"
          >
            {/* Transcription Bubble */}
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0 border border-border shadow-sm">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-foreground/80">Speaker</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${getTypeColor(interviewType)}`}>
                    {getTypeIcon(interviewType)}
                    <span className="capitalize">{interviewType.replace("-", " ")}</span>
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {format(new Date(msg.createdAt!), "HH:mm:ss")}
                  </span>
                </div>
                <div className="bg-secondary/30 border border-border/50 rounded-2xl rounded-tl-none p-4 text-foreground/80 leading-relaxed">
                  {msg.transcription}
                </div>
              </div>
            </div>

            {/* AI Response Bubble */}
            <div className="flex gap-4 items-start flex-row-reverse">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30 shadow-[0_0_15px_hsla(var(--primary)/0.2)]">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 flex flex-col items-end">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground font-mono">
                    Copilot
                  </span>
                  <span className="font-medium text-sm text-primary">AI Copilot</span>
                </div>
                <div className="bg-card border border-border shadow-xl shadow-black/10 rounded-2xl rounded-tr-none p-5 text-foreground leading-relaxed w-full max-w-3xl text-left relative group">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(msg.aiResponse, msg.id!)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <div className="prose prose-invert max-w-none">
                    {/* We render the AI response which is likely bulleted text */}
                    {msg.aiResponse.split('\n').map((line, idx) => {
                      if (line.trim() === '') return null;
                      const cleanLine = line.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '');
                      if (line.match(/^[-•*\d]/)) {
                        return (
                          <div key={idx} className="flex gap-3 mb-3 last:mb-0">
                            <span className="text-primary mt-1 font-bold">•</span>
                            <span className="flex-1">{cleanLine}</span>
                          </div>
                        );
                      }
                      return <p key={idx} className="mb-2 last:mb-0">{line}</p>;
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )})}
      </AnimatePresence>
    </div>
  );
}
