import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description: "How Abugida collects, uses and protects personal information.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Abugida is a learning platform for Ethiopian students, teachers and schools. This
        policy explains what information we collect, why, who it is shared with, and the
        choices you have. If you have a question, contact us at{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, and — depending on how you sign in — your
          email address, a username issued by your school, or your Google or Telegram account
          identifier. Passwords are stored only in hashed (scrambled) form.
        </li>
        <li>
          <strong>School information:</strong> for students and staff added by a school — the
          school, grade, section and the classes a teacher teaches.
        </li>
        <li>
          <strong>Learning activity:</strong> quizzes taken and answers given, scores, points,
          progress, homework and files submitted to teachers, notes, and messages sent to the
          AI tutor or teaching assistant.
        </li>
        <li>
          <strong>Content uploaded by schools and teachers:</strong> textbooks, questions and
          teaching materials.
        </li>
        <li>
          <strong>Technical information:</strong> sign-in sessions (device type and times) to
          keep your account secure, and basic server logs. We do not use advertising or
          third-party analytics trackers.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: sign-in, quizzes, classroom tools, progress for students, teachers and schools.</li>
        <li>To generate learning content and answers with AI (see below).</li>
        <li>To keep accounts secure, prevent misuse and fix problems.</li>
        <li>To send service emails, such as password-reset links.</li>
      </ul>
      <p>We do not sell personal information and we do not use it for advertising.</p>

      <h2>Services we share information with</h2>
      <p>We use trusted providers to run Abugida. Each receives only what it needs:</p>
      <ul>
        <li><strong>OVHcloud</strong> (France) — hosts our servers and database.</li>
        <li>
          <strong>AI providers</strong> — Google (Gemini), Groq, NVIDIA and OpenRouter — receive
          the text needed to produce an answer, such as a question, a textbook passage or a
          tutor message. We do not add your name or contact details to these requests, but
          anything you type yourself is sent as written — so avoid putting personal details
          into questions for the AI.
        </li>
        <li><strong>Google</strong> and <strong>Telegram</strong> — only if you choose to sign in with them.</li>
        <li><strong>Resend</strong> — delivers service emails such as password-reset links.</li>
      </ul>
      <p>
        We may also disclose information if required by law, or to protect the safety of our
        users.
      </p>

      <h2>Students and children</h2>
      <p>
        Many Abugida users are school students, including children. When a school creates
        student accounts, the school decides what information to provide and is responsible
        for having the permission it needs from parents or guardians. Students who create their
        own account and are under 18 should do so with a parent’s or guardian’s permission.
        Teachers can see the progress of students in their own classes; students’ other
        subjects are not shown to them.
      </p>

      <h2>How long we keep information</h2>
      <p>
        We keep account information while the account is active. When an account or school is
        removed, its data is deleted from the live system; copies in our backups are removed as
        the backups expire, normally within 14 days. A school can ask us to delete its data at
        any time.
      </p>

      <h2>Security</h2>
      <p>
        Connections are encrypted (HTTPS), passwords are hashed, the database is not reachable
        from the internet, and access to the servers is restricted. No system is perfectly
        secure, but we work to protect your information and will act promptly on any problem.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can see and correct most of your details in your profile. You may ask us for a copy
        of your personal information, to correct it, or to delete your account, by emailing{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>. Students whose account
        was created by a school can also ask their school. We handle requests in line with
        applicable law, including Ethiopia’s Personal Data Protection Proclamation.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        We use a small number of essential cookies to keep you signed in, and your browser’s
        local storage to remember preferences such as light or dark mode and game scores. We do
        not use advertising cookies.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we will update the date at the top of this page and, for
        significant changes, let users know in the app.
      </p>
    </LegalPage>
  );
}
