import React, { useState, useEffect } from "react";
import { Button } from "../components/ui/button";
import { Video } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Mood } from "@shared/schema";
import { API_BASE_URL } from "../lib/api";
import { useWebSocket } from "../context/WebSocketContext";

const MOODS: readonly {
  id: Mood;
  emoji: string;
  name: string;
  description: string;
}[] = [
  { id: "happy", emoji: "😊", name: "Happy", description: "Feeling joyful and upbeat" },
  { id: "relaxed", emoji: "😌", name: "Relaxed", description: "Calm and peaceful vibes" },
  { id: "energetic", emoji: "⚡", name: "Energetic", description: "Full of energy and ready to chat" },
  { id: "thoughtful", emoji: "🤔", name: "Thoughtful", description: "Deep conversations welcome" },
  { id: "creative", emoji: "🎨", name: "Creative", description: "Artistic and imaginative mood" },
  { id: "adventurous", emoji: "🌟", name: "Adventurous", description: "Ready for new experiences" },
  { id: "nostalgic", emoji: "💭", name: "Nostalgic", description: "Reminiscing about memories" },
  { id: "curious", emoji: "🔍", name: "Curious", description: "Eager to learn and explore" },
] as const;

interface Props {
  onMoodSelect: (mood: Mood) => void;
}

type MoodStats = Record<Mood, number>;

const initialMoodStats: MoodStats = {
  happy: 0,
  relaxed: 0,
  energetic: 0,
  thoughtful: 0,
  creative: 0,
  adventurous: 0,
  nostalgic: 0,
  curious: 0,
};

export default function MoodSelection({ onMoodSelect }: Props) {
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);

  // Get central WebSocket and socketId from context
  const { socketId, ws } = useWebSocket();

  // Log socketId and connection status for debugging
  useEffect(() => {
    console.log("[MoodSelection] Central WebSocket socketId:", socketId);
    if (ws) {
      console.log("[MoodSelection] Central WebSocket readyState:", ws.readyState);
    } else {
      console.warn("[MoodSelection] No central WebSocket instance found");
    }
  }, [socketId, ws]);

  const { data: moodStats = initialMoodStats, isLoading, isError } = useQuery<MoodStats>({
    queryKey: ['/api/moods/stats'],
    queryFn: async (): Promise<MoodStats> => {
      const response = await fetch(`${API_BASE_URL}/moods/stats`);
      if (!response.ok) {
        throw new Error('Failed to fetch mood statistics fix');
      }
      const data: MoodStats = await response.json();
      return data;
    },
    initialData: initialMoodStats,
    staleTime: 60000, // Data is fresh for 1 minute
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleMoodClick = (mood: Mood) => {
    setSelectedMood(mood);
  };

  const handleStartMatching = () => {
    if (selectedMood) {
      onMoodSelect(selectedMood);
    }
  };

  // Helper for human-readable WebSocket state
  const wsState = ws
    ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState] ?? "UNKNOWN"
    : "Not connected";

  return (
    <>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            How are you feeling today?
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Connect with someone who shares your current mood. Select your vibe and we&apos;ll find your perfect chat partner.
          </p>
        </div>

        {/* Central WebSocket debug info */}
        <div className="text-xs text-gray-400 text-center mb-4">
          Central Socket ID: <span className="font-mono">{socketId || "Not assigned"}</span>
          <br />
          WebSocket status: <span className="font-mono">{wsState}</span>
        </div>

        {isError && (
          <div className="text-center text-red-600 mb-4">
            Failed to load mood statistics.
          </div>
        )}

        {/* Mood Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
          {MOODS.map((mood) => (
            <div
              key={mood.id}
              className={`mood-card bg-white rounded-2xl p-6 cursor-pointer border-2 transition-all duration-300 hover:shadow-lg ${selectedMood === mood.id
                ? 'selected ring-2 ring-primary border-primary'
                : 'border-gray-100 hover:border-primary'
                }`}
              onClick={() => handleMoodClick(mood.id as Mood)}
            >
              <div className="text-center">
                <div className="text-4xl mb-3">{mood.emoji}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{mood.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{mood.description}</p>
                <div className="text-xs text-gray-500">
                  <span className="inline-flex items-center">
                    <div className="w-2 h-2 bg-success rounded-full mr-1"></div>
                    <span>
                      {moodStats?.[mood.id] ?? 0} active
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Button
            onClick={handleStartMatching}
            disabled={!selectedMood}
            className="bg-primary hover:bg-primary/90 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            size="lg"
          >
            <Video className="w-5 h-5 mr-2" />
            {selectedMood
              ? "Start Matching - " + (MOODS.find((m: typeof MOODS[number]) => m.id === selectedMood)?.name ?? "")
              : 'Select a mood to start chatting'
            }
          </Button>
        </div>
      </div>
    </>
  );
}