import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage.js";
import "../styles/public.css";

export default function PublicAthlete() {
  const athleteId = window.location.pathname.split("/athlete/")[1];

  const [athlete, setAthlete] = useState(null);
  const [team, setTeam] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    async function load() {
      try {
        const ref = doc(db, "athletes", athleteId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setStatus("not-found");
          return;
        }

        const data = snap.data();
        setAthlete(data);

        if (data.teamId) {
          const t = await getDoc(doc(db, "teams", data.teamId));
          if (t.exists()) setTeam(t.data());
        }

        if (data.campaignId) {
          const c = await getDoc(doc(db, "campaigns", data.campaignId));
          if (c.exists()) setCampaign(c.data());
        }

        setStatus("loaded");
      } catch (err) {
        console.error("PublicAthlete load error:", err);
        setStatus("error");
      }
    }

    load();
  }, [athleteId]);

  if (!athlete) return <div className="public-loading">Loading…</div>;

  return (
    <div className="public-container">
      <h1>{athlete.name}</h1>

      {team && <h2>{team.name}</h2>}
      {campaign && (
        <a className="public-donate-btn" href={`/donate/${campaign.id}`}>
          Donate to Their Campaign
        </a>
      )}

      <img
        className="public-cover"
        src={safeImageURL(athlete.photoURL)}
        alt={athlete.name}
      />

      <p className="public-description">{athlete.bio}</p>
    </div>
  );
}
