import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase/config";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import safeImageURL from "../utils/safeImage";
import { useAuth } from "../context/AuthContext";

export default function DonorDetail() {
  const { donorId } = useParams();
  const { profile, activeOrgId, loading: authLoading } = useAuth();
  const orgId = activeOrgId || profile?.orgId;
  const canEditNotes = ["admin", "super-admin", "coach"].includes(
    profile?.role
  );

  const [donor, setDonor] = useState(null);
  const [donations, setDonations] = useState([]);
  const [teamMap, setTeamMap] = useState(new Map());
  const [athleteMap, setAthleteMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!orgId || !donorId) {
      setDonor(null);
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const donorRef = doc(db, "donors", donorId);
        const donorSnap = await getDoc(donorRef);

        if (!donorSnap.exists()) {
          setDonor(null);
          setLoading(false);
          return;
        }

        const donorData = donorSnap.data();
        if (donorData?.orgId && donorData.orgId !== orgId) {
          setDonor(null);
          setLoading(false);
          return;
        }

        const donationsRef = collection(db, "donations");
        const q = query(
          donationsRef,
          where("orgId", "==", orgId),
          where("donorId", "==", donorId),
          orderBy("createdAt", "desc")
        );

        const donationSnap = await getDocs(q);
        const donationList = donationSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const [teamsSnap, athletesSnap] = await Promise.all([
          getDocs(
            query(collection(db, "teams"), where("orgId", "==", orgId))
          ),
          getDocs(
            query(collection(db, "athletes"), where("orgId", "==", orgId))
          ),
        ]);

        const nextTeamMap = new Map();
        teamsSnap.forEach((teamDoc) => {
          nextTeamMap.set(teamDoc.id, {
            id: teamDoc.id,
            ...teamDoc.data(),
          });
        });

        const nextAthleteMap = new Map();
        athletesSnap.forEach((athleteDoc) => {
          nextAthleteMap.set(athleteDoc.id, {
            id: athleteDoc.id,
            ...athleteDoc.data(),
          });
        });

        setDonor(donorData);
        setDonations(donationList);
        setTeamMap(nextTeamMap);
        setAthleteMap(nextAthleteMap);
        setNotesDraft(donorData?.notes || "");
      } catch (error) {
        console.error("Error loading donor:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, donorId, orgId]);

  const summary = useMemo(() => {
    const totalDonated = donations.reduce(
      (sum, d) => sum + Number(d.amount || 0),
      0
    );
    const lastDonation = donations[0]?.createdAt?.toDate?.();
    return {
      totalDonated,
      donationCount: donations.length,
      lastDonationLabel: lastDonation ? lastDonation.toLocaleString() : "N/A",
    };
  }, [donations]);

  if (loading) return <div className="p-6">Loading donor...</div>;
  if (!donor)
    return (
      <div className="p-6">
        <div className="text-lg font-semibold text-slate-700">
          Donor not found or restricted.
        </div>
        <Link
          to="/donors"
          className="inline-flex mt-3 text-sm text-blue-600 hover:underline"
        >
          Back to Donors
        </Link>
      </div>
    );

  const donorName =
    donor.name || donor.donorName || donor.fullName || "Anonymous Donor";
  const donorEmail = donor.email || donor.donorEmail || "No email";
  const avatar = safeImageURL(
    donor.photoURL || donor.photoUrl || donor.imgUrl || null
  );

  const saveNotes = async () => {
    if (!canEditNotes || !donorId) return;
    setSavingNotes(true);
    try {
      await updateDoc(doc(db, "donors", donorId), {
        notes: notesDraft.trim(),
        updatedAt: serverTimestamp(),
      });
      setDonor((prev) =>
        prev ? { ...prev, notes: notesDraft.trim() } : prev
      );
    } catch (err) {
      console.error("Failed to update donor notes:", err);
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {avatar ? (
            <img
              src={avatar}
              alt="Donor Avatar"
              className="h-20 w-20 rounded-full object-cover border border-slate-200"
            />
          ) : (
            <div className="h-20 w-20 rounded-full bg-slate-200 flex items-center justify-center text-2xl font-semibold text-slate-600">
              {donorName.charAt(0).toUpperCase()}
            </div>
          )}

          <div>
            <h1 className="text-2xl font-bold text-slate-900">{donorName}</h1>
            <div className="text-sm text-slate-500">{donorEmail}</div>
            <div className="mt-1 text-xs text-slate-400">
              Donor ID: {donorId}
              {donor.createdAt?.toDate?.() && (
                <>
                  {" · "}Member since{" "}
                  {donor.createdAt.toDate().toLocaleDateString()}
                </>
              )}
            </div>
          </div>
        </div>

        <Link
          to="/donors"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Back to Donors
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Total Donated
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            ${summary.totalDonated.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Donations
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {summary.donationCount}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Last Donation
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-900">
            {summary.lastDonationLabel}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Notes</h2>
          {canEditNotes && (
            <button
              type="button"
              onClick={saveNotes}
              disabled={savingNotes}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {savingNotes ? "Saving..." : "Save"}
            </button>
          )}
        </div>

        {canEditNotes ? (
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Add notes about this donor..."
            rows={4}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-yellow-200"
          />
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            {donor.notes?.trim() || "No notes yet."}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-800">
            Donation History
          </h2>
        </div>

        {donations.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No donations found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-4 py-2 text-left font-medium">Team</th>
                  <th className="px-4 py-2 text-left font-medium">Athlete</th>
                  <th className="px-4 py-2 text-left font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => {
                  const createdAt =
                    d.createdAt?.toDate?.() ||
                    (d.createdAt?.seconds
                      ? new Date(d.createdAt.seconds * 1000)
                      : null);
                  const campaignLabel = d.campaignName || "Campaign";
                  const athleteLabel = d.athleteName || "Athlete";
                  const teamId =
                    d.teamId ||
                    d.team?.id ||
                    athleteMap.get(d.athleteId)?.teamId ||
                    null;
                  const teamLabel =
                    d.teamName ||
                    teamMap.get(teamId)?.name ||
                    teamMap.get(teamId)?.teamName ||
                    "Team";

                  return (
                    <tr
                      key={d.id}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 text-slate-800">
                        {d.campaignId ? (
                          <Link
                            to={`/campaigns/${d.campaignId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {campaignLabel}
                          </Link>
                        ) : (
                          campaignLabel
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {teamId ? (
                          <Link
                            to={`/teams/${teamId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {teamLabel}
                          </Link>
                        ) : (
                          teamLabel
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {d.athleteId ? (
                          <Link
                            to={`/athletes/${d.athleteId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {athleteLabel}
                          </Link>
                        ) : (
                          athleteLabel
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        ${Number(d.amount || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {createdAt ? createdAt.toLocaleString() : "N/A"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
