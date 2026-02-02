import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage";
import "../styles/public.css";

export default function PublicDonate() {
  const { campaignId } = useParams();

  const [campaign, setCampaign] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  // Load campaign + athletes
  useEffect(() => {
    async function load() {
      try {
        const cRef = doc(db, "campaigns", campaignId);
        const cSnap = await getDoc(cRef);

        if (!cSnap.exists()) {
          setError("Campaign not found.");
          setLoading(false);
          return;
        }

        const data = cSnap.data();
        setCampaign(data);

        // Load athletes assigned to this campaign
        const aRef = collection(db, "athletes");
        const aSnap = await getDocs(aRef);

        const list = aSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => a.campaignId === campaignId);

        setAthletes(list);
        setLoading(false);
      } catch (err) {
        console.error("PublicDonate load error:", err);
        setError("Error loading donation form.");
        setLoading(false);
      }
    }

    load();
  }, [campaignId]);

  async function startCheckout() {
    setError("");

    if (!amount) {
      setError("Please enter a donation amount.");
      return;
    }

    setProcessing(true);

    try {
      const res = await fetch(
        "https://us-central1-fundraising-mvp.cloudfunctions.net/createCheckoutSession",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: Number(amount),
            campaignId,
            athleteId,
            donorName,
            donorEmail,
          }),
        }
      );

      const data = await res.json();

      if (data?.url) {
        window.location.href = data.url;
      } else {
        setError("Could not start checkout session.");
        setProcessing(false);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setError("Checkout failed.");
      setProcessing(false);
    }
  }

  if (loading) return <div className="public-loading">Loading…</div>;
  if (error) return <div className="public-error">{error}</div>;

  return (
    <div className="public-container">
      <h1>Support {campaign.title}</h1>

      <img
        className="public-cover"
        src={safeImageURL(campaign.coverImage)}
        alt="Campaign Cover"
      />

      <div className="public-donate-box">
        <label>Donation Amount ($)</label>
        <input
          type="number"
          className="public-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="50"
        />

        <label>Your Name (optional)</label>
        <input
          type="text"
          className="public-input"
          value={donorName}
          onChange={(e) => setDonorName(e.target.value)}
        />

        <label>Your Email (for receipt)</label>
        <input
          type="email"
          className="public-input"
          value={donorEmail}
          onChange={(e) => setDonorEmail(e.target.value)}
          placeholder="you@example.com"
        />

        {athletes.length > 0 && (
          <>
            <label>Support a specific athlete (optional)</label>
            <select
              className="public-input"
              value={athleteId}
              onChange={(e) => setAthleteId(e.target.value)}
            >
              <option value="">No preference</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          className="public-donate-btn"
          onClick={startCheckout}
          disabled={processing}
        >
          {processing ? "Processing…" : "Donate Now"}
        </button>

        {error && <p className="public-error">{error}</p>}
      </div>
    </div>
  );
}
