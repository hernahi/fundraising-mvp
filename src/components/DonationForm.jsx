// src/components/DonationForm.jsx
import { useState } from "react";
import { db } from "../firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "./Toast";

export default function DonationForm({ campaignId, athleteOptions = [], onSaved }) {
  const { push } = useToast();

  const [form, setForm] = useState({
    donorName: "",
    email: "",
    message: "",
    amount: "",
    athleteId: "",
  });
  const [saving, setSaving] = useState(false);

  const onChange = (e) =>
    setForm((f) => ({
      ...f,
      [e.target.name]: e.target.value,
    }));

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.donorName.trim()) return push("Donor name is required", "warning");
    if (!amount || amount <= 0) return push("Enter a valid amount", "warning");

    setSaving(true);
    try {
      if (import.meta.env.VITE_USE_FIREBASE === "true") {
        await addDoc(collection(db, "donations"), {
          campaignId,
          athleteId: form.athleteId || null,
          donorName: form.donorName,
          email: form.email || "",
          message: form.message || "",
          amount,
          createdAt: serverTimestamp(),
        });
      } else {
        console.log("[MOCK] donation", { campaignId, ...form, amount });
      }
      push("Donation recorded successfully", "success");
      setForm({ donorName: "", email: "", message: "", amount: "", athleteId: "" });
      onSaved?.();
    } catch (e) {
      console.error(e);
      push("Failed to record donation", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">Donor Name</label>
          <input
            name="donorName"
            value={form.donorName}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Jane Supporter"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">Email (optional)</label>
          <input
            name="email"
            value={form.email}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="jane@example.com"
            type="email"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-600">Message (optional)</label>
        <textarea
          name="message"
          value={form.message}
          onChange={onChange}
          className="w-full border rounded-lg px-3 py-2 h-20"
          placeholder="Proud to support the team!"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">Amount (USD)</label>
          <input
            name="amount"
            value={form.amount}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="50"
            type="number"
            min="1"
            step="1"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">Credit athlete (optional)</label>
          <select
            name="athleteId"
            value={form.athleteId}
            onChange={onChange}
            className="w-full border rounded-lg px-3 py-2"
          >
            <option value="">— None —</option>
            {athleteOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-yellow-400 text-slate-900 font-semibold px-4 py-2 rounded-lg hover:brightness-110 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Record Donation"}
      </button>
    </form>
  );
}
