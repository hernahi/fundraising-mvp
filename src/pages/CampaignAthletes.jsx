import { useEffect, useState } from "react";
import HeaderActions from "../components/HeaderActions";
import { useToast } from "../components/Toast";
import ListLoadingSpinner from "../components/ListLoadingSpinner";
import ListEmptyState from "../components/ListEmptyState";
import CardStatBadge from "../components/CardStatBadge";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function CampaignAthletes() {
  const { push } = useToast();
  const { profile, loading: authLoading } = useAuth();

  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    if (authLoading || !profile) return;

    const isLive = import.meta.env.VITE_USE_FIREBASE === "true";

    if (!isLive) {
      setLinks([
        {
          id: "link1",
          campaignId: "CAMP1",
          athleteId: "ATH1",
          orgId: "demo-org",
        },
      ]);
      setLoading(false);
      setLastUpdated(new Date().toLocaleTimeString());
      return;
    }

    const ref = collection(db, "campaignAthletes");
    const q = query(
      ref,
      where("orgId", "==", profile.orgId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLinks(data);
        setLoading(false);
        setLastUpdated(new Date().toLocaleTimeString());
      },
      (err) => {
        console.error("⚠️ Firestore listener error (campaignAthletes):", err);
        push("Failed to sync campaign–athlete links", "error");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [authLoading, profile]);

  if (authLoading || !profile) {
    return (
      <div className="p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6">
      <HeaderActions
        title="Campaign–Athlete Links"
        addLabel={null}
        exportLabel=""
        onExport={null}
        lastUpdated={lastUpdated}
      />

      {loading ? (
        <ListLoadingSpinner />
      ) : links.length === 0 ? (
        <ListEmptyState message="No campaign–athlete links found." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {links.map((l) => (
            <div
              key={l.id}
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow"
            >
              <div className="font-semibold text-slate-800">
                Campaign: {l.campaignId}
              </div>
              <div className="text-sm text-slate-600">
                Athlete: {l.athleteId}
              </div>
              <div className="text-[10px] text-slate-400 mt-1 select-all">
                ID: {l.id}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <CardStatBadge
                  label="Created"
                  value={l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "—"}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
