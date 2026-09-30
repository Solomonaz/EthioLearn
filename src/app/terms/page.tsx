import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service",
  description: "The terms for using Abugida, the learning platform for Ethiopian students, teachers and schools.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply to everyone who uses Abugida — students, teachers, school
        administrators and schools. By using Abugida you agree to them. Questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>Keep your password private. You are responsible for what happens under your account.</li>
        <li>Teachers and school administrators are added by their school or by Abugida, not by signing up themselves.</li>
        <li>Students under 18 should use Abugida with a parent’s, guardian’s or school’s permission.</li>
        <li>Tell us or your school straight away if you think someone else is using your account.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not:</p>
      <ul>
        <li>share or upload content that is illegal, harmful, hateful or that you do not have the right to use;</li>
        <li>cheat, or try to manipulate points, rankings or rewards;</li>
        <li>access other people’s accounts or data, or interfere with the service;</li>
        <li>copy or resell the service or its content without permission.</li>
      </ul>
      <p>We may suspend accounts that break these rules.</p>

      <h2>Content</h2>
      <ul>
        <li>Schools and teachers keep ownership of the materials they upload, and allow us to store and process them to provide the service to them and their students.</li>
        <li>Students keep ownership of the work they submit.</li>
        <li>
          Some content — quiz questions, explanations and tutor answers — is produced by AI. We
          check it, but it can contain mistakes. Use it as a learning aid, and rely on your
          teacher and official textbooks for anything important.
        </li>
      </ul>

      <h2>Schools and payment</h2>
      <p>
        Schools use Abugida under a subscription agreed with us. Features, prices and the
        number of teachers covered depend on the school’s plan. If a subscription ends, some
        features (such as AI tools for teachers) may stop until it is renewed.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Abugida available and reliable, but we cannot promise it will always be
        uninterrupted or error-free. We may change or improve features over time.
      </p>

      <h2>Liability</h2>
      <p>
        Abugida is provided “as is”. To the extent the law allows, we are not responsible for
        indirect losses, or for decisions made solely on AI-generated content.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using Abugida at any time and ask us to delete your account. Our{" "}
        <a href="/privacy">Privacy Policy</a> explains how we handle your information.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We will change the date at the top of this page and, for
        significant changes, let users know in the app.
      </p>
    </LegalPage>
  );
}
