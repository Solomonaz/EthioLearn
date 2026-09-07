"use client";

/**
 * The Tug of War stage — a flat, illustrated scene on a plain white field.
 *
 * Both teams grip ONE rope; a red marker sits at the rope's centre. As a team
 * wins pulls, the whole formation (both teams + rope) SLIDES toward the winning
 * side, dragging the losing team over the centre line — so the players actually
 * move during win and lose. The pulling side strains harder for a beat.
 *
 * The players wear habesha dress: cream cotton tunic and trousers with a wide
 * tibeb band at the hem, cuffs and across the chest. The tibeb carries the team
 * colour (red / blue), which is what tells the two sides apart.
 *
 * Everything is derived from props so the game component owns all state.
 * `offset` is in pull steps (+ = team 1/left leading).
 */

export interface TugSceneProps {
  /** Net pull steps; positive favours team 1 (left). */
  offset: number;
  /** Steps to a knockout (defines how far the formation can slide). */
  target: number;
  /** Team that just pulled — strains harder for emphasis. */
  pullingTeam: 1 | 2 | null;
  superPull?: boolean;
  /** 1 / 2 winner, 0 draw, null in-play. */
  winner?: 1 | 2 | 0 | null;
}

// Team tibeb (the embroidered band) — team 1 red, team 2 blue, matching the
// answer cards.
const RED = { tibeb: "#d92d2d", dark: "#a01c1c" };
const BLUE = { tibeb: "#2f6bef", dark: "#1e49b8" };

const CLOTH = "#FBF7EE"; // habesha cotton
const CLOTH_LINE = "#C9BCA3"; // outline so the white cloth reads on white
const CLOTH_SHADE = "#EDE5D6";
const GOLD = "#E3B23C"; // gold thread in the tibeb
const HAIR = "#241A14";
const SANDAL = "#6B4A2F";
const SANDAL_DARK = "#4A3220";
const SKINS = ["#9C6239", "#7E4E2C", "#B87A4A"];

const GROUND = 335;
const ROPE_Y = 253; // chest height — where every hand grips
const MAX_SHIFT = 52; // px the formation slides at a full knockout

// Team member base positions (before the whole rig slides).
const TEAM1_X = [306, 368, 430];
const TEAM2_X = [570, 632, 694];

/**
 * One player, drawn facing right (toward the rope) with feet on y = 0; the
 * caller mirrors the whole figure for the other team.
 *
 * The pose is a real tug stance, not a walk: the body is thrown back about 30°
 * off vertical, hips driven forward under the rope, front leg bent and braced,
 * back leg extended and digging in, arms locked straight onto the rope at chest
 * height, head back and mouth open with the strain.
 */
function Player({
  x,
  facing: f,
  team,
  skin,
  lean,
}: {
  x: number;
  facing: 1 | -1;
  team: { tibeb: string; dark: string };
  skin: string;
  lean: number;
}) {
  // Extra backward tilt on the beat (negative = top swings away from the rope).
  const rot = -lean * 0.35;

  return (
    <g transform={`translate(${x} ${GROUND})`}>
      {/* ground shadow — stays flat, outside the strain tilt */}
      <ellipse cx={-14} cy={2} rx={46} ry={5.5} fill="#0f172a" opacity={0.08} />

      <g transform={`scale(${f} 1)`}>
        <g
          style={{
            transform: `rotate(${rot}deg)`,
            transformOrigin: "0px -45px",
            transition: "transform 220ms ease-out",
          }}
        >
          {/* ── Back leg — extended behind, digging in ── */}
          <polyline
            points="-14,-52 -38,-28 -60,-8"
            fill="none"
            stroke={CLOTH_LINE}
            strokeWidth={17.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="-14,-52 -38,-28 -60,-8"
            fill="none"
            stroke={CLOTH_SHADE}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline points="-53,-15 -60,-8" fill="none" stroke={team.tibeb} strokeWidth={14} strokeLinecap="butt" />
          <path d="M -68,-9 L -46,-6 Q -41,-4 -46,-1 L -68,-1 Z" fill={SANDAL} />
          <path d="M -68,-3 L -46,-3 Q -42,-2.5 -46,-1 L -68,-1 Z" fill={SANDAL_DARK} />

          {/* ── Back arm — behind the torso, locked straight on the rope ── */}
          <polyline points="-42,-104 -6,-97" fill="none" stroke={CLOTH_LINE} strokeWidth={14.5} strokeLinecap="round" />
          <polyline points="-42,-104 -6,-97" fill="none" stroke={CLOTH_SHADE} strokeWidth={11.5} strokeLinecap="round" />
          <polyline points="-11,-98 -6,-97" fill="none" stroke={team.dark} strokeWidth={11.5} strokeLinecap="butt" />
          <polyline points="-6,-97 30,-84" fill="none" stroke={skin} strokeWidth={8.5} strokeLinecap="round" />
          <circle cx={31} cy={-84} r={5.8} fill={skin} />

          {/* ── Front leg — bent and braced, taking the load ── */}
          <polyline
            points="4,-58 22,-34 36,-10"
            fill="none"
            stroke={CLOTH_LINE}
            strokeWidth={18.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="4,-58 22,-34 36,-10"
            fill="none"
            stroke={CLOTH}
            strokeWidth={15}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline points="29,-17 36,-10" fill="none" stroke={team.tibeb} strokeWidth={15} strokeLinecap="butt" />
          <path d="M 28,-11 L 50,-8 Q 55,-6 50,-2 L 28,-2 Z" fill={SANDAL} />
          <path d="M 28,-4 L 50,-4 Q 54,-3 50,-2 L 28,-2 Z" fill={SANDAL_DARK} />

          {/* ── Tunic — thrown back off the hips ── */}
          <path
            d="M -18.3,-116.2 C -6,-108 8,-88 14.3,-67.8 L 20.6,-61.1 L -15.4,-39.5 L -18.3,-48.2 C -30,-66 -40,-84 -45.7,-99.8 C -49,-110.5 -32,-121 -18.3,-116.2 Z"
            fill={CLOTH}
            stroke={CLOTH_LINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* strain folds running with the lean */}
          <path d="M -30,-108 C -24,-92 -14,-70 -4,-52" fill="none" stroke={CLOTH_SHADE} strokeWidth={2.5} />
          {/* tibeb hem band */}
          <path d="M 20.6,-61.1 L -15.4,-39.5 L -20.6,-48.1 L 15.5,-69.7 Z" fill={team.tibeb} />
          <line x1={18} y1={-65.4} x2={-18} y2={-43.8} stroke={GOLD} strokeWidth={2.5} opacity={0.9} />

          {/* ── Netela sash across the chest, in the team's tibeb ── */}
          <path d="M -35.4,-113.3 L -44.6,-102.7 L 5.4,-58.7 L 14.6,-69.3 Z" fill={team.tibeb} />
          <line x1={-40} y1={-108} x2={10} y2={-64} stroke={GOLD} strokeWidth={2.5} opacity={0.9} />

          {/* ── Front arm — over the torso, both hands on the rope ── */}
          <polyline points="-30,-112 0,-96" fill="none" stroke={CLOTH_LINE} strokeWidth={16} strokeLinecap="round" />
          <polyline points="-30,-112 0,-96" fill="none" stroke={CLOTH} strokeWidth={13} strokeLinecap="round" />
          <polyline points="-5,-99 0,-96" fill="none" stroke={team.tibeb} strokeWidth={13} strokeLinecap="butt" />
          <polyline points="0,-96 39,-82" fill="none" stroke={skin} strokeWidth={9} strokeLinecap="round" />
          <circle cx={40} cy={-82} r={6.5} fill={skin} />

          {/* ── Neck, head, face — head back, chin up, jaw clenched ── */}
          <polyline points="-36,-110 -44,-119" fill="none" stroke={skin} strokeWidth={11} strokeLinecap="round" />
          {/* hair sits behind the face, leaving a dark rim = short natural hair */}
          <ellipse cx={-53} cy={-130} rx={13.5} ry={14.5} fill={HAIR} />
          <circle cx={-62} cy={-135} r={4.2} fill={HAIR} />
          <circle cx={-55} cy={-141} r={4.6} fill={HAIR} />
          <circle cx={-47} cy={-142} r={4.2} fill={HAIR} />
          <ellipse cx={-49} cy={-127} rx={11.5} ry={13} fill={skin} />
          {/* ear */}
          <ellipse cx={-59.5} cy={-125} rx={3.4} ry={4.2} fill={skin} />
          {/* nose */}
          <path d="M -38.5,-129 L -34,-125.5 L -38.5,-123 Z" fill={skin} />
          {/* strained brow + eye */}
          <path d="M -47.5,-135.5 L -40,-133.5" fill="none" stroke={HAIR} strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={-43} cy={-130} r={1.9} fill="#27272a" />
          {/* open, straining mouth */}
          <ellipse cx={-41} cy={-119.5} rx={3.4} ry={2.4} fill="#5b2a2a" />
          <path d="M -44.1,-120.3 L -37.9,-120.3" fill="none" stroke="#fff" strokeWidth={1.4} />
          {/* headband in the team's tibeb */}
          <path
            d="M -64,-133 A 13.5 14.5 0 0 1 -42,-139.5 L -44,-135 A 11 11 0 0 0 -62.5,-129 Z"
            fill={team.tibeb}
          />
          {/* sweat — the strain */}
          <ellipse cx={-33} cy={-138} rx={1.7} ry={2.6} fill="#7dd3fc" opacity={0.85} />
          <ellipse cx={-29} cy={-131} rx={1.4} ry={2.2} fill="#7dd3fc" opacity={0.7} />
        </g>
      </g>
    </g>
  );
}

export function TugScene({ offset, target, pullingTeam, winner }: TugSceneProps) {
  const clamped = Math.max(-target, Math.min(target, offset));
  // Positive offset = team 1 winning → the whole rig slides LEFT, pulling team 2 over the line.
  const shift = -(clamped / target) * MAX_SHIFT;

  const leanOf = (team: 1 | 2) => (pullingTeam === team ? 18 : 8);

  return (
    <svg
      viewBox="180 160 640 195"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="Tug of war"
    >
      {/* plain white field — the centre line runs the full height of the panel */}
      <line x1="500" y1="-2000" x2="500" y2="2000" stroke="#cbd5e1" strokeWidth="3" strokeDasharray="9 9" />

      {/* the sliding formation: rope + both teams move together */}
      <g style={{ transform: `translateX(${shift}px)`, transition: "transform 420ms cubic-bezier(.4,1.1,.6,1)" }}>
        {/* rope */}
        <line x1={272} y1={ROPE_Y} x2={728} y2={ROPE_Y} stroke="#a9741f" strokeWidth="7" strokeLinecap="round" />
        <line
          x1={272}
          y1={ROPE_Y}
          x2={728}
          y2={ROPE_Y}
          stroke="#caa053"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="2 10"
        />
        {/* red centre marker */}
        <g transform={`translate(500 ${ROPE_Y})`}>
          <line x1="0" y1="-2" x2="0" y2="34" stroke="#dc2626" strokeWidth="3" />
          <path d="M 0 -2 L 22 5 L 0 12 Z" fill="#dc2626" />
          <circle cx="0" cy={0} r="5" fill="#b91c1c" />
        </g>

        {/* teams — all gripping the rope */}
        {TEAM1_X.map((x, i) => (
          <Player key={`a${i}`} x={x} facing={1} team={RED} skin={SKINS[i % 3]} lean={leanOf(1)} />
        ))}
        {TEAM2_X.map((x, i) => (
          <Player key={`b${i}`} x={x} facing={-1} team={BLUE} skin={SKINS[(i + 1) % 3]} lean={leanOf(2)} />
        ))}
      </g>

      {/* winner badge */}
      {(winner === 1 || winner === 2) && (
        <text x={winner === 1 ? 330 : 670} y="205" textAnchor="middle" fontSize="40">
          🏆
        </text>
      )}
    </svg>
  );
}
