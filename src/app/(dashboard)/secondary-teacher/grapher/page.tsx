/**
 * Graphing calculator for teachers.
 *
 * The same tool students use — re-exported rather than copied so the two can
 * never drift. The page gates on the `mathTools` entitlement, which is true
 * for every non-student role, and all /api/graph/* routes already accept any
 * signed-in user, so nothing else had to change.
 */
export { default } from "../../student/grapher/page";
