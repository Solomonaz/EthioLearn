"use client";

import { useTranslations } from "next-intl";
import { PRIMARY_MAX_GRADE, STUDENT_GRADES } from "@/lib/teacher-band";

/**
 * The <option>s for a student's grade at sign-up, grouped by what each band
 * opens: grades 1-8 the learning games (/play), grades 9-12 textbook practice
 * (/student). Render inside a <select> after its placeholder option.
 */
export function GradeOptions() {
  const t = useTranslations("auth");
  const elementary = STUDENT_GRADES.filter((g) => g <= PRIMARY_MAX_GRADE);
  const secondary = STUDENT_GRADES.filter((g) => g > PRIMARY_MAX_GRADE);
  return (
    <>
      <optgroup label={t("gradeGroupElementary")}>
        {elementary.map((g) => (
          <option key={g} value={g}>
            {t("gradeN", { grade: g })}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("gradeGroupSecondary")}>
        {secondary.map((g) => (
          <option key={g} value={g}>
            {t("gradeN", { grade: g })}
          </option>
        ))}
      </optgroup>
    </>
  );
}
