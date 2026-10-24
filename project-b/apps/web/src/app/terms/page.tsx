import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/shell/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  const email = site.contactEmail;
  return (
    <LegalPage title="Terms and Conditions" effective={site.policyDate}>
      <p>
        These terms govern your use of bld.t, operated by {site.legalName} (&quot;we&quot;). By creating an account or using the service you agree
        to them. If you use bld.t on behalf of an organization, you confirm you are authorized to accept these terms for it.
      </p>

      <LegalSection title="Your account">
        <ul>
          <li>You sign in with a GitHub account and must be at least 16 years old.</li>
          <li>You are responsible for activity on your account. Tell us promptly at <a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a> if you believe it has been compromised.</li>
          <li>Usernames must not impersonate others or infringe trademarks. We may reclaim usernames that do.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You keep ownership of everything you add to bld.t: project descriptions, tasks, comments, release notes, and profile details. You grant us
          a worldwide, non-exclusive, royalty-free license to host, store, copy, and display that content only as needed to operate the service and
          according to the visibility you choose. The license ends when you delete the content or your account, except for copies other members
          already rely on in shared project history and residual backups.
        </p>
        <p>You confirm you have the right to share what you post and to connect the repositories you connect.</p>
      </LegalSection>

      <LegalSection title="GitHub integration">
        <p>
          Connecting repositories requires installing the bld.t GitHub App, which has read-only access to the repositories you select. Your use of
          GitHub remains subject to GitHub&apos;s own terms. Information shown on bld.t that comes from GitHub is marked as such; we do not guarantee it
          is complete or current, for example if GitHub is unavailable or access is revoked.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Misrepresent your work or other people&apos;s, including fabricating contributions, releases, or endorsements.</li>
          <li>Access projects, data, or accounts you are not authorized to access, or probe, scan, or test the service&apos;s security without our written permission.</li>
          <li>Interfere with the service, including through automated requests that exceed published rate limits.</li>
          <li>Post content that is unlawful, harassing, or infringes others&apos; rights, or use bld.t to send spam.</li>
        </ul>
        <p>Security researchers can report vulnerabilities to <a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a>.</p>
      </LegalSection>

      <LegalSection title="Privacy">
        <p>
          How we handle personal information is described in the <Link href="/privacy" className="text-fg underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Changes to the service">
        <p>
          We may add, change, or remove features. If we make a change that materially reduces what you can do, we will give reasonable notice in the
          app where practical.
        </p>
      </LegalSection>

      <LegalSection title="Suspension and termination">
        <p>
          You can stop using bld.t and delete your account at any time from Settings. We may suspend or close accounts that violate these terms or
          put the service or other users at risk. Where reasonable we will explain why and give you a chance to export your data first.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers">
        <p>
          bld.t is provided &quot;as is&quot; and &quot;as available&quot;. To the extent permitted by law we disclaim implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement. We do not warrant that the service will be uninterrupted or error-free.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost
          profits, data, or goodwill. Our total liability for any claim relating to the service is limited to the greater of the amount you paid us
          in the twelve months before the claim and one hundred US dollars. Nothing in these terms limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of {site.governingLaw}, without regard to conflict of law rules.</p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We will update the effective date when these terms change and notify signed-in users of material changes before they take effect.
          Continuing to use bld.t after that means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p><a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a></p>
      </LegalSection>
    </LegalPage>
  );
}
