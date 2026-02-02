import React, { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";
import { Link } from "react-router-dom";
import { FaDollarSign, FaUser, FaCalendarAlt } from "react-icons/fa";

export default function DonationsList() {
  const { profile } = useAuth();
  const [donations, setDonations] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [filterCampaign, setFilterCampaign] = useState("all");

  useEffect(() => {
    if (!profile?.orgId) return;

    // Fetch campaigns for filter dropdown
    const cq = query(
      collection(db, "campaigns"),
      where("orgId", "==", profile.orgId)
    );
    const unsubCampaigns = onSnapshot(cq, (snap) => {
      const result = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCampaigns(result);
    });

    return () => unsubCampaigns();
  }, [profile]);

  useEffect(() => {
    if (!profile?.orgId) return;

    let dq;

    if (filterCampaign === "all") {
      dq = query(
        collection(db, "donations"),
        where("orgId", "==", profile.orgId),
        orderBy("createdAt", "desc")
      );
    } else {
      dq = query(
        collection(db, "donations"),
        where("orgId", "==", profile.orgId),
        where("campaignId", "==", filterCampaign),
        orderBy("createdAt", "desc")
      );
    }

    const unsub = onSnapshot(dq, (snap) => {
      const result = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setDonations(result);
    });

    return () => unsub();
  }, [profile, filterCampaign]);

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold text-gray-900">Donations</h1>

      {/* FILTER BAR */}
      <div className="bg-white rounded-xl shadow p-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="font-medium text-gray-700">Filter by Campaign:</div>

        <select
          className="border rounded-lg px-4 py-2 bg-gray-50"
          value={filterCampaign}
          onChange={(e) => setFilterCampaign(e.target.value)}
        >
          <option value="all">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* DONATION LIST */}
      <div className="bg-white rounded-xl shadow divide-y">
        {donations.length === 0 ? (
          <div className="p-6 text-gray-500 italic text-center">
            No donations found.
          </div>
        ) : (
          donations.map((d) => <DonationRow key={d.id} d={d} campaigns={campaigns} />)
        )}
      </div>
    </div>
  );
}

/* ====================================================================
   Donation Row
   ==================================================================== */

function DonationRow({ d, campaigns }) {
  const campaign = campaigns.find((c) => c.id === d.campaignId);

  return (
    <div className="p-4 flex items-center justify-between hover:bg-gray-50 transition">
      <div className="flex items-center gap-4">
        <img
          src={safeImageURL(d.athleteImage)}
          alt="Athlete"
          className="w-14 h-14 rounded-lg object-cover"
        />

        <div className="space-y-1">
          <div className="font-semibold text-gray-800">
            ${d.amount?.toLocaleString() ?? "0.00"}
          </div>

          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <FaUser />
            {d.donorName || "Anonymous"}
          </div>

          <div className="flex items-center gap-2 text-gray-500 text-xs">
            <FaCalendarAlt />
            {new Date(d.createdAt?.toDate?.() ?? Date.now()).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="text-right">
        {campaign && (
          <Link
            to={`/campaigns/${campaign.id}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {campaign.name}
          </Link>
        )}

        <div className="text-xs text-gray-500">
          {d.athleteName ? `for ${d.athleteName}` : ""}
        </div>
      </div>
    </div>
  );
}
