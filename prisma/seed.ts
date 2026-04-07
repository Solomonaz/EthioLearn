import { PrismaClient, Difficulty, QuestionType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

interface QuestionSeed {
  questionText: string;
  options: { label: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  difficulty: Difficulty;
}

// ─── Biology Questions ──────────────────────────────────────────

const cellBiologyQuestions: QuestionSeed[] = [
  {
    questionText: "What is the basic structural and functional unit of all living organisms?",
    options: [
      { label: "A", text: "Tissue" },
      { label: "B", text: "Organ" },
      { label: "C", text: "Cell" },
      { label: "D", text: "Molecule" },
    ],
    correctAnswer: "C",
    explanation: "The cell is the basic structural and functional unit of life. All living organisms are composed of one or more cells.",
    difficulty: "EASY",
  },
  {
    questionText: "Which organelle is known as the 'powerhouse of the cell'?",
    options: [
      { label: "A", text: "Ribosome" },
      { label: "B", text: "Mitochondria" },
      { label: "C", text: "Golgi apparatus" },
      { label: "D", text: "Endoplasmic reticulum" },
    ],
    correctAnswer: "B",
    explanation: "Mitochondria generate most of the cell's supply of ATP through oxidative phosphorylation, earning the nickname 'powerhouse of the cell'.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the function of the cell membrane?",
    options: [
      { label: "A", text: "Protein synthesis" },
      { label: "B", text: "Energy production" },
      { label: "C", text: "Regulating what enters and exits the cell" },
      { label: "D", text: "Storing genetic information" },
    ],
    correctAnswer: "C",
    explanation: "The cell membrane is a selectively permeable barrier that controls the movement of substances in and out of the cell.",
    difficulty: "EASY",
  },
  {
    questionText: "Which structure is found in plant cells but not in animal cells?",
    options: [
      { label: "A", text: "Nucleus" },
      { label: "B", text: "Cell wall" },
      { label: "C", text: "Mitochondria" },
      { label: "D", text: "Ribosomes" },
    ],
    correctAnswer: "B",
    explanation: "Plant cells have a rigid cell wall made of cellulose outside the cell membrane, which animal cells lack.",
    difficulty: "EASY",
  },
  {
    questionText: "During which phase of mitosis do chromosomes line up at the cell's equator?",
    options: [
      { label: "A", text: "Prophase" },
      { label: "B", text: "Metaphase" },
      { label: "C", text: "Anaphase" },
      { label: "D", text: "Telophase" },
    ],
    correctAnswer: "B",
    explanation: "During metaphase, chromosomes align along the metaphase plate (cell equator) before being separated.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the primary function of ribosomes?",
    options: [
      { label: "A", text: "DNA replication" },
      { label: "B", text: "Lipid synthesis" },
      { label: "C", text: "Protein synthesis" },
      { label: "D", text: "Cell division" },
    ],
    correctAnswer: "C",
    explanation: "Ribosomes are the cellular structures responsible for translating mRNA into proteins during translation.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which type of transport requires energy to move substances across a cell membrane?",
    options: [
      { label: "A", text: "Osmosis" },
      { label: "B", text: "Diffusion" },
      { label: "C", text: "Active transport" },
      { label: "D", text: "Facilitated diffusion" },
    ],
    correctAnswer: "C",
    explanation: "Active transport uses ATP energy to move substances against their concentration gradient across the cell membrane.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the difference between rough and smooth endoplasmic reticulum?",
    options: [
      { label: "A", text: "Rough ER has ribosomes on its surface; smooth ER does not" },
      { label: "B", text: "Smooth ER is larger than rough ER" },
      { label: "C", text: "Rough ER produces lipids; smooth ER produces proteins" },
      { label: "D", text: "They are found in different types of organisms" },
    ],
    correctAnswer: "A",
    explanation: "Rough endoplasmic reticulum is studded with ribosomes giving it a 'rough' appearance, while smooth ER lacks ribosomes and is involved in lipid synthesis.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "A cell placed in a hypertonic solution will most likely:",
    options: [
      { label: "A", text: "Swell and burst" },
      { label: "B", text: "Shrink due to water loss" },
      { label: "C", text: "Remain unchanged" },
      { label: "D", text: "Divide rapidly" },
    ],
    correctAnswer: "B",
    explanation: "In a hypertonic solution, the concentration of solutes outside the cell is higher, causing water to move out of the cell by osmosis, leading to cell shrinkage (crenation).",
    difficulty: "HARD",
  },
  {
    questionText: "Which process allows cells to engulf large particles by extending pseudopodia?",
    options: [
      { label: "A", text: "Pinocytosis" },
      { label: "B", text: "Exocytosis" },
      { label: "C", text: "Phagocytosis" },
      { label: "D", text: "Osmosis" },
    ],
    correctAnswer: "C",
    explanation: "Phagocytosis (cell eating) is a form of endocytosis where the cell membrane extends pseudopodia to surround and engulf large particles or other cells.",
    difficulty: "HARD",
  },
];

const geneticsQuestions: QuestionSeed[] = [
  {
    questionText: "What molecule carries genetic information in most organisms?",
    options: [
      { label: "A", text: "RNA" },
      { label: "B", text: "Protein" },
      { label: "C", text: "DNA" },
      { label: "D", text: "Carbohydrate" },
    ],
    correctAnswer: "C",
    explanation: "DNA (deoxyribonucleic acid) is the molecule that stores and transmits genetic information in most living organisms.",
    difficulty: "EASY",
  },
  {
    questionText: "How many chromosomes do normal human body cells contain?",
    options: [
      { label: "A", text: "23" },
      { label: "B", text: "44" },
      { label: "C", text: "46" },
      { label: "D", text: "48" },
    ],
    correctAnswer: "C",
    explanation: "Human body (somatic) cells contain 46 chromosomes arranged in 23 pairs, including 22 pairs of autosomes and 1 pair of sex chromosomes.",
    difficulty: "EASY",
  },
  {
    questionText: "What are the complementary base pairs in DNA?",
    options: [
      { label: "A", text: "Adenine-Cytosine and Guanine-Thymine" },
      { label: "B", text: "Adenine-Thymine and Guanine-Cytosine" },
      { label: "C", text: "Adenine-Guanine and Thymine-Cytosine" },
      { label: "D", text: "Adenine-Uracil and Guanine-Cytosine" },
    ],
    correctAnswer: "B",
    explanation: "In DNA, adenine always pairs with thymine (A-T) and guanine always pairs with cytosine (G-C) through hydrogen bonds.",
    difficulty: "EASY",
  },
  {
    questionText: "What term describes an organism with two identical alleles for a trait?",
    options: [
      { label: "A", text: "Heterozygous" },
      { label: "B", text: "Homozygous" },
      { label: "C", text: "Codominant" },
      { label: "D", text: "Polyploid" },
    ],
    correctAnswer: "B",
    explanation: "Homozygous refers to having two identical alleles (e.g., AA or aa) for a particular gene, while heterozygous means having two different alleles (Aa).",
    difficulty: "MEDIUM",
  },
  {
    questionText: "In Mendel's experiment, when he crossed tall (TT) and short (tt) pea plants, what was the F1 generation phenotype?",
    options: [
      { label: "A", text: "All short" },
      { label: "B", text: "All tall" },
      { label: "C", text: "Half tall, half short" },
      { label: "D", text: "Three-quarters tall" },
    ],
    correctAnswer: "B",
    explanation: "The F1 generation was all tall (Tt) because the tall allele (T) is dominant over the short allele (t).",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the phenotypic ratio expected in the F2 generation of a monohybrid cross?",
    options: [
      { label: "A", text: "1:1" },
      { label: "B", text: "2:1" },
      { label: "C", text: "3:1" },
      { label: "D", text: "9:3:3:1" },
    ],
    correctAnswer: "C",
    explanation: "In a monohybrid cross between two heterozygous parents (Tt x Tt), the expected phenotypic ratio is 3:1 (three dominant to one recessive).",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which type of mutation involves the substitution of one nucleotide base for another?",
    options: [
      { label: "A", text: "Deletion" },
      { label: "B", text: "Insertion" },
      { label: "C", text: "Point mutation" },
      { label: "D", text: "Frameshift mutation" },
    ],
    correctAnswer: "C",
    explanation: "A point mutation (base substitution) occurs when a single nucleotide is replaced by a different nucleotide in the DNA sequence.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the probability of a child being a carrier (Aa) if both parents are carriers of an autosomal recessive trait?",
    options: [
      { label: "A", text: "25%" },
      { label: "B", text: "50%" },
      { label: "C", text: "75%" },
      { label: "D", text: "100%" },
    ],
    correctAnswer: "B",
    explanation: "When both parents are carriers (Aa x Aa), the offspring ratio is 1 AA : 2 Aa : 1 aa. So 50% (2 out of 4) will be carriers (Aa).",
    difficulty: "HARD",
  },
  {
    questionText: "Which process introduces genetic variation during meiosis by exchanging segments between homologous chromosomes?",
    options: [
      { label: "A", text: "Mutation" },
      { label: "B", text: "Crossing over" },
      { label: "C", text: "Inversion" },
      { label: "D", text: "Nondisjunction" },
    ],
    correctAnswer: "B",
    explanation: "Crossing over occurs during prophase I of meiosis when homologous chromosomes exchange genetic material, increasing genetic diversity.",
    difficulty: "HARD",
  },
  {
    questionText: "Sickle cell anemia is prevalent in malaria-endemic regions of Ethiopia because carriers have:",
    options: [
      { label: "A", text: "Complete immunity to malaria" },
      { label: "B", text: "Increased resistance to malaria infection" },
      { label: "C", text: "Stronger immune systems overall" },
      { label: "D", text: "Higher reproductive rates" },
    ],
    correctAnswer: "B",
    explanation: "Heterozygous carriers (HbAS) of the sickle cell trait have increased resistance to malaria, providing a selective advantage in regions like Ethiopia where malaria is endemic.",
    difficulty: "HARD",
  },
];

const ecologyQuestions: QuestionSeed[] = [
  {
    questionText: "What is an ecosystem?",
    options: [
      { label: "A", text: "A group of organisms of the same species" },
      { label: "B", text: "A community of organisms interacting with their physical environment" },
      { label: "C", text: "A single organism and its habitat" },
      { label: "D", text: "The study of weather patterns" },
    ],
    correctAnswer: "B",
    explanation: "An ecosystem includes all living organisms (biotic factors) in an area along with their physical environment (abiotic factors) and their interactions.",
    difficulty: "EASY",
  },
  {
    questionText: "Which organisms are at the base of most food chains?",
    options: [
      { label: "A", text: "Herbivores" },
      { label: "B", text: "Carnivores" },
      { label: "C", text: "Decomposers" },
      { label: "D", text: "Producers (plants)" },
    ],
    correctAnswer: "D",
    explanation: "Producers such as green plants and algae form the base of food chains because they convert sunlight into chemical energy through photosynthesis.",
    difficulty: "EASY",
  },
  {
    questionText: "The Simien Mountains National Park in Ethiopia is known for protecting which endemic species?",
    options: [
      { label: "A", text: "African elephant" },
      { label: "B", text: "Gelada baboon and Walia ibex" },
      { label: "C", text: "Nile crocodile" },
      { label: "D", text: "African wild dog" },
    ],
    correctAnswer: "B",
    explanation: "The Simien Mountains National Park is a UNESCO World Heritage Site that protects endemic species including the Gelada baboon, Walia ibex, and Ethiopian wolf.",
    difficulty: "EASY",
  },
  {
    questionText: "What type of relationship exists when both organisms benefit from living together?",
    options: [
      { label: "A", text: "Parasitism" },
      { label: "B", text: "Commensalism" },
      { label: "C", text: "Mutualism" },
      { label: "D", text: "Competition" },
    ],
    correctAnswer: "C",
    explanation: "Mutualism is a symbiotic relationship where both organisms benefit, such as bees pollinating flowers while collecting nectar.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What percentage of energy is typically transferred from one trophic level to the next?",
    options: [
      { label: "A", text: "1%" },
      { label: "B", text: "10%" },
      { label: "C", text: "50%" },
      { label: "D", text: "90%" },
    ],
    correctAnswer: "B",
    explanation: "The 10% rule states that approximately 10% of the energy at one trophic level is transferred to the next; the rest is lost as heat through metabolic processes.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Deforestation in the Ethiopian Highlands has primarily led to:",
    options: [
      { label: "A", text: "Increased biodiversity" },
      { label: "B", text: "Soil erosion and loss of fertile land" },
      { label: "C", text: "Lower temperatures" },
      { label: "D", text: "Increased rainfall" },
    ],
    correctAnswer: "B",
    explanation: "Deforestation in the Ethiopian Highlands has caused severe soil erosion, reducing agricultural productivity and contributing to land degradation.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which biogeochemical cycle is most directly affected by burning fossil fuels?",
    options: [
      { label: "A", text: "Water cycle" },
      { label: "B", text: "Nitrogen cycle" },
      { label: "C", text: "Carbon cycle" },
      { label: "D", text: "Phosphorus cycle" },
    ],
    correctAnswer: "C",
    explanation: "Burning fossil fuels releases stored carbon as CO2 into the atmosphere, directly impacting the carbon cycle and contributing to climate change.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which term describes the maximum number of individuals an environment can sustainably support?",
    options: [
      { label: "A", text: "Biotic potential" },
      { label: "B", text: "Carrying capacity" },
      { label: "C", text: "Population density" },
      { label: "D", text: "Growth rate" },
    ],
    correctAnswer: "B",
    explanation: "Carrying capacity (K) is the maximum population size that an environment can sustain indefinitely given available resources.",
    difficulty: "HARD",
  },
  {
    questionText: "In ecological succession, the first organisms to colonize a bare area are called:",
    options: [
      { label: "A", text: "Climax species" },
      { label: "B", text: "Secondary colonizers" },
      { label: "C", text: "Pioneer species" },
      { label: "D", text: "Keystone species" },
    ],
    correctAnswer: "C",
    explanation: "Pioneer species such as lichens and mosses are the first to colonize barren environments during primary succession, helping create soil for later species.",
    difficulty: "HARD",
  },
  {
    questionText: "The Great Rift Valley lakes of Ethiopia are important ecological resources because they:",
    options: [
      { label: "A", text: "Provide the majority of Ethiopia's drinking water" },
      { label: "B", text: "Support unique biodiversity and provide water for agriculture" },
      { label: "C", text: "Are the deepest lakes in Africa" },
      { label: "D", text: "Were formed by glacial activity" },
    ],
    correctAnswer: "B",
    explanation: "The Rift Valley lakes of Ethiopia, including Lake Ziway and Lake Abaya, support unique fish species, birdlife, and provide water for irrigation and local communities.",
    difficulty: "HARD",
  },
];

const humanBodyQuestions: QuestionSeed[] = [
  {
    questionText: "Which organ is responsible for pumping blood throughout the body?",
    options: [
      { label: "A", text: "Lungs" },
      { label: "B", text: "Liver" },
      { label: "C", text: "Heart" },
      { label: "D", text: "Kidney" },
    ],
    correctAnswer: "C",
    explanation: "The heart is a muscular organ that pumps blood through the circulatory system, delivering oxygen and nutrients to tissues.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the largest organ in the human body?",
    options: [
      { label: "A", text: "Liver" },
      { label: "B", text: "Brain" },
      { label: "C", text: "Skin" },
      { label: "D", text: "Lungs" },
    ],
    correctAnswer: "C",
    explanation: "The skin is the largest organ of the human body, covering approximately 1.5 to 2 square meters in adults and serving as a protective barrier.",
    difficulty: "EASY",
  },
  {
    questionText: "Which blood vessels carry blood away from the heart?",
    options: [
      { label: "A", text: "Veins" },
      { label: "B", text: "Capillaries" },
      { label: "C", text: "Arteries" },
      { label: "D", text: "Lymph vessels" },
    ],
    correctAnswer: "C",
    explanation: "Arteries carry oxygenated blood away from the heart to the body's tissues (except for the pulmonary artery, which carries deoxygenated blood to the lungs).",
    difficulty: "EASY",
  },
  {
    questionText: "What is the role of white blood cells in the immune system?",
    options: [
      { label: "A", text: "Carrying oxygen" },
      { label: "B", text: "Blood clotting" },
      { label: "C", text: "Fighting infections and foreign invaders" },
      { label: "D", text: "Transporting nutrients" },
    ],
    correctAnswer: "C",
    explanation: "White blood cells (leukocytes) are key components of the immune system that identify and destroy pathogens, infected cells, and foreign substances.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Where does gas exchange occur in the respiratory system?",
    options: [
      { label: "A", text: "Trachea" },
      { label: "B", text: "Bronchi" },
      { label: "C", text: "Alveoli" },
      { label: "D", text: "Larynx" },
    ],
    correctAnswer: "C",
    explanation: "Gas exchange occurs in the alveoli, tiny air sacs in the lungs where oxygen diffuses into the blood and carbon dioxide diffuses out.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which part of the brain controls voluntary movements?",
    options: [
      { label: "A", text: "Cerebellum" },
      { label: "B", text: "Medulla oblongata" },
      { label: "C", text: "Cerebrum" },
      { label: "D", text: "Hypothalamus" },
    ],
    correctAnswer: "C",
    explanation: "The cerebrum, the largest part of the brain, controls voluntary movements, conscious thought, language, and sensory processing.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the function of the nephrons in the kidney?",
    options: [
      { label: "A", text: "Producing hormones" },
      { label: "B", text: "Filtering blood and producing urine" },
      { label: "C", text: "Absorbing nutrients" },
      { label: "D", text: "Pumping blood" },
    ],
    correctAnswer: "B",
    explanation: "Nephrons are the functional units of the kidney that filter blood, reabsorb useful substances, and excrete waste products as urine.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which hormone regulates blood sugar levels by enabling cells to absorb glucose?",
    options: [
      { label: "A", text: "Glucagon" },
      { label: "B", text: "Adrenaline" },
      { label: "C", text: "Insulin" },
      { label: "D", text: "Thyroxine" },
    ],
    correctAnswer: "C",
    explanation: "Insulin, produced by the beta cells of the pancreas, lowers blood glucose levels by facilitating glucose uptake into cells.",
    difficulty: "HARD",
  },
  {
    questionText: "What type of joint allows the widest range of movement, such as the shoulder joint?",
    options: [
      { label: "A", text: "Hinge joint" },
      { label: "B", text: "Pivot joint" },
      { label: "C", text: "Ball-and-socket joint" },
      { label: "D", text: "Gliding joint" },
    ],
    correctAnswer: "C",
    explanation: "Ball-and-socket joints, found at the shoulder and hip, allow movement in multiple directions including rotation, providing the greatest range of motion.",
    difficulty: "HARD",
  },
  {
    questionText: "During digestion, which enzyme in saliva begins the chemical breakdown of starch?",
    options: [
      { label: "A", text: "Pepsin" },
      { label: "B", text: "Lipase" },
      { label: "C", text: "Salivary amylase" },
      { label: "D", text: "Trypsin" },
    ],
    correctAnswer: "C",
    explanation: "Salivary amylase (ptyalin) is an enzyme in saliva that initiates the digestion of starch by breaking it down into maltose in the mouth.",
    difficulty: "HARD",
  },
];

// ─── Mathematics Questions ──────────────────────────────────────

const algebraQuestions: QuestionSeed[] = [
  {
    questionText: "What is the value of x in the equation 2x + 6 = 14?",
    options: [
      { label: "A", text: "3" },
      { label: "B", text: "4" },
      { label: "C", text: "5" },
      { label: "D", text: "10" },
    ],
    correctAnswer: "B",
    explanation: "2x + 6 = 14 => 2x = 8 => x = 4.",
    difficulty: "EASY",
  },
  {
    questionText: "Simplify the expression: 3(x + 2) - x",
    options: [
      { label: "A", text: "2x + 6" },
      { label: "B", text: "2x + 2" },
      { label: "C", text: "4x + 6" },
      { label: "D", text: "3x + 6" },
    ],
    correctAnswer: "A",
    explanation: "3(x + 2) - x = 3x + 6 - x = 2x + 6.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the slope of the line y = 3x - 7?",
    options: [
      { label: "A", text: "-7" },
      { label: "B", text: "3" },
      { label: "C", text: "-3" },
      { label: "D", text: "7" },
    ],
    correctAnswer: "B",
    explanation: "In the slope-intercept form y = mx + b, m is the slope. Here m = 3.",
    difficulty: "EASY",
  },
  {
    questionText: "If f(x) = 2x^2 - 3x + 1, what is f(2)?",
    options: [
      { label: "A", text: "1" },
      { label: "B", text: "3" },
      { label: "C", text: "5" },
      { label: "D", text: "7" },
    ],
    correctAnswer: "B",
    explanation: "f(2) = 2(4) - 3(2) + 1 = 8 - 6 + 1 = 3.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Solve the system of equations: x + y = 10 and x - y = 4. What is x?",
    options: [
      { label: "A", text: "3" },
      { label: "B", text: "5" },
      { label: "C", text: "7" },
      { label: "D", text: "14" },
    ],
    correctAnswer: "C",
    explanation: "Adding the two equations: 2x = 14, so x = 7. Then y = 10 - 7 = 3.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What are the solutions to x^2 - 5x + 6 = 0?",
    options: [
      { label: "A", text: "x = 1 and x = 6" },
      { label: "B", text: "x = 2 and x = 3" },
      { label: "C", text: "x = -2 and x = -3" },
      { label: "D", text: "x = -1 and x = 6" },
    ],
    correctAnswer: "B",
    explanation: "Factoring: (x - 2)(x - 3) = 0, so x = 2 or x = 3.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Which inequality represents 'x is at least 5'?",
    options: [
      { label: "A", text: "x > 5" },
      { label: "B", text: "x < 5" },
      { label: "C", text: "x >= 5" },
      { label: "D", text: "x <= 5" },
    ],
    correctAnswer: "C",
    explanation: "'At least 5' means 5 or greater, which is written as x >= 5.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Simplify: (x^3 * x^4) / x^2",
    options: [
      { label: "A", text: "x^5" },
      { label: "B", text: "x^9" },
      { label: "C", text: "x^6" },
      { label: "D", text: "x^24" },
    ],
    correctAnswer: "A",
    explanation: "x^3 * x^4 = x^7. Then x^7 / x^2 = x^(7-2) = x^5.",
    difficulty: "HARD",
  },
  {
    questionText: "What is the discriminant of the quadratic equation 2x^2 + 4x + 2 = 0, and what does it indicate?",
    options: [
      { label: "A", text: "0; one repeated real root" },
      { label: "B", text: "8; two distinct real roots" },
      { label: "C", text: "-8; no real roots" },
      { label: "D", text: "16; two distinct real roots" },
    ],
    correctAnswer: "A",
    explanation: "Discriminant = b^2 - 4ac = 16 - 16 = 0. A discriminant of 0 indicates exactly one repeated real root.",
    difficulty: "HARD",
  },
  {
    questionText: "If log_2(x) = 5, what is the value of x?",
    options: [
      { label: "A", text: "10" },
      { label: "B", text: "25" },
      { label: "C", text: "32" },
      { label: "D", text: "64" },
    ],
    correctAnswer: "C",
    explanation: "log_2(x) = 5 means 2^5 = x, so x = 32.",
    difficulty: "HARD",
  },
];

const geometryQuestions: QuestionSeed[] = [
  {
    questionText: "What is the sum of the interior angles of a triangle?",
    options: [
      { label: "A", text: "90 degrees" },
      { label: "B", text: "180 degrees" },
      { label: "C", text: "270 degrees" },
      { label: "D", text: "360 degrees" },
    ],
    correctAnswer: "B",
    explanation: "The sum of interior angles in any triangle is always 180 degrees.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the area of a rectangle with length 8 cm and width 5 cm?",
    options: [
      { label: "A", text: "13 cm^2" },
      { label: "B", text: "26 cm^2" },
      { label: "C", text: "40 cm^2" },
      { label: "D", text: "80 cm^2" },
    ],
    correctAnswer: "C",
    explanation: "Area of a rectangle = length x width = 8 x 5 = 40 cm^2.",
    difficulty: "EASY",
  },
  {
    questionText: "A circle has a radius of 7 cm. What is its approximate circumference? (Use pi = 22/7)",
    options: [
      { label: "A", text: "22 cm" },
      { label: "B", text: "44 cm" },
      { label: "C", text: "154 cm" },
      { label: "D", text: "88 cm" },
    ],
    correctAnswer: "B",
    explanation: "Circumference = 2 * pi * r = 2 * (22/7) * 7 = 44 cm.",
    difficulty: "EASY",
  },
  {
    questionText: "What type of triangle has all three sides of equal length?",
    options: [
      { label: "A", text: "Isosceles" },
      { label: "B", text: "Scalene" },
      { label: "C", text: "Equilateral" },
      { label: "D", text: "Right" },
    ],
    correctAnswer: "C",
    explanation: "An equilateral triangle has all three sides equal in length and all three angles equal to 60 degrees.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the length of the hypotenuse of a right triangle with legs of 3 and 4?",
    options: [
      { label: "A", text: "5" },
      { label: "B", text: "6" },
      { label: "C", text: "7" },
      { label: "D", text: "12" },
    ],
    correctAnswer: "A",
    explanation: "By the Pythagorean theorem: c^2 = 3^2 + 4^2 = 9 + 16 = 25, so c = 5.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the volume of a cylinder with radius 3 cm and height 10 cm? (Use pi = 3.14)",
    options: [
      { label: "A", text: "90 cm^3" },
      { label: "B", text: "94.2 cm^3" },
      { label: "C", text: "282.6 cm^3" },
      { label: "D", text: "188.4 cm^3" },
    ],
    correctAnswer: "C",
    explanation: "Volume = pi * r^2 * h = 3.14 * 9 * 10 = 282.6 cm^3.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "Two angles are supplementary. If one angle is 65 degrees, what is the other?",
    options: [
      { label: "A", text: "25 degrees" },
      { label: "B", text: "115 degrees" },
      { label: "C", text: "295 degrees" },
      { label: "D", text: "65 degrees" },
    ],
    correctAnswer: "B",
    explanation: "Supplementary angles add up to 180 degrees. 180 - 65 = 115 degrees.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the surface area of a cube with side length 4 cm?",
    options: [
      { label: "A", text: "16 cm^2" },
      { label: "B", text: "64 cm^2" },
      { label: "C", text: "96 cm^2" },
      { label: "D", text: "24 cm^2" },
    ],
    correctAnswer: "C",
    explanation: "Surface area of a cube = 6 * s^2 = 6 * 16 = 96 cm^2.",
    difficulty: "HARD",
  },
  {
    questionText: "In a coordinate plane, what is the distance between points (1, 2) and (4, 6)?",
    options: [
      { label: "A", text: "4" },
      { label: "B", text: "5" },
      { label: "C", text: "7" },
      { label: "D", text: "25" },
    ],
    correctAnswer: "B",
    explanation: "Distance = sqrt((4-1)^2 + (6-2)^2) = sqrt(9 + 16) = sqrt(25) = 5.",
    difficulty: "HARD",
  },
  {
    questionText: "A regular hexagon can be divided into how many equilateral triangles?",
    options: [
      { label: "A", text: "4" },
      { label: "B", text: "5" },
      { label: "C", text: "6" },
      { label: "D", text: "8" },
    ],
    correctAnswer: "C",
    explanation: "A regular hexagon can be divided into exactly 6 equilateral triangles by drawing lines from the center to each vertex.",
    difficulty: "HARD",
  },
];

const statisticsQuestions: QuestionSeed[] = [
  {
    questionText: "What is the mean of the data set: 4, 8, 6, 10, 12?",
    options: [
      { label: "A", text: "6" },
      { label: "B", text: "8" },
      { label: "C", text: "10" },
      { label: "D", text: "12" },
    ],
    correctAnswer: "B",
    explanation: "Mean = (4 + 8 + 6 + 10 + 12) / 5 = 40 / 5 = 8.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the mode of the data set: 3, 5, 7, 5, 9, 5, 11?",
    options: [
      { label: "A", text: "3" },
      { label: "B", text: "5" },
      { label: "C", text: "7" },
      { label: "D", text: "9" },
    ],
    correctAnswer: "B",
    explanation: "The mode is the value that appears most frequently. 5 appears three times, more than any other value.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the median of: 12, 3, 7, 9, 15?",
    options: [
      { label: "A", text: "7" },
      { label: "B", text: "9" },
      { label: "C", text: "12" },
      { label: "D", text: "3" },
    ],
    correctAnswer: "B",
    explanation: "Arranged in order: 3, 7, 9, 12, 15. The middle value is 9.",
    difficulty: "EASY",
  },
  {
    questionText: "What is the range of the data set: 14, 22, 8, 30, 16?",
    options: [
      { label: "A", text: "16" },
      { label: "B", text: "18" },
      { label: "C", text: "22" },
      { label: "D", text: "30" },
    ],
    correctAnswer: "C",
    explanation: "Range = maximum - minimum = 30 - 8 = 22.",
    difficulty: "EASY",
  },
  {
    questionText: "In a bar chart showing exam scores of 50 students, the tallest bar reaches 15. What does this indicate?",
    options: [
      { label: "A", text: "The highest score is 15" },
      { label: "B", text: "15 students achieved the most common score range" },
      { label: "C", text: "The average score is 15" },
      { label: "D", text: "There are 15 categories of scores" },
    ],
    correctAnswer: "B",
    explanation: "In a bar chart of frequency distribution, the height of each bar represents the frequency (number of students) in that score range.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "A coin is flipped twice. What is the probability of getting heads both times?",
    options: [
      { label: "A", text: "1/2" },
      { label: "B", text: "1/3" },
      { label: "C", text: "1/4" },
      { label: "D", text: "1/8" },
    ],
    correctAnswer: "C",
    explanation: "P(HH) = P(H) * P(H) = 1/2 * 1/2 = 1/4.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the median of the data set: 2, 4, 6, 8, 10, 12?",
    options: [
      { label: "A", text: "6" },
      { label: "B", text: "7" },
      { label: "C", text: "8" },
      { label: "D", text: "5" },
    ],
    correctAnswer: "B",
    explanation: "With an even number of values, the median is the average of the two middle values: (6 + 8) / 2 = 7.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "A student scored 72, 85, 68, 90, and 95. What score is needed on the 6th test to achieve an average of 82?",
    options: [
      { label: "A", text: "80" },
      { label: "B", text: "82" },
      { label: "C", text: "84" },
      { label: "D", text: "82" },
    ],
    correctAnswer: "B",
    explanation: "Required total = 82 * 6 = 492. Current total = 72 + 85 + 68 + 90 + 95 = 410. Needed = 492 - 410 = 82.",
    difficulty: "HARD",
  },
  {
    questionText: "Two dice are rolled. What is the probability of getting a sum of 7?",
    options: [
      { label: "A", text: "1/12" },
      { label: "B", text: "1/6" },
      { label: "C", text: "5/36" },
      { label: "D", text: "7/36" },
    ],
    correctAnswer: "B",
    explanation: "There are 6 combinations that give a sum of 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1). Probability = 6/36 = 1/6.",
    difficulty: "HARD",
  },
  {
    questionText: "In a class of 40 students, 25 like Biology and 20 like Chemistry. If 10 like both, how many like neither?",
    options: [
      { label: "A", text: "0" },
      { label: "B", text: "5" },
      { label: "C", text: "10" },
      { label: "D", text: "15" },
    ],
    correctAnswer: "B",
    explanation: "Using inclusion-exclusion: students who like at least one = 25 + 20 - 10 = 35. Neither = 40 - 35 = 5.",
    difficulty: "HARD",
  },
];

const trigonometryQuestions: QuestionSeed[] = [
  {
    questionText: "In a right triangle, the sine of an angle is defined as:",
    options: [
      { label: "A", text: "Adjacent / Hypotenuse" },
      { label: "B", text: "Opposite / Hypotenuse" },
      { label: "C", text: "Opposite / Adjacent" },
      { label: "D", text: "Hypotenuse / Opposite" },
    ],
    correctAnswer: "B",
    explanation: "Sine of an angle = length of the opposite side / length of the hypotenuse (SOH in SOH-CAH-TOA).",
    difficulty: "EASY",
  },
  {
    questionText: "What is the value of sin(90 degrees)?",
    options: [
      { label: "A", text: "0" },
      { label: "B", text: "0.5" },
      { label: "C", text: "1" },
      { label: "D", text: "Undefined" },
    ],
    correctAnswer: "C",
    explanation: "sin(90 degrees) = 1. This is a fundamental trigonometric value.",
    difficulty: "EASY",
  },
  {
    questionText: "What is cos(0 degrees)?",
    options: [
      { label: "A", text: "0" },
      { label: "B", text: "0.5" },
      { label: "C", text: "1" },
      { label: "D", text: "-1" },
    ],
    correctAnswer: "C",
    explanation: "cos(0 degrees) = 1. The cosine function starts at 1 when the angle is 0.",
    difficulty: "EASY",
  },
  {
    questionText: "Which trigonometric ratio is equal to opposite / adjacent?",
    options: [
      { label: "A", text: "Sine" },
      { label: "B", text: "Cosine" },
      { label: "C", text: "Tangent" },
      { label: "D", text: "Secant" },
    ],
    correctAnswer: "C",
    explanation: "Tangent = opposite / adjacent (TOA in SOH-CAH-TOA).",
    difficulty: "EASY",
  },
  {
    questionText: "In a right triangle, if the opposite side is 5 and the hypotenuse is 13, what is sin(theta)?",
    options: [
      { label: "A", text: "5/12" },
      { label: "B", text: "5/13" },
      { label: "C", text: "12/13" },
      { label: "D", text: "13/5" },
    ],
    correctAnswer: "B",
    explanation: "sin(theta) = opposite / hypotenuse = 5/13.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "What is the value of tan(45 degrees)?",
    options: [
      { label: "A", text: "0" },
      { label: "B", text: "1" },
      { label: "C", text: "sqrt(2)" },
      { label: "D", text: "Undefined" },
    ],
    correctAnswer: "B",
    explanation: "tan(45 degrees) = sin(45)/cos(45) = 1. In a 45-45-90 triangle, the two legs are equal, so opposite/adjacent = 1.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "If sin(A) = 3/5, what is cos(A) in a right triangle?",
    options: [
      { label: "A", text: "3/5" },
      { label: "B", text: "4/5" },
      { label: "C", text: "5/3" },
      { label: "D", text: "3/4" },
    ],
    correctAnswer: "B",
    explanation: "Using the Pythagorean identity: cos(A) = sqrt(1 - sin^2(A)) = sqrt(1 - 9/25) = sqrt(16/25) = 4/5.",
    difficulty: "MEDIUM",
  },
  {
    questionText: "A ladder 10 m long leans against a wall making a 60-degree angle with the ground. How high up the wall does it reach?",
    options: [
      { label: "A", text: "5 m" },
      { label: "B", text: "5*sqrt(3) m" },
      { label: "C", text: "10*sqrt(3) m" },
      { label: "D", text: "10 m" },
    ],
    correctAnswer: "B",
    explanation: "Height = hypotenuse * sin(60) = 10 * (sqrt(3)/2) = 5*sqrt(3) m, approximately 8.66 m.",
    difficulty: "HARD",
  },
  {
    questionText: "What is the exact value of sin(30 degrees) + cos(60 degrees)?",
    options: [
      { label: "A", text: "0.5" },
      { label: "B", text: "1" },
      { label: "C", text: "sqrt(3)/2" },
      { label: "D", text: "sqrt(2)" },
    ],
    correctAnswer: "B",
    explanation: "sin(30) = 1/2 and cos(60) = 1/2, so sin(30) + cos(60) = 1/2 + 1/2 = 1.",
    difficulty: "HARD",
  },
  {
    questionText: "From a point 50 m away from the base of a tower, the angle of elevation to the top is 30 degrees. What is the height of the tower?",
    options: [
      { label: "A", text: "50/sqrt(3) m" },
      { label: "B", text: "50*sqrt(3) m" },
      { label: "C", text: "25 m" },
      { label: "D", text: "100 m" },
    ],
    correctAnswer: "A",
    explanation: "tan(30) = height/50, so height = 50 * tan(30) = 50 * (1/sqrt(3)) = 50/sqrt(3) m, approximately 28.87 m.",
    difficulty: "HARD",
  },
];

// ─── Main Seed Function ─────────────────────────────────────────

async function main() {
  console.log("Seeding database...");

  // 1. Create school
  const school = await prisma.school.upsert({
    where: { id: "seed-school-addis" },
    update: {
      name: "Addis Ababa Model School",
      region: "Addis Ababa",
      city: "Addis Ababa",
      type: "PUBLIC",
    },
    create: {
      id: "seed-school-addis",
      name: "Addis Ababa Model School",
      region: "Addis Ababa",
      city: "Addis Ababa",
      type: "PUBLIC",
    },
  });
  console.log(`  School: ${school.name}`);

  // After school creation, add rewards
  const rewards = await Promise.all([
    prisma.reward.create({
      data: {
        name: "Notebook Set",
        description: "A set of 5 high-quality exercise books for your studies",
        tier: "BRONZE",
        pointsCost: 100,
        inventoryCount: 50,
        schoolId: school.id,
      },
    }),
    prisma.reward.create({
      data: {
        name: "Scientific Calculator",
        description: "CASIO FX-991ES scientific calculator — perfect for Math and Physics",
        tier: "SILVER",
        pointsCost: 300,
        inventoryCount: 20,
        schoolId: school.id,
      },
    }),
    prisma.reward.create({
      data: {
        name: "School Supply Kit",
        description: "Complete stationery kit: pens, pencils, ruler, compass, and eraser",
        tier: "BRONZE",
        pointsCost: 150,
        inventoryCount: 30,
        schoolId: school.id,
      },
    }),
    prisma.reward.create({
      data: {
        name: "English Dictionary",
        description: "Oxford English-Amharic dictionary — bilingual reference book",
        tier: "SILVER",
        pointsCost: 250,
        inventoryCount: 15,
        schoolId: school.id,
      },
    }),
    prisma.reward.create({
      data: {
        name: "School Bag",
        description: "Premium EthioLearn branded school backpack with laptop compartment",
        tier: "GOLD",
        pointsCost: 600,
        inventoryCount: 10,
        schoolId: school.id,
      },
    }),
    prisma.reward.create({
      data: {
        name: "Scholarship Voucher",
        description: "Partial tuition fee voucher for next semester — top achievers only",
        tier: "PLATINUM",
        pointsCost: 2000,
        inventoryCount: 3,
        schoolId: school.id,
      },
    }),
  ]);
  console.log(`✅ Created ${rewards.length} rewards`);

  // 2. Create admin user
  const admin = await prisma.user.upsert({
    where: { phoneNumber: "+251900000000" },
    update: {
      name: "System Admin",
      role: "SUPER_ADMIN",
      schoolId: school.id,
    },
    create: {
      phoneNumber: "+251900000000",
      name: "System Admin",
      role: "SUPER_ADMIN",
      schoolId: school.id,
    },
  });
  console.log(`  Admin: ${admin.name} (${admin.phoneNumber})`);

  // 3. Create test student
  const student = await prisma.user.upsert({
    where: { phoneNumber: "+251911111111" },
    update: {
      name: "Abebe Kebede",
      role: "STUDENT",
      grade: 9,
      schoolId: school.id,
    },
    create: {
      phoneNumber: "+251911111111",
      name: "Abebe Kebede",
      role: "STUDENT",
      grade: 9,
      section: "A",
      schoolId: school.id,
    },
  });
  console.log(`  Student: ${student.name} (${student.phoneNumber})`);

  // Additional test students for demo
  const additionalStudents = [
    { phoneNumber: "+251911111112", name: "Sara Hailu", grade: 9, section: "B", totalPoints: 340, xpLevel: 4, streakDays: 5 },
    { phoneNumber: "+251911111113", name: "Dawit Tekle", grade: 9, section: "A", totalPoints: 520, xpLevel: 6, streakDays: 3 },
    { phoneNumber: "+251911111114", name: "Hanna Girma", grade: 10, section: "A", totalPoints: 180, xpLevel: 2, streakDays: 1 },
    { phoneNumber: "+251911111115", name: "Yonas Bekele", grade: 10, section: "B", totalPoints: 670, xpLevel: 7, streakDays: 7 },
    { phoneNumber: "+251911111116", name: "Meron Assefa", grade: 11, section: "A", totalPoints: 410, xpLevel: 5, streakDays: 2 },
    { phoneNumber: "+251911111117", name: "Abel Tadesse", grade: 11, section: "A", totalPoints: 290, xpLevel: 3, streakDays: 4 },
    { phoneNumber: "+251911111118", name: "Tigist Worku", grade: 9, section: "A", totalPoints: 810, xpLevel: 9, streakDays: 12 },
    { phoneNumber: "+251911111119", name: "Samuel Mulugeta", grade: 12, section: "A", totalPoints: 150, xpLevel: 2, streakDays: 0 },
    { phoneNumber: "+251911111120", name: "Bethlehem Desta", grade: 12, section: "B", totalPoints: 940, xpLevel: 10, streakDays: 15 },
  ];

  for (const s of additionalStudents) {
    await prisma.user.upsert({
      where: { phoneNumber: s.phoneNumber },
      update: {},
      create: {
        ...s,
        role: "STUDENT",
        schoolId: school.id,
        lastActiveAt: new Date(Date.now() - Math.floor(Math.random() * 7) * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`  Created ${additionalStudents.length} additional students`);

  // 4. Create textbooks
  const biologyTextbook = await prisma.textbook.upsert({
    where: { id: "seed-textbook-bio9" },
    update: {
      title: "Grade 9 Biology",
      grade: 9,
      subject: "Biology",
      publisher: "Ministry of Education, Ethiopia",
      academicYear: "2024/2025",
      chapterCount: 4,
      processingStatus: "COMPLETED",
    },
    create: {
      id: "seed-textbook-bio9",
      title: "Grade 9 Biology",
      grade: 9,
      subject: "Biology",
      language: "en",
      publisher: "Ministry of Education, Ethiopia",
      academicYear: "2024/2025",
      fileUrl: "/textbooks/grade9-biology.pdf",
      processingStatus: "COMPLETED",
      chapterCount: 4,
      uploadedById: admin.id,
      schoolId: school.id,
    },
  });
  console.log(`  Textbook: ${biologyTextbook.title}`);

  const mathTextbook = await prisma.textbook.upsert({
    where: { id: "seed-textbook-math9" },
    update: {
      title: "Grade 9 Mathematics",
      grade: 9,
      subject: "Mathematics",
      publisher: "Ministry of Education, Ethiopia",
      academicYear: "2024/2025",
      chapterCount: 4,
      processingStatus: "COMPLETED",
    },
    create: {
      id: "seed-textbook-math9",
      title: "Grade 9 Mathematics",
      grade: 9,
      subject: "Mathematics",
      language: "en",
      publisher: "Ministry of Education, Ethiopia",
      academicYear: "2024/2025",
      fileUrl: "/textbooks/grade9-mathematics.pdf",
      processingStatus: "COMPLETED",
      chapterCount: 4,
      uploadedById: admin.id,
      schoolId: school.id,
    },
  });
  console.log(`  Textbook: ${mathTextbook.title}`);

  // 5. Create chapters and questions
  const biologyChapters = [
    { number: 1, title: "Cell Biology", questions: cellBiologyQuestions },
    { number: 2, title: "Genetics", questions: geneticsQuestions },
    { number: 3, title: "Ecology", questions: ecologyQuestions },
    { number: 4, title: "Human Body Systems", questions: humanBodyQuestions },
  ];

  const mathChapters = [
    { number: 1, title: "Algebra", questions: algebraQuestions },
    { number: 2, title: "Geometry", questions: geometryQuestions },
    { number: 3, title: "Statistics", questions: statisticsQuestions },
    { number: 4, title: "Trigonometry", questions: trigonometryQuestions },
  ];

  async function seedChapters(
    textbookId: string,
    chapters: { number: number; title: string; questions: QuestionSeed[] }[]
  ) {
    for (const ch of chapters) {
      const chapterId = `${textbookId}-ch${ch.number}`;

      // Delete existing quiz answers referencing questions in this chapter (FK constraint)
      const existingQuestions = await prisma.question.findMany({
        where: { chapterId },
        select: { id: true },
      });
      if (existingQuestions.length > 0) {
        const questionIds = existingQuestions.map((q) => q.id);
        await prisma.quizAnswer.deleteMany({
          where: { questionId: { in: questionIds } },
        });
      }

      // Delete existing questions for idempotency
      await prisma.question.deleteMany({
        where: { chapterId },
      });

      const chapter = await prisma.chapter.upsert({
        where: {
          textbookId_chapterNumber: {
            textbookId,
            chapterNumber: ch.number,
          },
        },
        update: {
          title: ch.title,
          questionCount: ch.questions.length,
          id: chapterId,
        },
        create: {
          id: chapterId,
          chapterNumber: ch.number,
          title: ch.title,
          questionCount: ch.questions.length,
          textbookId,
          topicTags: [ch.title.toLowerCase()],
          bloomLevels: ["remember", "understand", "apply"],
        },
      });

      // Create questions
      await prisma.question.createMany({
        data: ch.questions.map((q) => ({
          type: "MCQ" as QuestionType,
          difficulty: q.difficulty,
          questionText: q.questionText,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          chapterId: chapter.id,
        })),
      });

      console.log(`    Chapter ${ch.number}: ${ch.title} (${ch.questions.length} questions)`);
    }
  }

  console.log("  Biology chapters:");
  await seedChapters(biologyTextbook.id, biologyChapters);

  console.log("  Mathematics chapters:");
  await seedChapters(mathTextbook.id, mathChapters);

  const totalQuestions = await prisma.question.count();
  console.log(`\nSeeding complete! Total questions: ${totalQuestions}`);

  // Generate quiz history for demo
  const allStudents = await prisma.user.findMany({ where: { role: "STUDENT", schoolId: school.id } });
  const allChapters = await prisma.chapter.findMany({ include: { questions: true } });

  for (const student of allStudents) {
    const numQuizzes = Math.floor(Math.random() * 8) + 2; // 2-9 quizzes each
    for (let i = 0; i < numQuizzes; i++) {
      const chapter = allChapters[Math.floor(Math.random() * allChapters.length)];
      const questions = chapter.questions.slice(0, Math.floor(Math.random() * 5) + 3); // 3-7 questions
      const correctCount = Math.floor(Math.random() * questions.length) + 1;
      const score = Math.round((correctCount / questions.length) * 100);
      const pointsPerQ = 10 + Math.floor(Math.random() * 20);
      const totalPts = correctCount * pointsPerQ;

      const daysAgo = Math.floor(Math.random() * 30);
      const completedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      const quiz = await prisma.quiz.create({
        data: {
          mode: "SOLO",
          score,
          totalPointsEarned: totalPts,
          totalQuestions: questions.length,
          correctAnswers: correctCount,
          startedAt: new Date(completedAt.getTime() - 10 * 60 * 1000), // 10 min before
          completedAt,
          studentId: student.id,
        },
      });

      // Create quiz answers
      for (let j = 0; j < questions.length; j++) {
        const q = questions[j];
        const isCorrect = j < correctCount;
        const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options as string);
        // Options may be stored as { label, text } objects or plain strings
        const toStr = (o: unknown): string =>
          typeof o === "string" ? o : (o as { text?: string })?.text ?? String(o);
        const correctStr = toStr(q.correctAnswer);
        const wrongStr = toStr(options[1] ?? options[0]) || "wrong";
        await prisma.quizAnswer.create({
          data: {
            quizId: quiz.id,
            questionId: q.id,
            studentAnswer: isCorrect ? correctStr : wrongStr,
            isCorrect,
            timeTakenMs: Math.floor(Math.random() * 30000) + 5000,
            pointsEarned: isCorrect ? pointsPerQ : 0,
          },
        });
      }
    }
  }
  console.log(`  Generated quiz history for ${allStudents.length} students`);

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
