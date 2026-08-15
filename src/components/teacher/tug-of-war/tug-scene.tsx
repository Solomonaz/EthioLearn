"use client";

/**
 * The Tug of War stage — a bright, flat cartoon scene (no neon, no filters).
 *
 * Both teams grip ONE rope; a red marker sits at the rope's centre. As a team
 * wins pulls, the whole formation (both teams + rope) SLIDES toward the winning
 * side, dragging the losing team over the centre line — so the kids actually
 * move during win and lose. The pulling side leans back harder for a beat.
 *
 * Everything is derived from props so the game component owns all state.
 * `offset` is in pull steps (+ = team 1/left leading).
 */

export interface TugSceneProps {
  /** Net pull steps; positive favours team 1 (left). */
  offset: number;
  /** Steps to a knockout (defines how far the formation can slide). */
  target: number;
  team1Name: string;
  team2Name: string;
  /** Team that just pulled — leans back for emphasis. */
  pullingTeam: 1 | 2 | null;
  superPull?: boolean;
  /** 1 / 2 winner, 0 draw, null in-play. */
  winner?: 1 | 2 | 0 | null;
}

// Team palettes (kept in sync with the answer panels: team 1 red, team 2 blue).
const RED = { jersey: "#ef4444", dark: "#b91c1c", cap: "#991b1b", pants: "#3f3f46" };
const BLUE = { jersey: "#3b82f6", dark: "#1d4ed8", cap: "#1e3a8a", pants: "#3f3f46" };
const SKINS = ["#f4c9a3", "#e6b088", "#cf9464"];

const GROUND = 335;
const ROPE_Y = 232;
const MAX_SHIFT = 120; // px the formation slides at a full knockout

// Team member base positions (before the whole rig slides).
const TEAM1_X = [170, 250, 330];
const TEAM2_X = [670, 750, 830];

function Kid({
  x,
  facing,
  c,
  skin,
  lean,
}: {
  x: number;
  facing: 1 | -1;
  c: typeof RED;
  skin: string;
  lean: number; // degrees leaned back (away from rope)
}) {
  const rot = -facing * lean;
  const gripFar = facing * 38;
  const gripNear = facing * 24;
  return (
    <g transform={`translate(${x} ${GROUND})`}>
      <g
        style={{ transform: `rotate(${rot}deg)`, transformOrigin: "0px 0px", transition: "transform 200ms ease-out" }}
      >
        {/* back leg (braced) + front leg */}
        <line x1="0" y1="-52" x2={-facing * 16} y2="0" stroke={c.pants} strokeWidth="9" strokeLinecap="round" />
        <line x1="0" y1="-52" x2={facing * 8} y2="0" stroke={c.pants} strokeWidth="9" strokeLinecap="round" />
        {/* shoes */}
        <ellipse cx={-facing * 16} cy="0" rx="7" ry="4" fill="#27272a" />
        <ellipse cx={facing * 8} cy="0" rx="7" ry="4" fill="#27272a" />
        {/* torso */}
        <rect x="-13" y="-96" width="26" height="46" rx="9" fill={c.jersey} />
        <rect x="-13" y="-70" width="26" height="8" fill={c.dark} opacity="0.6" />
        {/* both arms gripping the rope */}
        <line x1="0" y1="-90" x2={gripFar} y2={ROPE_Y - GROUND} stroke={c.dark} strokeWidth="7" strokeLinecap="round" />
        <line x1="0" y1="-86" x2={gripNear} y2={ROPE_Y - GROUND} stroke={c.jersey} strokeWidth="7" strokeLinecap="round" />
        <circle cx={gripFar} cy={ROPE_Y - GROUND} r="4.5" fill={skin} />
        <circle cx={gripNear} cy={ROPE_Y - GROUND} r="4.5" fill={skin} />
        {/* head + cap + face */}
        <circle cx="0" cy="-112" r="13" fill={skin} />
        <path d="M -13 -114 A 13 13 0 0 1 13 -114 Z" fill={c.cap} />
        <rect x="-14" y="-115" width="28" height="4" rx="2" fill={c.cap} />
        <circle cx={facing * 4} cy="-110" r="1.7" fill="#27272a" />
        <path d={`M ${facing * 1} -103 q ${facing * 4} 3 ${facing * 7} 0`} stroke="#27272a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}

export function TugScene({
  offset,
  target,
  team1Name,
  team2Name,
  pullingTeam,
  winner,
}: TugSceneProps) {
  const clamped = Math.max(-target, Math.min(target, offset));
  // Positive offset = team 1 winning → the whole rig slides LEFT, pulling team 2 over the line.
  const shift = -(clamped / target) * MAX_SHIFT;

  const leanOf = (team: 1 | 2) => (pullingTeam === team ? 17 : 7);

  const ropeStart = TEAM1_X[0] - 24;
  const ropeEnd = TEAM2_X[2] + 24;

  return (
    <svg viewBox="0 0 1000 380" className="h-full w-full" role="img" aria-label="Tug of war">
      {/* bright sky + grass */}
      <rect x="0" y="0" width="1000" height="380" fill="#e3f4ff" />
      <rect x="0" y="315" width="1000" height="65" fill="#bfe6a0" />
      <rect x="0" y="315" width="1000" height="5" fill="#a6d885" />

      {/* fixed centre line */}
      <line x1="500" y1="70" x2="500" y2="330" stroke="#94a3b8" strokeWidth="3" strokeDasharray="9 9" />

      {/* team name plates */}
      <g fontFamily="system-ui, sans-serif" fontWeight="700">
        <rect x="30" y="26" rx="14" width="220" height="42" fill={RED.jersey} />
        <text x="140" y="54" textAnchor="middle" fontSize="21" fill="#fff">{team1Name}</text>
        <rect x="750" y="26" rx="14" width="220" height="42" fill={BLUE.jersey} />
        <text x="860" y="54" textAnchor="middle" fontSize="21" fill="#fff">{team2Name}</text>
      </g>

      {/* the sliding formation: rope + both teams move together */}
      <g style={{ transform: `translateX(${shift}px)`, transition: "transform 420ms cubic-bezier(.4,1.1,.6,1)" }}>
        {/* rope */}
        <line x1={ropeStart} y1={ROPE_Y} x2={ropeEnd} y2={ROPE_Y} stroke="#a9741f" strokeWidth="7" strokeLinecap="round" />
        <line x1={ropeStart} y1={ROPE_Y} x2={ropeEnd} y2={ROPE_Y} stroke="#caa053" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 10" />
        {/* red centre marker */}
        <g transform={`translate(500 ${ROPE_Y})`}>
          <line x1="0" y1="-2" x2="0" y2="34" stroke="#dc2626" strokeWidth="3" />
          <path d="M 0 -2 L 22 5 L 0 12 Z" fill="#dc2626" />
          <circle cx="0" cy={0} r="5" fill="#b91c1c" />
        </g>

        {/* teams — all gripping the rope */}
        {TEAM1_X.map((x, i) => (
          <Kid key={`a${i}`} x={x} facing={1} c={RED} skin={SKINS[i % 3]} lean={leanOf(1)} />
        ))}
        {TEAM2_X.map((x, i) => (
          <Kid key={`b${i}`} x={x} facing={-1} c={BLUE} skin={SKINS[i % 3]} lean={leanOf(2)} />
        ))}
      </g>

      {/* winner badge */}
      {(winner === 1 || winner === 2) && (
        <text x={winner === 1 ? 140 : 860} y="110" textAnchor="middle" fontSize="40">🏆</text>
      )}
    </svg>
  );
}
