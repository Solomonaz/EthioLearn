import type { Scene } from "./scene-schema";

/**
 * Hand-authored reference scenes.
 *
 * These exist to develop and demo the player without spending a single AI
 * token, and to serve as the quality bar a generated scene is judged against.
 *
 * They are deliberately NOT a runtime fallback. When a generation fails, the
 * API returns an error rather than playing one of these: a chemistry animation
 * shown for a history lesson would be worse than an honest failure.
 */

/**
 * Sulfur dioxide dissolving in water — SO₂ + H₂O → H₂SO₃ (sulfurous acid).
 *
 * Chemistry note, so the animation stays honest: the three oxygens in the
 * product are the two from SO₂ plus the one from water, and the two acidic
 * hydrogens both come from the water. Here `Oa` stays the double-bonded S=O,
 * water's oxygen `Ow` bonds to sulfur and keeps `H1`, and `H2` migrates onto
 * `Ob` — so the product is (HO)₂S=O, drawn with one S=O and two S–O–H.
 */
export const SO2_WATER_SCENE: Scene = {
  title: "Sulfur dioxide dissolves in water",
  actors: [
    { id: "S1", kind: "circle", text: "S", color: "yellow", size: 1.15 },
    { id: "Oa", kind: "circle", text: "O", color: "red" },
    { id: "Ob", kind: "circle", text: "O", color: "red" },
    { id: "Ow", kind: "circle", text: "O", color: "red" },
    { id: "H1", kind: "circle", text: "H", color: "white", size: 0.7 },
    { id: "H2", kind: "circle", text: "H", color: "white", size: 0.7 },
    { id: "lblSO2", kind: "label", text: "SO₂", color: "grey" },
    { id: "lblH2O", kind: "label", text: "H₂O", color: "grey" },
    { id: "lblPlus", kind: "label", text: "+", color: "grey", size: 1.6 },
    { id: "lblProd", kind: "label", text: "H₂SO₃  ·  sulfurous acid", color: "green" },
  ],
  links: [
    { id: "SOa", from: "S1", to: "Oa" },
    { id: "SOb", from: "S1", to: "Ob" },
    { id: "SOw", from: "S1", to: "Ow" },
    { id: "OwH1", from: "Ow", to: "H1" },
    { id: "OwH2", from: "Ow", to: "H2" },
    { id: "ObH2", from: "Ob", to: "H2" },
  ],
  steps: [
    {
      caption: "Two molecules meet: sulfur dioxide and water.",
      narration:
        "Here are two molecules. On the left, sulfur dioxide. On the right, water.",
      durationMs: 2600,
      place: {
        S1: { x: 31, y: 49 }, Oa: { x: 21, y: 38 }, Ob: { x: 21, y: 60 },
        Ow: { x: 70, y: 49 }, H1: { x: 78, y: 39 }, H2: { x: 78, y: 59 },
        lblSO2: { x: 23, y: 78 }, lblH2O: { x: 74, y: 78 }, lblPlus: { x: 50, y: 49 },
        lblProd: { x: 49, y: 92, opacity: 0 },
      },
      links: { SOa: 2, SOb: 2, SOw: 0, OwH1: 1, OwH2: 1, ObH2: 0 },
    },
    {
      caption: "Sulfur dioxide is bent — one sulfur double-bonded to two oxygens.",
      narration:
        "Sulfur dioxide is a bent molecule. The sulfur atom is double bonded to each of its two oxygens.",
      durationMs: 2500,
      place: { Ow: { opacity: 0.28 }, H1: { opacity: 0.28 }, H2: { opacity: 0.28 },
        lblH2O: { opacity: 0.2 }, lblPlus: { opacity: 0.35 } },
    },
    {
      caption: "Water's oxygen carries lone pairs — electrons that attack the sulfur.",
      narration:
        "Now look at water. Its oxygen holds lone pairs of electrons, and those electrons are what attack the sulfur.",
      durationMs: 2500,
      place: {
        Ow: { opacity: 1 }, H1: { opacity: 1 }, H2: { opacity: 1 }, lblH2O: { opacity: 1 },
        S1: { opacity: 0.4 }, Oa: { opacity: 0.4 }, Ob: { opacity: 0.4 }, lblSO2: { opacity: 0.25 },
      },
    },
    {
      caption: "The water oxygen moves in and bonds to sulfur — a new S–O bond forms.",
      narration:
        "The water oxygen moves in and bonds to the sulfur. A new sulfur oxygen bond forms.",
      durationMs: 3000,
      place: {
        S1: { x: 34, y: 50, opacity: 1 }, Oa: { x: 24, y: 39, opacity: 1 }, Ob: { x: 24, y: 61, opacity: 1 },
        Ow: { x: 49, y: 52 }, H1: { x: 57, y: 42 }, H2: { x: 57, y: 66 },
        lblSO2: { x: 26, y: 79, opacity: 0.4 }, lblH2O: { x: 57, y: 80, opacity: 0.4 },
        lblPlus: { opacity: 0 },
      },
      links: { SOw: 1 },
    },
    {
      caption: "A hydrogen jumps across to a neighbouring oxygen — a proton transfer.",
      narration:
        "Then a hydrogen jumps across to a neighbouring oxygen. Chemists call this a proton transfer.",
      durationMs: 3000,
      place: {
        S1: { x: 38, y: 52 }, Oa: { x: 38, y: 32 }, Ob: { x: 27, y: 67 },
        Ow: { x: 49, y: 63 }, H1: { x: 57, y: 57 }, H2: { x: 19, y: 77 },
        lblSO2: { opacity: 0 }, lblH2O: { opacity: 0 },
      },
      links: { SOb: 1, OwH2: 0, ObH2: 1 },
    },
    {
      caption: "The product is sulfurous acid, H₂SO₃ — a weak acid, and a cause of acid rain.",
      narration:
        "The product is sulfurous acid. It is a weak acid, and it is one of the causes of acid rain.",
      durationMs: 3200,
      place: {
        S1: { x: 49, y: 54 }, Oa: { x: 49, y: 32 },
        Ob: { x: 37, y: 70 }, H2: { x: 30, y: 80 },
        Ow: { x: 62, y: 70 }, H1: { x: 69, y: 80 },
        lblProd: { x: 49, y: 93, opacity: 1 },
      },
    },
  ],
};
