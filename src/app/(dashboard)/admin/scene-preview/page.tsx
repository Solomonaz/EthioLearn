"use client";

/**
 * Dev preview for the video tutorial player (super-admin only).
 *
 * Renders a fixed sample script that exercises every visual template, so the
 * templates' motion can be checked without paying for a generation. Not part of
 * the student experience; safe to delete.
 */

import VideoTutorialPlayer, { type VideoScript } from "@/components/student/video-tutorial-player";

const SAMPLE: VideoScript = {
  title: "Motion in One Dimension",
  estimatedMinutes: 4,
  slides: [
    {
      heading: "How an object speeds up",
      narration: "Acceleration is how quickly velocity changes. Follow the chain from a push to a change in speed.",
      keyPoints: ["A force acts on the object", "Its velocity changes", "That change is acceleration"],
      teacherEmotion: "explaining",
      visualType: "process",
      visualData: { steps: ["Force applied", "Velocity changes", "Acceleration"] },
    },
    {
      heading: "The acceleration formula",
      narration: "Average acceleration equals the change in velocity divided by the time taken.",
      keyPoints: ["Change in velocity over time", "Measured in metres per second squared"],
      teacherEmotion: "writing",
      visualType: "formula",
      visualData: { text: "a = Δv / Δt", subtext: "Average acceleration, in m/s²" },
    },
    {
      heading: "Speed versus velocity",
      narration: "Speed tells you how fast. Velocity tells you how fast and in which direction.",
      keyPoints: ["Speed is scalar", "Velocity is a vector"],
      teacherEmotion: "pointing",
      visualType: "comparison",
      visualData: {
        leftLabel: "Speed",
        leftItems: ["Scalar quantity", "Magnitude only", "Never negative"],
        rightLabel: "Velocity",
        rightItems: ["Vector quantity", "Has direction", "Can be negative"],
      },
    },
    {
      heading: "Solving a problem",
      narration: "Work through a kinematics problem in four ordered steps.",
      keyPoints: ["List what you know", "Choose the equation", "Substitute", "Check units"],
      teacherEmotion: "thinking",
      visualType: "list",
      visualData: {},
    },
    {
      heading: "From rest to motion",
      narration: "A car starting from rest reaches twenty metres per second in six seconds.",
      keyPoints: ["Starts at rest", "Reaches 20 m/s", "Takes 6 seconds"],
      teacherEmotion: "excited",
      visualType: "timeline",
      visualData: {
        events: [
          { period: "t = 0 s", event: "Car at rest, v = 0" },
          { period: "t = 3 s", event: "Halfway, v ≈ 10 m/s" },
          { period: "t = 6 s", event: "Reaches v = 20 m/s" },
        ],
      },
    },
    {
      heading: "How the quantities connect",
      narration: "Displacement, velocity and acceleration are linked in that order.",
      keyPoints: ["Each is the rate of change of the one before it"],
      teacherEmotion: "explaining",
      visualType: "diagram",
      visualData: { steps: ["Displacement", "Velocity", "Acceleration"] },
    },
    {
      heading: "The key idea",
      narration: "Acceleration is the rate of change of velocity.",
      keyPoints: ["Remember this above all"],
      teacherEmotion: "excited",
      visualType: "highlight",
      visualData: { text: "3.67 m/s²", subtext: "The car's average acceleration" },
    },
  ],
};

export default function VideoPreviewPage() {
  return (
    <div className="min-h-screen bg-slate-950 p-4">
      <div className="h-[calc(100vh-4rem)]">
        <VideoTutorialPlayer
          script={SAMPLE}
          subject="Physics"
          chapterTitle="Motion in one and two dimensions"
          onClose={() => {}}
        />
      </div>
    </div>
  );
}
