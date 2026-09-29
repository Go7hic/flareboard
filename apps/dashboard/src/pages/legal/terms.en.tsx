import { Link } from 'react-router-dom';
import type { LegalDoc, LegalSection } from '../../components/landing/LegalPage';
import { Mail, UPDATED } from './shared';

/* Plan prices and limits live on /pricing; keep them out of this text so it does not drift. */
const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement',
    body: (
      <>
        <p>
          These Terms of Service (“Terms”) govern your use of the hosted Flareboard service at{' '}
          <code>flareboard.dev</code>, including the website, dashboard, APIs, tracking script and related services
          (the “Service”). The Service is operated by an independent developer (“Flareboard”, “we”, “us”).
        </p>
        <p>
          By creating an account or using the Service you agree to these Terms and to our{' '}
          <Link to="/privacy">Privacy Policy</Link>. If you use the Service on behalf of an organization, you
          confirm that you are authorized to accept these Terms for it, and “you” includes that organization. If
          you do not agree, do not use the Service.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'The Service',
    body: (
      <>
        <p>
          Flareboard provides website and product analytics, including event tracking, dashboards and reports,
          session replay, heatmaps, feature flags, experiments, surveys, error and log monitoring, workflows and
          related tools. Features available to you depend on your plan.
        </p>
        <p>
          The Service is under active development. We may add, change or remove features, and features labeled
          beta or preview may be less reliable than the rest of the Service.
        </p>
        <p>
          The Flareboard source code is made available separately under its own license (see our GitHub
          repository). Running your own copy of Flareboard is governed by that license, not by these Terms.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <ul>
        <li>You must be at least 16 years old and able to form a binding contract to use the Service.</li>
        <li>Give us accurate information and keep your email address up to date.</li>
        <li>
          Keep your password secure and do not share your login. You are responsible for all activity under your
          account and for the actions of any team members you invite.
        </li>
        <li>
          If you turn on two-factor authentication, keep your recovery codes somewhere safe. If you lose both your
          authenticator and your recovery codes we may be unable to restore access, and we may ask for proof that
          the account is yours before we try. Team owners can require two-factor authentication for their team;
          members who have not turned it on cannot use the team’s resources until they do.
        </li>
        <li>
          Tell us promptly at <Mail /> if you believe your account has been compromised.
        </li>
      </ul>
    ),
  },
  {
    id: 'plans-billing',
    title: 'Plans, billing and cancellation',
    body: (
      <>
        <p>
          We offer a free plan and paid plans. Current prices, usage limits and included features are shown on our{' '}
          <Link to="/pricing">Pricing page</Link> and at checkout.
        </p>
        <ul>
          <li>
            <strong>Payment.</strong> Paid plans are billed in advance each month through our payment processor,
            Stripe, and renew automatically until cancelled. Prices exclude taxes, which you are responsible for
            where applicable.
          </li>
          <li>
            <strong>Usage limits.</strong> Each plan includes a monthly event allowance. Events sent after you reach
            it are not recorded for the rest of that month; upgrade your plan to avoid gaps in your data. Plans
            advertised as unlimited in some dimension (such as websites) are subject to reasonable fair-use limits
            that protect the Service for everyone.
          </li>
          <li>
            <strong>Cancellation.</strong> You can cancel at any time from the billing page. Cancellation takes
            effect at the end of the current billing period, after which your account moves to the free plan.
            Features not included in the free plan stop working, but your data is not deleted because of the
            downgrade.
          </li>
          <li>
            <strong>Refunds.</strong> Fees are non-refundable, including for partial months, except where required
            by law or where we discontinue a paid service as described in{' '}
            <a href="#availability">Availability and changes</a>.
          </li>
          <li>
            <strong>Failed payments.</strong> If a payment fails and is not resolved, your subscription may be
            cancelled and your account moved to the free plan.
          </li>
          <li>
            <strong>Price changes.</strong> We will give you at least 30 days’ notice of a price increase. It
            applies from your next billing period after the notice period, and you can cancel before it takes
            effect. Introductory or promotional prices apply for the period stated in the offer.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'your-data',
    title: 'Your data',
    body: (
      <>
        <p>
          “Customer Data” means the data you or your websites and apps send to the Service, including analytics
          data about your visitors, and the content you create in the dashboard. You retain all rights to Customer
          Data. You grant us a limited license to host, process and display Customer Data only as needed to
          provide, secure and support the Service for you.
        </p>
        <p>You are responsible for:</p>
        <ul>
          <li>
            Having a lawful basis to collect and share Customer Data, and giving your visitors any notices and
            obtaining any consents required by law in the places where you operate, including under privacy,
            electronic communications and consumer protection laws.
          </li>
          <li>
            Not sending us sensitive data through custom events, user properties, logs, errors or session replay,
            including passwords, payment card numbers, government identification numbers, health data, other
            special categories of personal data, or data about children under 16.
          </li>
          <li>
            Configuring session replay, if you enable it, so that sensitive information shown or entered on your
            pages is excluded from recordings.
          </li>
          <li>Keeping your own copies of Customer Data you need. The Service is not a backup system.</li>
        </ul>
        <p>
          You can export analytics data on plans that include export. You can delete websites or your whole account
          from the dashboard at any time, or ask us to delete Customer Data by emailing <Mail />.
        </p>
      </>
    ),
  },
  {
    id: 'data-processing',
    title: 'Data processing terms',
    body: (
      <>
        <p>
          When Customer Data includes personal data, you are the controller and we are your processor (or service
          provider). This section forms our data processing agreement with you and applies in addition to the rest
          of these Terms. We will:
        </p>
        <ul>
          <li>
            Process personal data only to provide the Service and on your documented instructions, which are these
            Terms and your use and configuration of the Service, unless the law requires otherwise, in which case
            we will tell you first where the law allows.
          </li>
          <li>Never sell personal data or use it for advertising or for our own purposes.</li>
          <li>Ensure anyone authorized to process it is bound by confidentiality.</li>
          <li>
            Maintain appropriate technical and organizational security measures, as described in our{' '}
            <Link to="/privacy#security">Privacy Policy</Link>.
          </li>
          <li>
            Use only the subprocessors listed in our <Link to="/privacy#sharing">Privacy Policy</Link>, bind them to
            data protection obligations at least as protective as these, and give notice of new subprocessors by
            updating that list at least 14 days in advance. You may object on reasonable grounds and, if we cannot
            address the objection, cancel your subscription.
          </li>
          <li>
            Help you respond to requests from individuals exercising their rights and with data protection impact
            assessments, taking into account the nature of the processing.
          </li>
          <li>
            Notify you without undue delay, and where possible within 72 hours, after becoming aware of a personal
            data breach affecting your Customer Data.
          </li>
          <li>
            Delete Customer Data within 30 days after your account ends or on your request, except where the law
            requires us to keep it.
          </li>
          <li>
            Make available the information reasonably needed to demonstrate compliance with this section.
          </li>
        </ul>
        <p>
          Where personal data from the EEA, the UK or Switzerland is transferred to a country without an adequacy
          decision, the Standard Contractual Clauses adopted by the European Commission (Module 2 or 3, as
          applicable), with the UK Addendum where relevant, are incorporated into these Terms by reference.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for anything illegal, or to collect data in violation of applicable law.</li>
          <li>
            Install Flareboard on websites or apps you do not own or are not authorized to measure, or use it to
            track people across unrelated websites.
          </li>
          <li>Send malware, spam or abusive content, including through workflows, webhooks or email features.</li>
          <li>
            Interfere with or disrupt the Service, probe or test its security without our written permission,
            send traffic designed to exhaust its resources, or circumvent usage limits or access controls.
          </li>
          <li>
            Resell, sublicense or provide the hosted Service to third parties as a standalone service without our
            written agreement.
          </li>
          <li>Access the Service by automated means other than our documented APIs.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Share links and integrations',
    body: (
      <>
        <p>
          Public share links let anyone with the link see the dashboards and statistics you choose to share. You are
          responsible for what you share and with whom; revoke a link when it is no longer needed.
        </p>
        <p>
          When you connect webhooks, email destinations, data sources or other third-party services, you instruct
          us to send data to or receive data from them. Those services are governed by their own terms, and we are
          not responsible for them.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <>
        <p>
          We work to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free
          operation, and we do not offer a service level agreement unless agreed in writing. The Service may be
          unavailable during maintenance or because of events outside our control, and data sent during an outage
          may not be recorded.
        </p>
        <p>
          We may change or discontinue features. If we discontinue the paid Service as a whole, we will give at
          least 30 days’ notice, let you export your data, and refund any prepaid fees for the period after
          discontinuation.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    body: (
      <>
        <p>
          You may stop using the Service at any time and delete your account from the account menu in the
          dashboard, or ask us to close it by emailing <Mail />. Export anything you want to keep first: your
          account is closed immediately and its data is erased within 30 days.
        </p>
        <p>
          We may suspend or terminate your access if you materially breach these Terms, fail to pay, use the
          Service in a way that creates legal liability or risk for us or others, or if required by law. Where
          reasonable, we will notify you first and give you an opportunity to fix the problem.
        </p>
        <p>
          If we terminate your account, you can ask us to export your data within 30 days, after which we delete
          your account and Customer Data. Sections that by their nature should survive termination, including those on fees
          owed, disclaimers, limitation of liability, indemnity and governing law, will survive.
        </p>
      </>
    ),
  },
  {
    id: 'ip',
    title: 'Intellectual property and feedback',
    body: (
      <p>
        Except for Customer Data and rights granted in the source code license, the Service and the Flareboard
        name and logo belong to us. These Terms do not grant you any right to use our trademarks. If you send us
        feedback or suggestions, we may use them without obligation to you.
      </p>
    ),
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    body: (
      <p className="legal-caps">
        The Service is provided “as is” and “as available”. To the fullest extent permitted by law, we disclaim all
        warranties, express or implied, including warranties of merchantability, fitness for a particular purpose,
        accuracy and non-infringement. Analytics data is an estimate and may be incomplete; do not rely on it as
        the sole basis for decisions with legal, financial or safety consequences.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <>
        <p className="legal-caps">
          To the fullest extent permitted by law, we will not be liable for any indirect, incidental, special,
          consequential or punitive damages, or for any loss of profits, revenue, data or goodwill, arising out of
          or relating to the Service or these Terms, even if we have been advised of the possibility of such
          damages.
        </p>
        <p className="legal-caps">
          Our total liability for all claims arising out of or relating to the Service or these Terms is limited to
          the greater of the amounts you paid us for the Service in the 12 months before the event giving rise to
          the claim, or USD 100.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot be limited by law, such as liability for fraud or
          for death or personal injury caused by negligence.
        </p>
      </>
    ),
  },
  {
    id: 'indemnity',
    title: 'Indemnity',
    body: (
      <p>
        If you use the Service for business purposes, you will defend and indemnify us against third-party claims,
        and related losses and reasonable costs, arising from Customer Data, your collection of data from your
        visitors, or your breach of these Terms or applicable law.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: (
      <>
        <p>
          These Terms are governed by the laws of the Hong Kong Special Administrative Region, without regard to
          conflict of laws rules. The courts of Hong Kong have exclusive jurisdiction over any dispute arising out
          of or relating to these Terms or the Service.
        </p>
        <p>
          If you are a consumer, you keep the protection of any mandatory laws of the country where you live, and
          you may also bring proceedings in the courts there. Before starting proceedings, please contact us so we
          can try to resolve the issue informally.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these Terms',
    body: (
      <p>
        We may update these Terms. We will change the “Last updated” date above, and for material changes we will
        notify you by email or in the dashboard at least 14 days before they take effect. If you continue to use the
        Service after changes take effect, you accept the updated Terms; if you do not agree, you can close your
        account before then.
      </p>
    ),
  },
  {
    id: 'general',
    title: 'General',
    body: (
      <ul>
        <li>
          These Terms, together with the Privacy Policy and any order or plan details, are the entire agreement
          between you and us about the Service.
        </li>
        <li>If any provision is found unenforceable, the rest remains in effect.</li>
        <li>Our failure to enforce a provision is not a waiver of our right to do so later.</li>
        <li>
          You may not transfer these Terms without our consent. We may transfer them in connection with a sale or
          transfer of the Service, with notice to you.
        </li>
        <li>
          We are not responsible for delays or failures caused by events beyond our reasonable control.
        </li>
        <li>
          We may send notices to the email address on your account. You can send notices to us at <Mail />.
        </li>
        <li>
          These Terms are written in English. If we provide a translation, the English version prevails.
        </li>
      </ul>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these Terms: <Mail />.
      </p>
    ),
  },
];

export const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: UPDATED.en,
  intro: (
    <p>
      Please read these Terms carefully. They explain your rights and obligations when you use Flareboard,
      including important limits on our liability.
    </p>
  ),
  sections,
};
