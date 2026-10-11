/**
 * Public topic pages for search: one indexable page per thing people search
 * for (national exam practice, battle quiz, AI tutor, adaptive learning,
 * quizzes, Ethiopian education). Search engines rank pages on what they say,
 * so each page explains the feature in plain words, answers common questions
 * (also emitted as FAQPage structured data) and repeats the terms in Amharic
 * for Amharic searches. Rendered by components/seo/topic-page.
 *
 * Keep every claim true to what the app does — these pages are what a parent,
 * student or school reads before signing up.
 */

export type TopicSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type TopicFaq = { q: string; a: string };

export type TopicPage = {
  slug: string;
  /** <title> (the site name is appended). */
  title: string;
  description: string;
  keywords: string[];
  /** Short label for links between pages. */
  navLabel: string;
  /** One line for the homepage's "Explore" cards. */
  summary: string;
  eyebrow: string;
  h1: string;
  intro: string;
  sections: TopicSection[];
  faqs: TopicFaq[];
  /** Amharic summary, for Amharic searches. */
  amharic: { heading: string; text: string };
  /** schema.org type that best describes the page's subject. */
  schemaType: "WebPage" | "AboutPage";
};

export const TOPIC_PAGES: TopicPage[] = [
  {
    slug: "national-exam",
    title: "Ethiopian National Exam Practice – Grade 12 ESSLCE & EUEE Past Papers",
    description:
      "Practise real past Ethiopian Grade 12 national exam (ESSLCE / EUEE entrance exam) papers online: timed exam mode, " +
      "practice mode with answers and explanations, for Natural and Social Science streams. Free to start on Abugida.",
    keywords: [
      "Ethiopian national exam", "Ethiopian national exam practice", "Grade 12 national exam", "ESSLCE",
      "EUEE", "Ethiopian university entrance exam", "entrance exam Ethiopia", "Ethiopian entrance exam past papers",
      "Grade 12 past papers Ethiopia", "national exam questions and answers", "2017 E.C. national exam",
      "2016 E.C. national exam", "national exam natural science", "national exam social science",
      "Grade 12 mathematics national exam", "Grade 12 physics national exam", "Grade 12 chemistry national exam",
      "Grade 12 biology national exam", "Grade 12 English national exam", "scholastic aptitude test Ethiopia",
      "Grade 8 national exam", "ministry exam Ethiopia", "EAES exam", "matric Ethiopia", "national exam online test",
      "የብሔራዊ ፈተና", "የ12ኛ ክፍል ብሔራዊ ፈተና", "የመግቢያ ፈተና", "ማትሪክ",
    ],
    navLabel: "National exam practice",
    summary: "Past Grade 12 national exam papers, timed or with answers and explanations.",
    eyebrow: "Grade 12 · ESSLCE / EUEE",
    h1: "Ethiopian National Exam Practice with real past papers",
    intro:
      "Abugida puts past Ethiopian Grade 12 national exam papers online — Biology, Chemistry, Physics, Mathematics, " +
      "English and the Scholastic Aptitude Test — so students can sit them under exam conditions or work through them " +
      "question by question with the answer and an explanation.",
    sections: [
      {
        heading: "Two ways to practise",
        bullets: [
          "Exam mode — timed like the real national exam, with your score at the end.",
          "Practice mode — see the correct answer and a short explanation after every question.",
          "Review every attempt afterwards: what you chose, the right answer and why.",
        ],
      },
      {
        heading: "Real papers, checked answers",
        paragraphs: [
          "Papers are the questions set by the Educational Assessment and Examinations Service (EAES) for the Ethiopian " +
            "Secondary School Leaving Certificate Examination (ESSLCE), also known as the university entrance exam (EUEE). " +
            "Each paper is reviewed before it is published, including the figures and diagrams questions refer to.",
          "Papers are sorted by year (Ethiopian calendar, for example 2017 E.C.) and by stream — Natural Science and Social Science.",
        ],
      },
      {
        heading: "Prepare the whole cycle, not just Grade 12",
        paragraphs: [
          "The Grade 12 exam draws on everything from Grade 9 to Grade 12. On Abugida a Grade 12 student can open and quiz " +
            "on every Grade 9–12 textbook chapter, ask the AI tutor about any of them, and see which topics need more work.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which national exam papers are on Abugida?",
        a: "Past Grade 12 ESSLCE / university entrance exam papers, starting with 2017 E.C. (2025 G.C.) for the Natural Science stream: Biology, Chemistry, Physics, Mathematics, English and the Scholastic Aptitude Test. More years and the Social Science stream are added over time.",
      },
      {
        q: "Can I see the answers and explanations?",
        a: "Yes. In practice mode the answer and an explanation appear after each question, and every finished attempt can be reviewed question by question.",
      },
      {
        q: "Is the exam mode timed?",
        a: "Yes. Exam mode uses the paper's real time allowance, for example 2:30 hours for Physics, and submits when time runs out.",
      },
      {
        q: "Does it cover Grade 9, 10 and 11 topics too?",
        a: "Yes. The national exam covers Grades 9–12, so Grade 12 students can practise chapter quizzes from all four years of textbooks.",
      },
    ],
    amharic: {
      heading: "የብሔራዊ ፈተና ልምምድ",
      text:
        "ያለፉትን የ12ኛ ክፍል ብሔራዊ ፈተና (የዩኒቨርሲቲ መግቢያ ፈተና) ጥያቄዎች በኦንላይን ይለማመዱ። የፈተና ሁነታ እንደ እውነተኛው ፈተና ጊዜ " +
        "ይቆጠራል፤ የልምምድ ሁነታ ከእያንዳንዱ ጥያቄ በኋላ ትክክለኛውን መልስና ማብራሪያ ያሳያል። ባዮሎጂ፣ ኬሚስትሪ፣ ፊዚክስ፣ ሒሳብ፣ እንግሊዝኛ እና " +
        "የአካዳሚክ ብቃት ፈተና (SAT)።",
    },
    schemaType: "WebPage",
  },
  {
    slug: "battle-quiz",
    title: "Battle Quiz – Live Quiz Battles for Students in Ethiopia",
    description:
      "Battle quiz on Abugida: challenge classmates to live quiz battles on your textbook chapters, answer fastest, " +
      "earn points and climb the leaderboard. Fun competitive practice for Ethiopian students, Grades 9–12.",
    keywords: [
      "battle quiz", "quiz battle", "live quiz battle", "quiz game", "multiplayer quiz", "quiz competition",
      "online quiz competition Ethiopia", "student quiz game", "classroom quiz game", "quiz battle app",
      "quiz duel", "trivia battle", "educational game Ethiopia", "learning games for students", "gamified learning",
      "leaderboard quiz", "daily challenge quiz", "quiz with friends", "kahoot alternative Ethiopia",
      "የጥያቄ ውድድር", "የፈተና ውድድር", "ጨዋታ በመማር",
    ],
    navLabel: "Battle quiz",
    summary: "Live quiz battles with classmates on your own textbook chapters.",
    eyebrow: "Live · Competitive · Curriculum-based",
    h1: "Battle Quiz: live quiz battles on your own textbooks",
    intro:
      "Turn revision into a game. Start a battle, share the room code with classmates, and answer the same questions " +
      "from your Ethiopian curriculum textbook at the same time — the fastest correct answers win.",
    sections: [
      {
        heading: "How a battle works",
        bullets: [
          "Pick a subject and chapter, then create a battle room.",
          "Friends join with the room code — on a phone or a computer.",
          "Everyone gets the same questions at the same moment; points go to correct and fast answers.",
          "Results, points and rankings update straight away.",
        ],
      },
      {
        heading: "More than a game",
        paragraphs: [
          "Every battle question comes from the national curriculum textbook for your grade, so playing is studying. " +
            "Battles count towards streaks, the leaderboard and school rewards, alongside the daily challenge.",
        ],
      },
      {
        heading: "In the classroom too",
        paragraphs: [
          "Teachers of Grades 1–8 run whole-class games such as Tug of War, number memory and find-the-pair on the board, " +
            "and secondary teachers can set quizzes for a class to sit together.",
        ],
      },
    ],
    faqs: [
      {
        q: "What is a battle quiz?",
        a: "A live quiz where two or more students answer the same questions at the same time and compete for points. On Abugida the questions come from your Ethiopian textbook chapters.",
      },
      {
        q: "How do I invite friends to a battle?",
        a: "Create a battle and share its room code. Friends enter the code to join from any phone or computer.",
      },
      {
        q: "Do battles count towards my progress?",
        a: "Yes. Battle results add to your points, streak and leaderboard position.",
      },
    ],
    amharic: {
      heading: "የጥያቄ ውድድር (Battle Quiz)",
      text:
        "ከክፍል ጓደኞችዎ ጋር በቀጥታ የጥያቄ ውድድር ያድርጉ። ውድድር ይፍጠሩ፣ የክፍሉን ኮድ ያጋሩ፣ ሁላችሁም ከመማሪያ መጽሐፋችሁ ተመሳሳይ ጥያቄዎችን " +
        "በአንድ ጊዜ ትመልሳላችሁ። ፈጣንና ትክክለኛ መልስ ነጥብ ያስገኛል፤ በደረጃ ሰንጠረዡ ላይ ይውጡ።",
    },
    schemaType: "WebPage",
  },
  {
    slug: "ai-tutor",
    title: "AI Tutor for Ethiopian Students – Step-by-Step Help on Your Textbook",
    description:
      "An AI tutor that follows the Ethiopian curriculum: pick your textbook and chapter, ask any question and get " +
      "step-by-step explanations in English or Amharic. Maths, physics, chemistry, biology and more, Grades 9–12.",
    keywords: [
      "AI tutor", "AI tutor Ethiopia", "AI education", "AI in education Ethiopia", "artificial intelligence learning",
      "AI homework help", "homework help Ethiopia", "AI study assistant", "ask a question get answer",
      "math solver", "physics help", "chemistry help", "biology help", "AI for students", "AI teacher assistant",
      "ChatGPT for students Ethiopia", "Amharic AI tutor", "online tutor Ethiopia", "private tutor Ethiopia",
      "AI learning platform", "የAI አስተማሪ", "ሰው ሰራሽ አስተውሎት ትምህርት", "የቤት ስራ እገዛ",
    ],
    navLabel: "AI tutor",
    summary: "Step-by-step help that follows your Ethiopian textbook, in English or Amharic.",
    eyebrow: "AI education · Curriculum-grounded",
    h1: "An AI tutor that knows your Ethiopian textbook",
    intro:
      "Choose your textbook and chapter, then ask anything — \"explain this formula\", \"why does this happen?\", " +
      "\"quiz me\". The tutor answers from that chapter, step by step, so its help matches what your class is learning.",
    sections: [
      {
        heading: "What makes it different",
        bullets: [
          "Grounded in the chapter you pick — it looks up the relevant pages of the book before answering.",
          "Follows the Ethiopian national curriculum for Grades 9–12.",
          "Explains step by step, and you can keep asking follow-up questions.",
          "Works in English and Amharic, on phones and computers.",
        ],
      },
      {
        heading: "AI helpers for maths and science",
        paragraphs: [
          "The grapher draws functions and explains graphs; the 3D geometry tool shows solids you can turn and measure. " +
            "Both can read an equation or a shape from a photo.",
        ],
      },
      {
        heading: "For teachers",
        paragraphs: [
          "Secondary teachers get an AI teaching assistant that drafts lesson notes, worksheets and test papers from the " +
            "chapters they teach — ready to edit and hand out.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is the AI tutor based on the Ethiopian curriculum?",
        a: "Yes. You choose a textbook and chapter from the Ethiopian national curriculum, and the tutor answers using that chapter's content.",
      },
      {
        q: "Can the AI tutor answer in Amharic?",
        a: "Yes. You can ask in English or Amharic.",
      },
      {
        q: "Will the AI just give me the answers?",
        a: "It explains how to reach the answer step by step, so you understand the method, and it can quiz you to check.",
      },
    ],
    amharic: {
      heading: "የAI አስተማሪ",
      text:
        "መማሪያ መጽሐፍዎንና ምዕራፉን ይምረጡ፣ ማንኛውንም ጥያቄ ይጠይቁ። የAI አስተማሪው ከዚያው ምዕራፍ በመነሳት ደረጃ በደረጃ ያብራራል። " +
        "በኢትዮጵያ ሥርዓተ ትምህርት መሠረት ከ9ኛ እስከ 12ኛ ክፍል፣ በእንግሊዝኛና በአማርኛ።",
    },
    schemaType: "WebPage",
  },
  {
    slug: "adaptive-learning",
    title: "Adaptive Learning – Personalized Practice for Every Student",
    description:
      "Adaptive learning on Abugida: quizzes adjust their difficulty to each student's level, track mastery chapter by " +
      "chapter and point to the topics that need work. Personalized learning for Ethiopian students, Grades 9–12.",
    keywords: [
      "adaptive learning", "adaptive learning platform", "personalized learning", "personalised learning",
      "personalized practice", "adaptive quiz", "adaptive testing", "mastery learning", "learning analytics",
      "student progress tracking", "weak topics", "smart learning Ethiopia", "edtech Ethiopia",
      "AI adaptive learning", "individualized learning", "differentiated instruction", "Bloom's taxonomy questions",
      "የግል ትምህርት", "ተስማሚ ትምህርት",
    ],
    navLabel: "Adaptive learning",
    summary: "Practice that adjusts its difficulty to each student's level.",
    eyebrow: "Personalized · Data-driven",
    h1: "Adaptive learning: practice that adjusts to every student",
    intro:
      "No two students need the same next question. Abugida watches how each student answers and adjusts the difficulty " +
      "of their quizzes, so stronger students are stretched and others build up step by step.",
    sections: [
      {
        heading: "How it adapts",
        bullets: [
          "Estimates each student's level from their answers — per chapter, per subject and overall.",
          "Recommends easy, medium or hard questions to match that level.",
          "Serves questions the student has not seen before, so practice keeps covering new material.",
          "Questions span Bloom's levels, from remembering facts to applying and analysing them.",
        ],
      },
      {
        heading: "Progress you can see",
        paragraphs: [
          "Students see their progress by subject and chapter, streaks and history. Teachers and schools see the same " +
            "per student and per class, so they know who needs help with what.",
        ],
      },
    ],
    faqs: [
      {
        q: "What is adaptive learning?",
        a: "Learning that changes with the learner: the difficulty and choice of practice adjust to how well the student is doing, instead of everyone getting the same questions.",
      },
      {
        q: "How does Abugida decide my level?",
        a: "From your answers — on the chapter you are studying, the whole subject and your overall history, with recent answers counting most.",
      },
    ],
    amharic: {
      heading: "ለእያንዳንዱ ተማሪ የሚስማማ ትምህርት",
      text:
        "አቡጊዳ እያንዳንዱ ተማሪ የሚመልሰውን በመከታተል የጥያቄዎቹን ክብደት ከተማሪው ደረጃ ጋር ያስማማል። ተማሪዎች፣ መምህራንና ትምህርት ቤቶች " +
        "በየትምህርቱና በየምዕራፉ ያለውን እድገት ማየት ይችላሉ።",
    },
    schemaType: "WebPage",
  },
  {
    slug: "quiz",
    title: "Online Quizzes & Practice Questions – Ethiopian Curriculum, Grades 9–12",
    description:
      "Thousands of practice questions and chapter quizzes from Ethiopian textbooks: multiple choice, true/false, " +
      "fill in the blank, matching and ordering, with an explanation for every answer. Grades 9–12, free to start.",
    keywords: [
      "online quiz", "quiz", "practice questions", "practice test", "chapter quiz", "Ethiopian quiz",
      "Ethiopian questions and answers", "questions and answers", "multiple choice questions", "MCQ",
      "true or false questions", "fill in the blank", "worksheet", "mock exam", "model exam Ethiopia",
      "grade 9 questions", "grade 10 questions", "grade 11 questions", "grade 12 questions", "grade 8 questions",
      "grade 7 questions", "grade 6 questions", "mathematics questions", "physics questions", "chemistry questions",
      "biology questions", "English questions", "IT questions", "information technology grade 9",
      "Ethiopian textbook questions", "exam preparation Ethiopia", "የጥያቄና መልስ", "ጥያቄዎች", "ፈተና", "ሞዴል ፈተና",
    ],
    navLabel: "Quizzes & questions",
    summary: "Chapter quizzes and practice questions with an explanation for every answer.",
    eyebrow: "Practice · Explanations · Every chapter",
    h1: "Online quizzes and practice questions for every chapter",
    intro:
      "Pick your grade, subject and chapter and start a quiz. Every question comes from the Ethiopian national curriculum " +
      "textbook, and every answer comes with an explanation — so a wrong answer teaches you something.",
    sections: [
      {
        heading: "Question types",
        bullets: [
          "Multiple choice, true/false, fill in the blank, matching and ordering.",
          "Easy, medium and hard, or a mix.",
          "One chapter or the whole book, 1 to 20 questions at a time.",
        ],
      },
      {
        heading: "Subjects and grades",
        paragraphs: [
          "Mathematics, Physics, Chemistry, Biology, English, Amharic, History, Geography, Information Technology and more, " +
            "following the textbooks for Grades 9–12. Grade 12 students can also practise past national exam papers.",
        ],
      },
      {
        heading: "Checked questions",
        paragraphs: [
          "Questions are checked before students see them — a second model re-solves each one to catch a wrong answer key, " +
            "and questions that are unclear, repeated or outside the chapter are dropped.",
        ],
      },
    ],
    faqs: [
      {
        q: "Are the quiz questions from Ethiopian textbooks?",
        a: "Yes. Each quiz is built from the chapter you choose in the Ethiopian national curriculum textbook for your grade.",
      },
      {
        q: "Do I get explanations?",
        a: "Yes, every question has an explanation of the correct answer.",
      },
      {
        q: "Which grades have quizzes?",
        a: "Grades 9–12. Grades 1–8 are taught in class by their teachers, with classroom games on one screen. New textbooks and questions are added regularly.",
      },
    ],
    amharic: {
      heading: "የኦንላይን ጥያቄዎችና ፈተናዎች",
      text:
        "ክፍልዎን፣ የትምህርት ዓይነቱንና ምዕራፉን መርጠው ፈተና ይጀምሩ። እያንዳንዱ ጥያቄ ከኢትዮጵያ ሥርዓተ ትምህርት መማሪያ መጽሐፍ የተወሰደ ሲሆን " +
        "ለእያንዳንዱ መልስ ማብራሪያ አለው። ከ9ኛ እስከ 12ኛ ክፍል።",
    },
    schemaType: "WebPage",
  },
  {
    slug: "ethiopian-education",
    title: "Ethiopian Education Online – Curriculum, Textbooks & Learning for Grades 9–12",
    description:
      "Abugida brings Ethiopian education online: the national curriculum textbooks for Grades 9–12, chapter quizzes, " +
      "national exam practice, an AI tutor, classroom tools for Grades 1–8 and tools for schools — in English and Amharic.",
    keywords: [
      "Ethiopia education", "Ethiopian education", "education in Ethiopia", "Ethiopian education system",
      "Ethiopian curriculum", "new Ethiopian curriculum", "Ethiopian national curriculum", "Ethiopian textbooks",
      "Ethiopian student textbook", "Ethiopian teacher guide", "Ministry of Education Ethiopia", "MoE Ethiopia",
      "Ethiopian school", "Ethiopian students", "online learning Ethiopia", "e-learning Ethiopia", "edtech Ethiopia",
      "distance learning Ethiopia", "Ethiopian high school", "Ethiopian primary school", "Ethiopian secondary school",
      "grade 1 to grade 12 Ethiopia", "learning app Ethiopia", "education app Ethiopia", "Addis Ababa school",
      "Amharic learning", "ትምህርት", "የኢትዮጵያ ትምህርት", "ሥርዓተ ትምህርት", "መማሪያ መጽሐፍ", "ትምህርት ቤት", "ተማሪ", "መምህር",
    ],
    navLabel: "Ethiopian education",
    summary: "The national curriculum online for Grades 9–12 students, their teachers and schools.",
    eyebrow: "Grades 9–12 · English & Amharic",
    h1: "Ethiopian education, online — for students, teachers and schools",
    intro:
      "Abugida is an Ethiopian learning platform built around the national curriculum. Students read and practise from " +
      "their own textbooks, teachers run lessons and set work, and schools follow every class — on any phone or computer.",
    sections: [
      {
        heading: "Built on the Ethiopian national curriculum",
        paragraphs: [
          "Content follows the Ministry of Education textbooks for each grade, organised the Ethiopian way: primary " +
            "(Grades 1–6), middle (Grades 7–8, with the Grade 8 regional exam) and secondary (Grades 9–12, ending in the " +
            "Grade 12 national exam). Students can always revise the earlier grades of their cycle.",
        ],
      },
      {
        heading: "For students",
        bullets: [
          "Chapter quizzes with explanations, from their own textbooks.",
          "Past national exam papers with timed and practice modes.",
          "An AI tutor, a grapher and 3D geometry tools.",
          "Battles, a daily challenge, streaks, rankings and rewards.",
          "A library to read textbooks in the app.",
        ],
      },
      {
        heading: "For teachers and schools",
        bullets: [
          "Classroom games for Grades 1–8 and homework and tests for Grades 9–12.",
          "Per-student and per-class progress.",
          "An AI teaching assistant for notes, worksheets and papers.",
          "School accounts for students and staff, managed by the school's own administrators.",
        ],
      },
    ],
    faqs: [
      {
        q: "What is Abugida?",
        a: "An online learning platform for Ethiopian students, teachers and schools, built on the national curriculum — student accounts for Grades 9–12, classroom tools for Grades 1–8.",
      },
      {
        q: "Does Abugida follow the new Ethiopian curriculum?",
        a: "Yes. It uses the national curriculum textbooks for each grade, chapter by chapter.",
      },
      {
        q: "Is it available in Amharic?",
        a: "Yes. The app works in English and Amharic.",
      },
      {
        q: "Can a whole school use it?",
        a: "Yes. Schools register their students and teachers, and school administrators see progress across every class.",
      },
    ],
    amharic: {
      heading: "የኢትዮጵያ ትምህርት በኦንላይን",
      text:
        "አቡጊዳ በኢትዮጵያ ብሔራዊ ሥርዓተ ትምህርት ላይ የተመሠረተ የመማሪያ መድረክ ነው። ተማሪዎች ከመማሪያ መጽሐፋቸው ያነባሉ፣ ይለማመዳሉ፤ " +
        "መምህራን ትምህርት ያቀርባሉ፣ የቤት ስራ ይሰጣሉ፤ ትምህርት ቤቶች የእያንዳንዱን ክፍል እድገት ይከታተላሉ። ተማሪዎች ከ9ኛ እስከ 12ኛ ክፍል፣ " +
        "በእንግሊዝኛና በአማርኛ።",
    },
    schemaType: "AboutPage",
  },
];

export function topicPage(slug: string): TopicPage {
  const page = TOPIC_PAGES.find((p) => p.slug === slug);
  if (!page) throw new Error(`Unknown topic page: ${slug}`);
  return page;
}
