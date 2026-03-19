import React, { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Scan } from "lucide-react";
import { useAnalyzeScreen } from "@/hooks/use-copilot";
import { useToast } from "@/hooks/use-toast";

interface FloatingAnalyzeButtonProps {
  /** Call to capture current frame from shared tab/screen. Returns null if not capturing or no video. */
  captureFrame: () => Promise<Blob | null>;
  /** Session context to send with the request (e.g. "Technical interview - Backend") */
  getContext: () => string;
}

/**
 * Floating "Analyse screen" button. Shown while capture is active.
 * On click: captures current frame, sends to vision API, answer appears in feed and stealth view.
 */
export function FloatingAnalyzeButton({ captureFrame, getContext }: FloatingAnalyzeButtonProps) {
  const analyzeMutation = useAnalyzeScreen();
  const { toast } = useToast();

  const handleAnalyze = useCallback(async () => {
    try {
      const blob = await captureFrame();
      if (!blob) {
        toast({
          title: "No video",
          description: "Capture a tab or screen with video first, then try again.",
          variant: "destructive",
        });
        return;
      }
      await analyzeMutation.mutateAsync({
        imageBlob: blob,
        context: getContext(),
      });
      toast({
        title: "Screen analysed",
        description: "Answer added to the feed.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast({
        title: "Analysis failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [captureFrame, getContext, analyzeMutation, toast]);

  return (
    <Button
      size="lg"
      onClick={handleAnalyze}
      disabled={analyzeMutation.isPending}
      className="fixed bottom-6 right-6 z-50 h-14 rounded-full shadow-lg px-6 gap-2 bg-primary hover:bg-primary/90"
    >
      <Scan className="w-5 h-5" />
      {analyzeMutation.isPending ? "Analysing…" : "Analyse screen"}
    </Button>
  );
}
