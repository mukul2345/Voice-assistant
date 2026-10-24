import React from "react";
import { Message } from "@shared/schema";
import { format } from "date-fns";
import { Bot, Sparkles, Loader2, Code, Network, MessageSquare, Lightbulb } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface PiPViewProps {
  latestMessage?: Message;
  isProcessing: boolean;
  isFallback?: boolean;
}

interface PiPViewProps {
  latestMessage?: Message;
  isProcessing: boolean;
  isFallback?: boolean;
}

export function PiPView({ latestMessage, isProcessing, isFallback = false }: PiPViewProps) {
  
  // Parse bullet points from AI response (assuming it returns dash or bullet separated lines)
  const getBulletPoints = (text: string) => {
    if (!text) return [];
    return text.split('\n')
      .map(line => line.trim().replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, ''))
      .filter(line => line.length > 3); // Filter out very short lines
  };

  // Detect interview type from transcription for icon display
  const detectType = (transcription: string) => {
    const text = transcription.toLowerCase();
    if (text.includes("code") || text.includes("algorithm") || text.includes("function")) return "coding";
    if (text.includes("system") || text.includes("design") || text.includes("architecture")) return "system-design";
    if (text.includes("tell me about") || text.includes("describe a time")) return "behavioral";
    return "general";
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "coding": return <Code className="w-4 h-4" />;
      case "system-design": return <Network className="w-4 h-4" />;
      case "behavioral": return <MessageSquare className="w-4 h-4" />;
      default: return <Lightbulb className="w-4 h-4" />;
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

  const bullets = getBulletPoints(latestMessage?.aiResponse || "");
  const interviewType = latestMessage ? detectType(latestMessage.transcription) : "general";

  return (
    <div className={`w-full h-full flex flex-col ${isFallback ? 'rounded-2xl border border-border bg-card' : 'bg-background'} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-secondary/30 backdrop-blur-sm">
        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary relative">
          <Bot className="w-5 h-5" />
          {isProcessing && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-semibold text-lg leading-none">Copilot Focus</h2>
            {latestMessage && (
              <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${getTypeColor(interviewType)}`}>
                {getTypeIcon(interviewType)}
                <span className="capitalize">{interviewType.replace("-", " ")}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {latestMessage ? `Updated ${format(new Date(latestMessage.createdAt!), "HH:mm:ss")}` : "Waiting for audio..."}
          </p>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          {isProcessing && !latestMessage ? (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4"
            >
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Listening to conversation...</p>
            </motion.div>
          ) : !latestMessage ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center text-center px-4"
            >
              <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4 text-muted-foreground">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="font-display font-medium text-lg mb-2">Ready to assist</h3>
              <p className="text-sm text-muted-foreground max-w-[250px]">
                Start capturing audio. Critical hints and answers will appear here in real-time.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={latestMessage.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="space-y-4"
            >
              {bullets.map((bullet, idx) => (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  key={idx}
                  className="flex gap-4 p-4 rounded-xl bg-secondary/40 border border-border/50 shadow-lg shadow-black/20"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    {idx + 1}
                  </div>
                  <p className="text-foreground/90 font-medium leading-relaxed">{bullet}</p>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Footer hint */}
      {!isFallback && (
         <div className="py-2 text-center text-[10px] text-muted-foreground/50 font-mono tracking-widest uppercase">
            ALWAYS ON TOP
         </div>
      )}
    </div>
  );
}
