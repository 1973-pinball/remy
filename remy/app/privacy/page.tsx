import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';

export const metadata: Metadata = {
  title: 'Privacy policy — Remy Mux',
  description: 'How Remy Mux collects, uses, stores and deletes nutrition and connected training data.',
};

export default function PrivacyPage() {
  return <main className="page-content privacy-page">
    <Brand />
    <article className="card privacy-policy">
      <header>
        <p className="eyebrow">YOUR DATA, IN CONTEXT</p>
        <h1>Privacy policy</h1>
        <p className="muted">Effective and last updated: October 7, 2026</p>
        <p>Remy Mux is a personal nutrition and running journal operated by the maintainer of the <a href="https://github.com/1973-pinball/remy">Remy Mux project</a>. The hosted application at <a href="https://remy-mux.vercel.app">remy-mux.vercel.app</a> is currently restricted to its configured owner. This policy describes that application, including optional WHOOP, Strava, Runna and Tredict connections. A connection only supplies data after it is configured and authorized.</p>
      </header>

      <section>
        <h2>Information the app handles</h2>
        <ul>
          <li><strong>Account and profile:</strong> sign-in email, account identifier, any supplied display name, timezone, weight, dietary preferences, calorie baseline, running goals and related profile information.</li>
          <li><strong>Nutrition and journal:</strong> meals, nutrient values, Eat to Live categories, timestamps, notes, logging status, journal-helper messages, corrections and revision history.</li>
          <li><strong>WHOOP, when authorized:</strong> cycle, recovery and sleep records, including estimated energy expenditure, strain, recovery scores, heart-rate variability, resting heart rate, sleep timing and duration, identifiers and other fields returned in those API responses.</li>
          <li><strong>Other connected sources:</strong> completed running activities from Strava or optional Tredict, and planned sessions from a Runna calendar. Records can include activity names, dates, distances, durations, heart rate, elevation, descriptions and source identifiers. Original activity responses or uploaded files can also contain route or location information, even when the interface shows only headline numbers.</li>
          <li><strong>Imports and connection details:</strong> selected ChatGPT conversation exports, structured nutrition records, activity or calendar files you submit, retained original import files, access and refresh tokens, private calendar addresses, and synchronization status.</li>
          <li><strong>Technical information:</strong> authentication and interface cookies, browser-stored drafts, and request or error information used to operate the service. Hosting providers may process IP addresses, browser information, request timestamps and security or diagnostic logs.</li>
        </ul>
      </section>

      <section>
        <h2>Why this information is used</h2>
        <p>The app uses this information to authenticate its owner, save and correct journal records, import authorized activity and recovery data, calculate headline summaries, relate food intake to running goals and training, generate rule-based insights, and provide export, deletion and synchronization controls. Retained source records help reconcile repeated imports and preserve corrections.</p>
        <p>Remy Mux does not sell personal data, run advertising, or use connected health data to train AI models. The current journal helper and insights use application rules; the deployed app does not currently send journal or provider data to OpenAI or another external AI model. Nutrition and training information is not used to make medical, insurance or employment decisions.</p>
      </section>

      <section>
        <h2>WHOOP access and your choices</h2>
        <p>Connecting WHOOP requests read access to cycles, recovery and sleep, plus offline access so the server can refresh authorization and synchronize while the app is closed. Remy Mux does not request permission to change your WHOOP records and does not receive your WHOOP password.</p>
        <p>You can decline authorization. In <Link href="/?view=Connections">Connections</Link>, you can disconnect a source to stop future Remy Mux synchronization and remove its saved credentials. Disconnecting keeps previously imported journal history. To withdraw the provider-side authorization as well, revoke Remy Mux in the provider&apos;s connected-app settings. Use the journal deletion controls described below to remove data already stored in Remy Mux.</p>
      </section>

      <section>
        <h2>Storage, service providers and access</h2>
        <p><a href="https://vercel.com/legal/privacy-policy">Vercel</a> hosts the website and server functions. <a href="https://supabase.com/privacy">Supabase</a> provides authentication, the database and private file storage. They process information needed to provide those services under their own policies. Connected providers receive authorization and synchronization requests; logging a meal does not publish it to those providers.</p>
        <p>The hosted Supabase database is in the United States. Service providers may process operational information in other locations. HTTPS protects data in transit. Access to the journal is restricted by server-side owner checks and database access policies. Saved provider credentials and private feed addresses are encrypted by the application before storage. Ordinary journal records are not end-to-end encrypted: the application&apos;s server and its authorized infrastructure administrators can access them to operate the service.</p>
        <p>The source-code repository is public. Your journal, private imports and credentials are not published to it by the app. Remy Mux has no public journal-sharing feature. Information may also need to be disclosed when required by applicable law or to respond to a security incident.</p>
      </section>

      <section>
        <h2>Cookies and information on your device</h2>
        <p>Authentication cookies keep you signed in; a preference cookie remembers the sidebar state. The app does not install advertising or third-party analytics trackers. Offline meal drafts are stored in this browser&apos;s local storage. Signing out hides owner drafts in the app but does not erase those stored drafts. Clear this site&apos;s browser storage to remove them from the device.</p>
        <p>The service worker caches a small offline page and icon. It does not cache authenticated journal pages or API responses. Exported files that you download are separate copies under your control.</p>
      </section>

      <section>
        <h2>Retention, export and deletion</h2>
        <p>Saved records, revisions and original imports remain until deleted; the app has no automatic age-based deletion schedule. A rolling synchronization window limits what the app requests from a source, not how long it retains previously imported records. Individual record deletions can retain revision history for correction or undo.</p>
        <p>In <Link href="/?view=Settings">Your profile</Link>, you can export journal records and revision history. The export lists original-file paths but does not include those files&apos; contents or provider credentials. <strong>Delete all journal data</strong> removes stored journal records, revisions, original imports and saved connection credentials from the active application stores. It stops sources from repopulating the journal until explicitly reconnected.</p>
        <p>That action does not delete your Supabase sign-in account, minimal metadata used to prevent stale writes, provider accounts, browser drafts, or copies you downloaded. The operator can remove the sign-in account separately through Supabase administration. Infrastructure logs or backup copies, if any, are subject to the service providers&apos; retention practices; the app does not promise their immediate erasure.</p>
      </section>

      <section>
        <h2>Contact and changes</h2>
        <p>For policy questions, access or deletion assistance, contact the Remy Mux operator at <a href="mailto:info.studio.pinball@gmail.com">info.studio.pinball@gmail.com</a>. Describe your request without sending passwords, API tokens or complete health exports; any additional information needed to verify or handle the request can be arranged privately.</p>
        <p>Changes to these practices will be reflected on this page with an updated date. If the application adds external AI processing, additional data sources or broader account access, this policy should be reviewed before those features are enabled.</p>
      </section>
    </article>
    <p className="privacy-back"><Link href="/">← Back to Remy Mux</Link></p>
  </main>;
}
