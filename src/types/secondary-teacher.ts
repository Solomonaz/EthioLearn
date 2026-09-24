/**
 * Shapes returned by /api/secondary-teacher/classes.
 *
 * One `ClassInsight` per class the teacher holds — a (subject, grade, section)
 * triple. The class is the unit of this surface, never the teacher as a whole
 * and never a whole grade: a grade can run twenty sections.
 */

export interface WeakChapter {
  id: string;
  title: string;
  chapterNumber: number;
  answered: number;
  /** 0-1. */
  accuracy: number;
}

export interface ClassStudent {
  id: string;
  name: string;
  section: string | null;
  lastActiveAt: string | null;
  answered: number;
  /** 0-1, or null when the student has not answered anything in the window. */
  accuracy: number | null;
  /** Published work this teacher set the class in the window, and how much is done. */
  workAssigned: number;
  workDone: number;
  /** Marked written work with a score, and its average (0-1, or null). */
  markedCount: number;
  markedAverage: number | null;
}

export interface ClassInsight {
  /** The TeachingAssignment id for this class. */
  id: string;
  subject: string;
  grade: number;
  /** The section taught. Null on legacy rows, meaning every section. */
  section: string | null;
  /** Students in this grade AND section at the teacher's school. */
  studentCount: number;
  /** Of those, how many answered anything in this subject in the window. */
  activeStudents: number;
  answered: number;
  /** 0-1, or null when nothing has been answered. */
  accuracy: number | null;
  weakChapters: WeakChapter[];
  students: ClassStudent[];
}

export interface ClassesResponse {
  school: { id: string };
  classes: ClassInsight[];
  windowDays: number;
}
