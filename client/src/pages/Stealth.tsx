import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { PiPView } from "@/components/pip-view";
import { useAudioCapture } from "@/hooks/use-audio-capture";

/**
 * Minimal "stealth" view for screen-share interviews.
 * Open this page in a separate browser window (e.g. second monitor or same screen but not shared).
 * Start capture from the main app tab; answers appear here in real time.
 * No branding or controls so the window is safe to keep visible only to you.
 */
export default function Stealth() {
  const { data: messages = [] } = useQuery({
    queryKey: [api.messages.list.path],
    queryFn: async () => {
      const res = await fetch(api.messages.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return api.messages.list.responses[200].parse(data);
    },
    refetchInterval: 2000,
  });

  const { isProcessing } = useAudioCapture();
  const latestMessage = messages[messages.length - 1];

  useEffect(() => {
    document.title = "Notes";
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <main className="flex-1 p-4 overflow-hidden flex flex-col">
        <PiPView
          latestMessage={latestMessage}
          isProcessing={isProcessing}
          isFallback={true}
        />
        <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
          Start capture from the main app tab. Updates every few seconds.
        </p>
      </main>
    </div>
  );
}
