import { Link } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";

export default function HelpCenter() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> Back to Dashboard
      </Link>

      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
          Help Center
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Quick guidance for the core workflows in Fundraising MVP.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Teams</h2>
          <p className="mt-2 text-sm text-slate-600">
            Create a team first, then onboard athletes from the team page so
            invites carry the correct context.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Athlete Onboarding</h2>
          <p className="mt-2 text-sm text-slate-600">
            Use Athlete Onboarding to invite athletes by email and optionally
            attach campaign context.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Campaigns</h2>
          <p className="mt-2 text-sm text-slate-600">
            Build campaigns after teams exist. From Campaign Detail, use the
            athlete onboarding shortcut to add athletes into that campaign flow.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Messages & Drip</h2>
          <p className="mt-2 text-sm text-slate-600">
            Athletes manage contacts and outbound messaging from Messages.
            Organization-level drip settings live in Settings.
          </p>
        </section>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        This page is intentionally lightweight for now. We can expand it into a
        fuller product guide with screenshots, FAQs, and role-specific help.
      </div>
    </div>
  );
}

