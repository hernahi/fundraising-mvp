import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";

const POLL_INTERVAL_MS = 2000; // 2 seconds
const MAX_ATTEMPTS = 10;       // ~20 seconds total

export default function DonateSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");

  const [loading, setLoading] = useState(true);
  const [donation, setDonation] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    let attempts = 0;
    let timer = null;

    async function pollDonation() {
      try {
        const ref = doc(db, "donations", sessionId);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setDonation(snap.data());
          setLoading(false);
          return; // ✅ stop polling
        }

        attempts += 1;

        if (attempts >= MAX_ATTEMPTS) {
          console.warn("Donation not found after polling timeout");
          setLoading(false);
          return;
        }

        timer = setTimeout(pollDonation, POLL_INTERVAL_MS);
      } catch (err) {
        const code = err?.code || "";
        const retryable = code === "permission-denied" || code === "not-found";

        if (!retryable) {
          console.error("Failed to load donation:", err);
          setLoading(false);
          return;
        }

        attempts += 1;

        if (attempts >= MAX_ATTEMPTS) {
          console.warn("Donation not accessible after polling timeout");
          setLoading(false);
          return;
        }

        timer = setTimeout(pollDonation, POLL_INTERVAL_MS);
      }
    }

    pollDonation();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p>Confirming your donation…</p>
      </div>
    );
  }

  // Webhook may still be processing
  if (!donation) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center">
        <h1 className="text-xl font-semibold">Thank you!</h1>
        <p className="mt-2 text-gray-600">
          Your donation is being processed.  
          You will receive a confirmation email shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-8 text-center">
      <h1 className="text-2xl font-bold text-green-600">
        Thank you for your donation!
      </h1>

      <p className="mt-4">
        {donation.donorName
          ? `Thank you, ${donation.donorName}!`
          : "We appreciate your support."}
      </p>

      <p className="mt-2 text-gray-700">
        Amount donated:{" "}
        <strong>${(donation.amount / 100).toFixed(2)}</strong>
      </p>

      <div className="mt-6">
        <Link
          to={`/donate/${donation.campaignId}`}
          className="text-blue-600 underline"
        >
          Back to campaign
        </Link>
      </div>
    </div>
  );
}
