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
// Both teams share navy shorts, red shoes and silver caps (per the reference).
const RED = { jersey: "#ef4444", dark: "#c81e1e" };
const BLUE = { jersey: "#2f6bef", dark: "#1e49b8" };
const NAVY = "#1f2b44"; // shorts + legs
const SHOE = "#e11d2f"; // shoes
const SOLE = "#7f0f1c";
const CAP = "#cbd2d8"; // silver caps
const CAP_DARK = "#9aa3ac";
const SKINS = ["#f4c9a3", "#e6b088", "#cf9464"];

const GROUND = 335;
const ROPE_Y = 253; // chest height of the players (below the shoulders)
const MAX_SHIFT = 120; // px the formation slides at a full knockout

// Team member base positions (before the whole rig slides).
const TEAM1_X = [170, 250, 330];
const TEAM2_X = [670, 750, 830];

/**
 * A flat-design tug-of-war player in a dynamic leaning-back lunge: front leg
 * planted toward the rope, back leg extended, torso leaning away, both arms
 * reaching forward to grip the rope. `facing` (+1/-1) points toward the rope, so
 * the figure mirrors for each side. `lean` adds a small extra pull on the beat.
 */
function Kid({
  x,
  facing: f,
  c,
  skin,
  lean,
}: {
  x: number;
  facing: 1 | -1;
  c: { jersey: string; dark: string };
  skin: string;
  lean: number;
}) {
  // Subtle body tilt on a pull (keeps the hands near the rope line).
  const rot = -f * lean * 0.4;

  // Key joints in local space (feet on the ground at y=0). The rope sits at
  // chest height — below the shoulders — so the arms reach forward/down to it.
  const gripY = ROPE_Y - GROUND; // ≈ -82 (chest level)
  const hip: [number, number] = [f * -14, -50];
  const sh: [number, number] = [f * -24, -90];
  const head: [number, number] = [f * -30, -105];
  const grip: [number, number] = [f * 44, gripY];
  const elbow: [number, number] = [f * 12, gripY - 3];

  const frontKnee: [number, number] = [f * 6, -28];
  const frontFoot: [number, number] = [f * 26, -4];
  const backKnee: [number, number] = [f * -32, -30];
  const backFoot: [number, number] = [f * -48, -4];

  const P = (p: [number, number]) => `${p[0]},${p[1]}`;

  return (
    <g transform={`translate(${x} ${GROUND})`}>
      {/* ground shadow (stays flat, outside the lean) */}
      <ellipse cx={f * -8} cy={3} rx={40} ry={5.5} fill="#000" opacity={0.09} />

      <g
        style={{
          transform: `rotate(${rot}deg)`,
          transformOrigin: "0px -30px",
          transition: "transform 220ms ease-out",
        }}
      >
        {/* ── Back leg (extended, braced) ── */}
        <polyline
          points={`${P(hip)} ${P(backKnee)} ${P(backFoot)}`}
          fill="none"
          stroke={NAVY}
          strokeWidth={13}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Back arm (behind torso), reaching to the rope */}
        <polyline
          points={`${f * -20},-86 ${elbow[0]},${elbow[1] + 3} ${grip[0]},${grip[1] + 2}`}
          fill="none"
          stroke={c.dark}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* ── Front leg (planted toward the rope) ── */}
        <polyline
          points={`${P(hip)} ${P(frontKnee)} ${P(frontFoot)}`}
          fill="none"
          stroke={NAVY}
          strokeWidth={13}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Shoes */}
        <g>
          <ellipse cx={backFoot[0] + f * 4} cy={backFoot[1] + 3} rx={11} ry={5} fill={SHOE} />
          <ellipse cx={backFoot[0] + f * 4} cy={backFoot[1] + 6} rx={11} ry={2.4} fill={SOLE} />
          <ellipse cx={frontFoot[0] + f * 5} cy={frontFoot[1] + 3} rx={11} ry={5} fill={SHOE} />
          <ellipse cx={frontFoot[0] + f * 5} cy={frontFoot[1] + 6} rx={11} ry={2.4} fill={SOLE} />
        </g>

        {/* shorts */}
        <ellipse cx={hip[0]} cy={hip[1] + 2} rx={12} ry={11} fill={NAVY} />

        {/* ── Torso (jersey) ── */}
        <polyline
          points={`${hip[0]},${hip[1] - 4} ${sh[0]},${sh[1]}`}
          fill="none"
          stroke={c.jersey}
          strokeWidth={27}
          strokeLinecap="round"
        />
        {/* subtle side-shade for depth */}
        <polyline
          points={`${hip[0] - f * 8},${hip[1] - 6} ${sh[0] - f * 8},${sh[1] + 2}`}
          fill="none"
          stroke={c.dark}
          strokeWidth={8}
          strokeLinecap="round"
          opacity={0.5}
        />

        {/* ── Front arm (over torso) reaching the rope ── */}
        <polyline
          points={`${P(sh)} ${P(elbow)}`}
          fill="none"
          stroke={c.jersey}
          strokeWidth={9.5}
          strokeLinecap="round"
        />
        <polyline
          points={`${P(elbow)} ${P(grip)}`}
          fill="none"
          stroke={skin}
          strokeWidth={7}
          strokeLinecap="round"
        />
        <circle cx={grip[0]} cy={grip[1]} r={5} fill={skin} />

        {/* ── Neck + head ── */}
        <line x1={sh[0]} y1={sh[1]} x2={head[0]} y2={head[1] + 8} stroke={skin} strokeWidth={7} strokeLinecap="round" />
        <circle cx={head[0]} cy={head[1]} r={12} fill={skin} />
        {/* eye, facing the rope */}
        <circle cx={head[0] + f * 5} cy={head[1] - 1} r={1.7} fill="#27272a" />

        {/* ── Cap (silver) ── */}
        <path
          d={`M ${head[0] - 12} ${head[1] - 4} A 12 12 0 0 1 ${head[0] + 12} ${head[1] - 4} Z`}
          fill={CAP}
        />
        <rect x={head[0] - 12} y={head[1] - 5} width={24} height={3.2} rx={1.6} fill={CAP_DARK} />
        {/* brim pointing toward the rope */}
        <ellipse cx={head[0] + f * 15} cy={head[1] - 3.5} rx={9} ry={3} fill={CAP_DARK} />
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
