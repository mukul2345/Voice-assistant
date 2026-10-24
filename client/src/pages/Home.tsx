import React, { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useMessages, useClearMessages } from "@/hooks/use-copilot";
import { useAudioCapture } from "@/hooks/use-audio-capture";
import { usePiP } from "@/hooks/use-pip";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PiPView } from "@/components/pip-view";
import { MessageFeed } from "@/components/message-feed";
import { FloatingAnalyzeButton } from "@/components/floating-analyze-button";
import { EnhancedContextPanel } from "@/components/enhanced-context-panel";
import { Mic, Square, Trash2, ExternalLink, Activity, LayoutTemplate, EyeOff, FileText, AlertTriangle, ChevronDown, ChevronUp, LogOut, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const { data: messages = [] } = useMessages();
  const clearMutation = useClearMessages();
  const { user, logout, trialRemaining, isSubscribed } = useAuth();
  const [sessionContext, setSessionContext] = useState("");
  const [showEnhancedContext, setShowEnhancedContext] = useState(false);
  const getContext = useCallback(() => sessionContext, [sessionContext]);
  const { state: captureState, startCapture, stopCapture, captureFrame, isProcessing } = useAudioCapture(getContext);
  const { isSupported: isPiPSupported, isPiPOpen, pipContainer, openPiP } = usePiP();

  const latestMessage = messages[messages.length - 1];
  const feedEndRef = useRef<HTMLDivElement>(null);

  const openStealthWindow = () => {
    const url = `${window.location.origin}/stealth`;
    window.open(
      url,
      "InterviewCopilotStealth",
      "width=420,height=700,left=100,top=100,menubar=no,toolbar=no,location=no,status=no"
    );
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary/30">
      
      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-display font-bold text-xl tracking-tight text-white">
            Interview<span className="text-primary font-light">Copilot</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Trial/Subscription Status */}
          {!isSubscribed && trialRemaining !== null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5" />
              <span>{Math.floor(trialRemaining / 60)}m remaining</span>
            </div>
          )}
          {isSubscribed && (
            <div className="text-xs text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
              ✓ Pro
            </div>
          )}

          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              // Export messages as JSON
              const dataStr = JSON.stringify(messages, null, 2);
              const dataBlob = new Blob([dataStr], { type: 'application/json' });
              const url = URL.createObjectURL(dataBlob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `interview-copilot-${new Date().toISOString().split('T')[0]}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            disabled={messages.length === 0}
            className="text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <FileText className="w-4 h-4 mr-2" />
            Export
          </Button>

          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={messages.length === 0 || clearMutation.isPending}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={openStealthWindow}
            className="bg-primary/90 hover:bg-primary text-primary-foreground shadow-lg"
          >
            <EyeOff className="w-4 h-4 mr-2" />
            Open Stealth Window
          </Button>
          {isPiPSupported && (
            <Button
              variant="outline"
              size="sm"
              onClick={openPiP}
              disabled={isPiPOpen}
              className="border-primary/30 text-primary hover:bg-primary/10"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              PiP
            </Button>
          )}

          {/* User Menu */}
          <div className="flex items-center gap-2 pl-2 border-l border-border/50">
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
              {user?.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-muted-foreground hover:text-destructive"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* How to hide copilot from recruiter (works for any meeting app: Meet, Teams, Zoom, etc.) */}
      <Alert className="mx-4 mt-4 border-amber-500/50 bg-amber-500/10 text-amber-200 [&>svg]:text-amber-500">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-amber-100">Share only a tab or window — not entire screen</AlertTitle>
        <AlertDescription>
          In your meeting app (Meet, Teams, Zoom, etc.) choose to share <strong>a single tab</strong> or <strong>a window</strong>, and select only the meeting. Do not share &quot;Entire screen&quot; or the recruiter will see this app and the stealth window.
        </AlertDescription>
      </Alert>

      {/* Main Content Layout */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Column: Controls & Feed */}
        <div className="flex-1 flex flex-col max-w-5xl border-r border-border/50 relative">
          
          {/* Session context: helps the copilot give technical, role-specific answers */}
          <div className="px-6 pt-4 pb-0 flex flex-col gap-2 max-w-2xl mx-auto w-full">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Session Context
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEnhancedContext(!showEnhancedContext)}
                className="text-xs"
              >
                {showEnhancedContext ? (
                  <>
                    <ChevronUp className="w-4 h-4 mr-1" />
                    Simple
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 mr-1" />
                    Enhanced (Resume, Skills, Projects)
                  </>
                )}
              </Button>
            </div>
            
            {showEnhancedContext ? (
              <EnhancedContextPanel onContextChange={setSessionContext} />
            ) : (
              <Input
                value={sessionContext}
                onChange={(e) => setSessionContext(e.target.value)}
                placeholder="e.g. Technical interview – Backend / System Design, DSA"
                className="bg-card/50 border-border/50"
              />
            )}
          </div>

          {/* Action Bar */}
          <div className="p-6 pb-0 flex flex-col gap-2 items-center">
            {captureState === "idle" || captureState === "error" ? (
              <>
                <Button 
                  size="lg" 
                  onClick={startCapture}
                  className="w-64 h-16 text-lg rounded-2xl shadow-[0_0_40px_hsla(var(--primary)/0.3)] hover:shadow-[0_0_60px_hsla(var(--primary)/0.5)] transition-all duration-500 hover:-translate-y-1"
                >
                  <Mic className="w-6 h-6 mr-3" />
                  Start Capture
                </Button>
                <div className="text-xs text-muted-foreground text-center max-w-sm space-y-1">
                  <p className="font-medium text-foreground/80">Works with any meeting app (Meet, Teams, Zoom):</p>
                  <ol className="list-decimal list-inside text-left space-y-0.5">
                    <li>Choose <strong>Tab</strong> or <strong>Window</strong></li>
                    <li>Select your <strong>meeting</strong></li>
                    <li>If your app shows it, check <strong>“Share tab audio”</strong> </li>
                    <li>Click <strong>Share</strong>. Use <strong>Analyse screen</strong> (floating button) when a question appears on screen.</li>
                  </ol>
                </div>
              </>
            ) : (
              <Button 
                size="lg" 
                variant="destructive"
                onClick={stopCapture}
                className="w-64 h-16 text-lg rounded-2xl animate-recording-pulse"
              >
                <Square className="w-6 h-6 mr-3 fill-current" />
                Stop Recording
              </Button>
            )}
          </div>

          <MessageFeed messages={messages} />
          <div ref={feedEndRef} className="h-4" /> {/* Scroll anchor */}
          
          {/* Bottom Fade Gradient for Feed */}
          <div className="absolute bottom-0 w-full h-12 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        {/* Right Column: Sidebar Fallback or Active Status */}
        <div className="w-[400px] hidden lg:flex flex-col bg-card/30">
          <div className="p-6 border-b border-border/50">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <LayoutTemplate className="w-5 h-5 text-primary" />
              Focus View
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Most recent AI suggestion. Share only a tab/window (not entire screen) so the recruiter cannot see this or the stealth window. Use <strong>Analyse screen</strong> when a question appears on the shared screen.
            </p>
          </div>
          
          <div className="flex-1 p-6">
            {!isPiPSupported || !isPiPOpen ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="h-[600px] shadow-2xl rounded-2xl ring-1 ring-border"
              >
                <PiPView 
                  latestMessage={latestMessage} 
                  isProcessing={isProcessing} 
                  isFallback={true} 
                />
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 border-2 border-dashed border-border/50 rounded-2xl">
                <ExternalLink className="w-12 h-12 mb-4 opacity-50" />
                <p>Stealth window is active</p>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* Render to PiP Window via Portal if open */}
      {isPiPOpen && pipContainer && createPortal(
        <PiPView latestMessage={latestMessage} isProcessing={isProcessing} />,
        pipContainer
      )}

      {/* Floating "Analyse screen" when capturing: captures current frame and gets AI answer for on-screen questions */}
      {captureState === "capturing" && captureFrame && (
        <FloatingAnalyzeButton captureFrame={captureFrame} getContext={getContext} />
      )}
    </div>
  );
}
