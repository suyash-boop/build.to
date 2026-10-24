import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/shell/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const email = site.contactEmail;
  return (
    <LegalPage title="Privacy Policy" effective={site.policyDate}>
      <p>
        This policy explains what information bld.t collects, why, who can see it, and how you control it. bld.t is operated by{" "}
        {site.legalName} (&quot;we&quot;). Questions go to <a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a>.
      </p>

      <LegalSection title="Information you give us">
        <ul>
          <li><strong>Account details from GitHub.</strong> When you sign in we receive your GitHub user id, username, display name, avatar, bio, location, website, and your public or primary verified email address.</li>
          <li><strong>Profile details you add.</strong> Headline, bio, location, website, focus areas, and whether you are open to work.</li>
          <li><strong>Work you create.</strong> Projects, tasks, milestones, comments, releases you record, invitations, and join requests.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Information from connected repositories">
        <p>
          bld.t reads repositories only after you install the bld.t GitHub App and select them. Access is read-only. For those repositories we store:
        </p>
        <ul>
          <li>Repository metadata: name, owner, description, visibility, default branch, topics, star count, language byte counts, and the README.</li>
          <li>Pull request metadata: number, title, state, branch name, author, size, and timestamps. Pull request descriptions are read to find task references and are not stored.</li>
          <li>Per-person contribution statistics: commit counts, lines added and removed, pull requests opened and merged, and reviews.</li>
          <li>Releases (name, tag, notes) and deployments (environment, status, URL, commit).</li>
          <li>The list of technologies detected from dependency manifests and configuration files. File contents are read for detection and not stored.</li>
        </ul>
        <p>We do not store your source code.</p>
      </LegalSection>

      <LegalSection title="Information collected automatically">
        <ul>
          <li><strong>Sessions.</strong> When you sign in we record the device&apos;s IP address, user agent, and last activity time so you can review and sign out sessions in Settings.</li>
          <li><strong>Audit records.</strong> Administrative project changes (visibility, roles, integrations, deletion) are logged with the acting account and IP address.</li>
          <li><strong>Service logs.</strong> Our servers log requests (path, status, timing, IP address) to operate and secure the service. Cookies and authorization headers are redacted from logs.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>bld.t uses only these cookies, all first-party:</p>
        <ul>
          <li><strong>BetterAuth session cookies</strong> keep you signed in across the community and project workspace. They are HTTP-only and are verified by the shared build.to sign-in service.</li>
          <li><strong>bldt_oauth</strong> protects the GitHub sign-in flow. Signed, expires after 10 minutes.</li>
          <li><strong>theme</strong> remembers your light or dark preference across both parts of build.to.</li>
        </ul>
        <p>We do not use advertising or third-party analytics cookies.</p>
      </LegalSection>

      <LegalSection title="Who can see your information">
        <ul>
          <li><strong>Public projects</strong> and your profile are visible to anyone, including people who are not signed in.</li>
          <li><strong>Unlisted projects</strong> are visible to anyone with the link and are excluded from discovery, search, and search engine indexing.</li>
          <li><strong>Private projects</strong> are visible only to their members. On your public profile they appear only as an anonymous count of projects and merged pull requests.</li>
          <li>Task boards, discussions, and private repository details are visible only to project members, regardless of project visibility.</li>
          <li>You can hide any project from your profile entirely in Settings.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>
          To run bld.t: authenticate you, sync your repositories, link pull requests to tasks, build project timelines and profiles, send in-app
          notifications, keep the service secure, and fix problems. We do not sell personal information and do not use it for advertising.
        </p>
      </LegalSection>

      <LegalSection title="AI summaries">
        <p>
          Project members can ask bld.t to write a status brief or draft release notes. Only when someone does, the relevant project data (name,
          README or description, milestones, task titles and assignees, pull request titles and authors, and releases) is sent to Anthropic, which
          generates the text. Anthropic processes it as our service provider under its commercial terms, which do not allow it to train models on
          this data. Briefs are stored with the project and shown only to its members. Nothing is sent when these features are not used.
        </p>
      </LegalSection>

      <LegalSection title="Work records">
        <p>
          You can issue a signed work record about your own work on a project. It contains your name, username, linked GitHub login, role, the
          period, and counts and titles of your merged pull requests and completed tasks (counts only for private projects). Anyone with its link can
          view it. You can revoke a record at any time, and records are deleted with your account. Copies you have already shared stay
          cryptographically valid, because that is what makes them verifiable; after revocation or deletion, our verifier reports them as revoked or
          no longer registered.
        </p>
      </LegalSection>

      <LegalSection title="Webhooks">
        <p>
          Project owners and maintainers can add webhooks that send project events (such as task titles and assignees, pull request titles,
          releases, member names, and alerts) to a destination they choose, for example a Slack or Discord channel or their own server. That
          destination is chosen and controlled by the project, not by bld.t, and its own terms apply to what it receives. Webhooks only send
          events from projects whose maintainers set them up.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>
          We use infrastructure providers to host the application, database, and job queue, and GitHub to authenticate you and provide repository
          data. They process information on our behalf under contracts that restrict its use. A current list is available on request at{" "}
          <a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a>.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Traffic is encrypted in transit. GitHub access tokens are encrypted at rest with AES-256-GCM. Session tokens are stored only as one-way
          hashes. Access to every project resource is checked against your role on that project.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <ul>
          <li>Your account data is kept while your account is active.</li>
          <li>When you delete your account, we remove your profile details, sessions, GitHub tokens, and notifications, delete projects you own alone, and detach your name from contributions on shared projects. Residual copies in backups are overwritten on our normal backup cycle.</li>
          <li>Webhook delivery records, both those we receive from GitHub and those we send to project webhooks, are deleted after 30 days and expired sessions after 7 days. Service logs are kept for a limited period for debugging and security.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <ul>
          <li><strong>Access and portability:</strong> download a JSON export of your data from Settings.</li>
          <li><strong>Correction:</strong> edit your profile at any time.</li>
          <li><strong>Deletion:</strong> delete your account from Settings.</li>
          <li><strong>Revoking repository access:</strong> remove repositories or uninstall the bld.t GitHub App on GitHub at any time.</li>
        </ul>
        <p>
          Depending on where you live you may have additional rights, such as objecting to processing or lodging a complaint with a data protection
          authority. Contact <a href={`mailto:${email}`} className="text-fg underline underline-offset-2">{email}</a> to exercise them.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>bld.t is not intended for anyone under 16, and we do not knowingly collect information from them.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we change this policy we will update the effective date above, and for material changes we will notify signed-in users in the app
          before they take effect.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
