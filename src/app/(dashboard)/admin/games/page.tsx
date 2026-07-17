"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { 
  Trophy, 
  Settings, 
  Activity, 
  Plus, 
  Calendar, 
  Users, 
  Clock, 
  Lock, 
  Unlock,
  Eye,
  Search,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { formatDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TournamentStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
type Difficulty = "EASY" | "MEDIUM" | "HARD";

interface Tournament {
  id: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  competitionStart: string | null;
  competitionEnd: string | null;
  maxPlayers: number;
  grade: number | null;
  subject: string | null;
  difficulty: Difficulty | null;
  createdAt: string;
  _count: { rounds: number };
}

interface GameConfig {
  id: string;
  maxPlayersPerRoom: number;
  timePerQuestion: number;
  defaultDifficulty: Difficulty;
  difficultyLocked: boolean;
  minPlayersToStart: number;
}

interface ActiveRoom {
  id: string;
  roomCode: string;
  status: "WAITING" | "ACTIVE";
  host: { name: string };
  _count: { players: number };
  tournamentRound?: {
    tournament: { name: string };
  };
}

// ─── Tournaments Tab ─────────────────────────────────────────────────────────

function TournamentsTab() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("MEDIUM");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchTournaments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tournaments");
      if (res.ok) {
        const data = await res.json();
        setTournaments(data.tournaments);
      }
    } catch {
      toast.error("Failed to load tournaments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name is required");
    
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: desc,
          grade,
          subject,
          difficulty,
          competitionStart: start || null,
          competitionEnd: end || null
        })
      });

      if (res.ok) {
        toast.success("Tournament created successfully");
        setShowCreate(false);
        fetchTournaments();
        // Reset form
        setName(""); setDesc(""); setGrade(""); setSubject(""); setStart(""); setEnd("");
      } else {
        const d = await res.json();
        toast.error(d.error || "Failed to create tournament");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">All Tournaments</h2>
        <Button onClick={() => setShowCreate(!showCreate)} className="gap-2">
          {showCreate ? "Cancel" : <><Plus className="h-4 w-4" /> Create Tournament</>}
        </Button>
      </div>

      {showCreate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input label="Tournament Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mid-Term Challenge 2026" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-secondary">Description</label>
                <textarea 
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none" 
                  rows={2} 
                  value={desc} 
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <Input label="Grade" type="number" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="9-12" />
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Physics" />
              
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-secondary">Difficulty</label>
                <select 
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>

              <div className="sm:col-span-1">
                <Input label="Start Date" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="sm:col-span-1">
                <Input label="End Date" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" isLoading={submitting} className="w-full">Create Tournament</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : tournaments.length === 0 ? (
        <Card className="border-dashed py-12 text-center">
          <p className="text-text-secondary">No tournaments created yet.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <Card key={t.id} className="group hover:shadow-md transition-all">
              <CardContent className="pt-6">
                <div className="flex justify-between items-start mb-4">
                  <Badge variant={t.status === "ACTIVE" ? "success" : t.status === "SCHEDULED" ? "info" : "default"}>
                    {t.status}
                  </Badge>
                  <span className="text-xs text-text-secondary">
                    {t._count.rounds} rounds
                  </span>
                </div>
                <h3 className="font-bold text-text-primary group-hover:text-primary transition-colors">{t.name}</h3>
                <p className="text-xs text-text-secondary mt-1 line-clamp-1">{t.description || "No description"}</p>
                
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <Calendar className="h-3.5 w-3.5" />
                    {t.competitionStart ? formatDate(t.competitionStart) : "No start date"}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <Users className="h-3.5 w-3.5" />
                    Grade {t.grade || "All"} &middot; {t.subject || "All Subjects"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ───────────────────────────────────────────────────────────

function SettingsTab() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/games/config")
      .then(res => res.json())
      .then(data => {
        setConfig(data.config);
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/games/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (res.ok) toast.success("Settings updated");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!config) return <div className="text-center py-12">Failed to load config.</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Global Game Configuration</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Max Players per Room</label>
              <input 
                type="number" 
                className="w-full rounded-lg border border-border bg-surface px-4 py-2"
                value={config.maxPlayersPerRoom}
                onChange={e => setConfig({...config, maxPlayersPerRoom: parseInt(e.target.value)})}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Time per Question (sec)</label>
              <input 
                type="number" 
                className="w-full rounded-lg border border-border bg-surface px-4 py-2"
                value={config.timePerQuestion}
                onChange={e => setConfig({...config, timePerQuestion: parseInt(e.target.value)})}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Default Difficulty</label>
              <select 
                className="w-full rounded-lg border border-border bg-surface px-4 py-2"
                value={config.defaultDifficulty}
                onChange={e => setConfig({...config, defaultDifficulty: e.target.value as Difficulty})}
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Min Players to Start</label>
              <input 
                type="number" 
                className="w-full rounded-lg border border-border bg-surface px-4 py-2"
                value={config.minPlayersToStart}
                onChange={e => setConfig({...config, minPlayersToStart: parseInt(e.target.value)})}
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-border">
            <div className="flex items-center gap-3">
              {config.difficultyLocked ? <Lock className="h-5 w-5 text-orange-500" /> : <Unlock className="h-5 w-5 text-green-500" />}
              <div>
                <p className="text-sm font-bold">Difficulty Lock</p>
                <p className="text-xs text-text-secondary">Students cannot change difficulty in custom rooms.</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setConfig({...config, difficultyLocked: !config.difficultyLocked})}
            >
              {config.difficultyLocked ? "Unlock" : "Lock"}
            </Button>
          </div>

          <Button className="w-full h-12 text-lg font-bold" onClick={handleSave} isLoading={saving}>
            Save All Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Monitoring Tab ──────────────────────────────────────────────────────────

function MonitoringTab() {
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/games/rooms");
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const inv = setInterval(fetchRooms, 15000);
    return () => clearInterval(inv);
  }, [fetchRooms]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Live Game Monitoring</h2>
        <Badge variant="success" className="animate-pulse flex gap-1.5 items-center">
          <Activity className="h-3 w-3" /> LIVE
        </Badge>
      </div>

      {rooms.length === 0 ? (
        <Card className="border-dashed py-16 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-text-secondary/30 mb-4" />
          <p className="text-lg font-medium">No active games right now</p>
          <p className="text-sm text-text-secondary">Wait for students to start playing.</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border">
              <tr className="text-left font-semibold text-text-secondary">
                <th className="px-6 py-4">Room Code</th>
                <th className="px-6 py-4">Context</th>
                <th className="px-6 py-4">Players</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rooms.map(room => (
                <tr key={room.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className="font-mono text-lg font-black tracking-widest text-primary">{room.roomCode}</span>
                  </td>
                  <td className="px-6 py-4">
                    {room.tournamentRound ? (
                      <div className="flex items-center gap-1.5">
                        <Trophy className="h-3.5 w-3.5 text-yellow-600" />
                        <span className="font-medium text-yellow-700">{room.tournamentRound.tournament.name}</span>
                      </div>
                    ) : (
                      <span className="text-text-secondary italic">Custom Game</span>
                    )}
                    <p className="text-[10px] text-text-muted mt-1 uppercase">Host: {room.host.name}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                       <div className="flex -space-x-2">
                         {[1,2,3].slice(0, room._count.players).map(i => (
                           <div key={i} className="h-6 w-6 rounded-full bg-gray-200 border-2 border-white shadow-sm" />
                         ))}
                       </div>
                       <span className="font-bold">{room._count.players}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={room.status === "ACTIVE" ? "success" : "warning"}>
                      {room.status === "ACTIVE" ? "Playing" : "Waiting"}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="outline" size="sm" className="gap-1.5 group">
                      <Eye className="h-3.5 w-3.5" /> Spectate
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminGamesPage() {
  const t = useTranslations("admin");
  const [activeTab, setActiveTab] = useState<"tournaments" | "settings" | "monitoring">("tournaments");

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text-primary">{t("gamesTitle")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("analyticsSubtitle")}</p>
        </div>

        {/* Tabs Navigation */}
        <div className="flex gap-1 bg-gray-100/50 p-1 rounded-xl mb-8 w-fit">
          <TabButton active={activeTab === "tournaments"} onClick={() => setActiveTab("tournaments")} icon={Trophy} label={t("tournamentsTab")} />
          <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} icon={Settings} label={t("gameConfigTab")} />
          <TabButton active={activeTab === "monitoring"} onClick={() => setActiveTab("monitoring")} icon={Activity} label={t("activeRoomsTab")} />
        </div>

        {/* Tab Content */}
        {activeTab === "tournaments" && <TournamentsTab />}
        {activeTab === "settings" && <SettingsTab />}
        {activeTab === "monitoring" && <MonitoringTab />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        px-6 py-2.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-all
        ${active ? "bg-white text-primary shadow-sm ring-1 ring-black/5" : "text-text-secondary hover:text-text-primary hover:bg-white/50"}
      `}
    >
      <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-text-secondary"}`} />
      {label}
    </button>
  );
}
