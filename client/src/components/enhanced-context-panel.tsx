import React, { useState, useCallback, useMemo } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Upload, X, FileText, Briefcase, Code, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EnhancedContextPanelProps {
  onContextChange: (context: string) => void;
}

export function EnhancedContextPanel({ onContextChange }: EnhancedContextPanelProps) {
  const { toast } = useToast();
  const [role, setRole] = useState("");
  const [skills, setSkills] = useState("");
  const [projects, setProjects] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  // Memoized context string — computed from state, no side effects
  const contextString = useMemo(() => {
    const parts = [];
    if (role) parts.push(`Role: ${role}`);
    if (skills) parts.push(`Skills: ${skills}`);
    if (projects) parts.push(`Projects: ${projects}`);
    if (jobDescription) parts.push(`Job Description: ${jobDescription}`);
    if (resumeText) parts.push(`Resume: ${resumeText}`);
    return parts.join("\n\n");
  }, [role, skills, projects, jobDescription, resumeText]);

  // Notify parent when context changes (separate effect to avoid render loop)
  React.useEffect(() => {
    onContextChange(contextString);
  }, [contextString, onContextChange]);

  // Handle resume file upload
  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResumeFile(file);

    // Read file as text
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setResumeText(text.slice(0, 2000)); // Limit to 2000 chars
      toast({
        title: "Resume uploaded",
        description: `${file.name} loaded successfully`,
      });
    };
    reader.readAsText(file);
  };

  return (
    <Card className="p-4 space-y-4 bg-card/50 border-border/50">
      <div className="flex items-center gap-2 mb-2">
        <Target className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Interview Context</h3>
      </div>

      {/* Role/Position */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Briefcase className="w-4 h-4" />
          Role/Position
        </Label>
        <Input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g., Senior Backend Engineer"
          className="bg-background/50"
        />
      </div>

      {/* Skills */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Code className="w-4 h-4" />
          Your Skills
        </Label>
        <Input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="e.g., React, Node.js, Python, AWS, Docker, Kubernetes"
          className="bg-background/50"
        />
      </div>

      {/* Projects */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Code className="w-4 h-4" />
          Key Projects
        </Label>
        <Textarea
          value={projects}
          onChange={(e) => setProjects(e.target.value)}
          placeholder="e.g., E-commerce platform (React, Node.js, 100k users), Real-time chat app (WebSocket, Redis), ML recommendation system (Python, TensorFlow)"
          className="bg-background/50 min-h-[80px]"
        />
      </div>

      {/* Job Description */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Job Description
        </Label>
        <Textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the job description here..."
          className="bg-background/50 min-h-[100px]"
        />
      </div>

      {/* Resume Upload */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Resume (Optional)
        </Label>
        <div className="flex items-center gap-2">
          <Input
            type="file"
            accept=".txt,.md"
            onChange={handleResumeUpload}
            className="bg-background/50"
          />
          {resumeFile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResumeFile(null);
                setResumeText("");
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Upload .txt or .md file (first 2000 characters will be used)
        </p>
      </div>

      {/* Preview */}
      {contextString && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-2">Context Preview:</p>
          <div className="text-xs bg-secondary/30 p-3 rounded-lg max-h-[150px] overflow-y-auto">
            {contextString.slice(0, 500)}
            {contextString.length > 500 && "..."}
          </div>
        </div>
      )}
    </Card>
  );
}
