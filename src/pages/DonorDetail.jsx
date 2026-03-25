import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import { db } from "../firebase/config";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import safeImageURL from "../utils/safeImage";
import { useAuth } from "../context/AuthContext";

function getCoachScopedTeamIds(profile) {
  if (!profile) return [];
  const role = String(profile.role || "").toLowerCase();
  if (role !== "coach") return [];
  const fromArray = Array.isArray(profile.teamIds)
    ? profile.teamIds
    : Array.isArray(profile.assignedTeamIds)
      ? profile.assignedTeamIds
      : [];
  const normalized = fromArray
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const single = String(profile.teamId || "").trim();
  if (single) normalized.push(single);
  return Array.from(new Set(normalized));
}

export default function DonorDetail() {
  const { donorId: donorIdParam } = useParams();
  const donorId = decodeURIComponent(donorIdParam || "");
  const { profile, activeOrgId, activeOrgName, isSuperAdmin, loading: authLoading } = useAuth();
  const orgId = isSuperAdmin ? activeOrgId || "" : profile?.orgId || "";
  const role = String(profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const coachTeamIds = getCoachScopedTeamIds(profile);
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
  const [hasDonorDoc, setHasDonorDoc] = useState(false);

  const chunkValues = (values, size = 10) => {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
      chunks.push(values.slice(i, i + size));
    }
    return chunks;
  };

  const loadLookupMaps = async (nextOrgId) => {
    let teamsDocs = [];
    if (isCoach) {
      if (coachTeamIds.length > 0) {
        const teamSnaps = await Promise.all(
          chunkValues(coachTeamIds).map((chunk) =>
            getDocs(
              query(
                collection(db, "teams"),
                where("__name__", "in", chunk)
              )
            )
          )
        );
        teamsDocs = teamSnaps.flatMap((snap) => snap.docs);
      }
    } else {
      const teamsSnap = await getDocs(
        query(collection(db, "teams"), where("orgId", "==", nextOrgId))
      );
      teamsDocs = teamsSnap.docs;
    }

    let athletesDocs = [];
    if (isCoach) {
      if (coachTeamIds.length > 0) {
        const athleteSnaps = await Promise.all(
          chunkValues(coachTeamIds).map((chunk) => {
            const teamConstraint =
              chunk.length === 1
                ? where("teamId", "==", chunk[0])
                : where("teamId", "in", chunk);
            return getDocs(
              query(
                collection(db, "athletes"),
                where("orgId", "==", nextOrgId),
                teamConstraint
              )
            );
          })
        );
        athletesDocs = athleteSnaps.flatMap((snap) => snap.docs);
      }
    } else {
      const athletesSnap = await getDocs(
        query(collection(db, "athletes"), where("orgId", "==", nextOrgId))
      );
      athletesDocs = athletesSnap.docs;
    }

    const nextTeamMap = new Map();
    teamsDocs.forEach((teamDoc) => {
      nextTeamMap.set(teamDoc.id, {
        id: teamDoc.id,
        ...teamDoc.data(),
      });
    });

    const nextAthleteMap = new Map();
    athletesDocs.forEach((athleteDoc) => {
      nextAthleteMap.set(athleteDoc.id, {
        id: athleteDoc.id,
        ...athleteDoc.data(),
      });
    });

    setTeamMap(nextTeamMap);
    setAthleteMap(nextAthleteMap);
  };

  const getScopedDonationDocs = async (buildQuery) => {
    if (!isCoach) {
      const snap = await getDocs(buildQuery(null));
      return snap.docs;
    }
    if (coachTeamIds.length === 0) {
      return [];
    }

    const snaps = await Promise.all(
      chunkValues(coachTeamIds).map((chunk) => getDocs(buildQuery(chunk)))
    );
    const dedupe = new Map();
    snaps.forEach((snap) => {
      snap.docs.forEach((entry) => dedupe.set(entry.id, entry));
    });
    return Array.from(dedupe.values());
  };

  const loadDonationHistoryFallback = async (nextOrgId, lookupKey) => {
    const buildFallbackQuery = (teamChunk) => {
      const constraints = [where("orgId", "==", nextOrgId)];
      if (lookupKey.startsWith("email:")) {
        constraints.push(where("donorEmail", "==", lookupKey.slice(6)));
      } else if (lookupKey.startsWith("name:")) {
        constraints.push(where("donorName", "==", lookupKey.slice(5)));
      } else {
        constraints.push(where("donorEmail", "==", lookupKey));
      }
      if (isCoach && teamChunk) {
        constraints.push(
          teamChunk.length === 1
            ? where("teamId", "==", teamChunk[0])
            : where("teamId", "in", teamChunk)
        );
      }
      return query(collection(db, "donations"), ...constraints);
    };

    const donationDocs = await getScopedDonationDocs(buildFallbackQuery);
    const donationList = donationDocs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTs = a.createdAt?.toDate?.()?.getTime?.() || 0;
        const bTs = b.createdAt?.toDate?.()?.getTime?.() || 0;
        return bTs - aTs;
      });

    if (donationList.length === 0) {
      return null;
    }

    const first = donationList[0];
    const donorName =
      first.donorName ||
      first.donor?.name ||
      (lookupKey.startsWith("name:") ? lookupKey.slice(5) : "") ||
      "Anonymous Donor";
    const donorEmail =
      first.donorEmail ||
      first.donor?.email ||
      (lookupKey.startsWith("email:") ? lookupKey.slice(6) : "");

    return {
      donorData: {
        donorName,
        donorEmail,
        orgId: nextOrgId,
      },
      donationList,
    };
  };

  useEffect(() => {
    if (authLoading) return;
    if (!orgId || !donorId) {
      setDonor(null);
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        let donorSnap = null;
        try {
          donorSnap = await getDoc(doc(db, "donors", donorId));
        } catch (_) {
          donorSnap = null;
        }

        if (!donorSnap || !donorSnap.exists()) {
          const fallback = await loadDonationHistoryFallback(orgId, donorId);
          if (!fallback) {
            setDonor(null);
            setDonations([]);
            setHasDonorDoc(false);
            setNotesDraft("");
            return;
          }

          await loadLookupMaps(orgId);
          setDonor(fallback.donorData);
          setDonations(fallback.donationList);
          setHasDonorDoc(false);
          setNotesDraft("");
          return;
        }

        const donorData = donorSnap.data();
        if (donorData?.orgId && donorData.orgId !== orgId) {
          setDonor(null);
          setDonations([]);
          setHasDonorDoc(false);
          setNotesDraft("");
          return;
        }
        if (
          isCoach &&
          donorData?.teamId &&
          !coachTeamIds.includes(String(donorData.teamId))
        ) {
          setDonor(null);
          setDonations([]);
          setHasDonorDoc(false);
          setNotesDraft("");
          return;
        }

        const buildDonorDonationsQuery = (teamChunk) => {
          const constraints = [
            where("orgId", "==", orgId),
            where("donorId", "==", donorId),
          ];
          if (isCoach && teamChunk) {
            constraints.push(
              teamChunk.length === 1
                ? where("teamId", "==", teamChunk[0])
                : where("teamId", "in", teamChunk)
            );
          }
          return query(collection(db, "donations"), ...constraints);
        };

        const donationDocs = await getScopedDonationDocs(buildDonorDonationsQuery);
        const donationList = donationDocs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const aTs = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bTs = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bTs - aTs;
          });

        await loadLookupMaps(orgId);

        setDonor(donorData);
        setDonations(donationList);
        setHasDonorDoc(true);
        setNotesDraft(donorData?.notes || "");
      } catch (error) {
        console.error("Error loading donor:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, donorId, orgId, isCoach, JSON.stringify(coachTeamIds)]);

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
          className="inline-flex items-center gap-2 mt-3 text-sm text-gray-600 hover:text-gray-800"
        >
          <FaArrowLeft /> Back to Donors
        </Link>
      </div>
    );

  const donorName =
    donor.name || donor.donorName || donor.fullName || "Anonymous Donor";
  const donorEmail = donor.email || donor.donorEmail || "No email";
  const avatar = safeImageURL(
    donor.photoURL || donor.photoUrl || donor.imgUrl || null
  );

  const canEditDonorNotes = canEditNotes && hasDonorDoc;

  const saveNotes = async () => {
    if (!canEditDonorNotes || !donorId) return;
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
      <Link
        to="/donors"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> Back to Donors
      </Link>
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
              {isSuperAdmin
                ? `Selected org: ${activeOrgName || orgId || "none"}`
                : `Organization: ${profile?.orgName || orgId || "unknown"}`}
            </div>
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
          {canEditDonorNotes && (
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

        {canEditDonorNotes ? (
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Add notes about this donor..."
            rows={4}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-yellow-200"
          />
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            {hasDonorDoc
              ? donor.notes?.trim() || "No notes yet."
              : "Notes are unavailable for donation-history-only donors."}
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
