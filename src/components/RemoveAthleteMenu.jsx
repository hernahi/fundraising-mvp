// src/components/RemoveAthleteMenu.jsx
import React, { useRef, useState, useEffect } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { db } from "../firebase/config";
import { deleteDoc, doc } from "firebase/firestore";
import { useToast } from "./Toast";

export default function RemoveAthleteMenu({ pivotId, athleteName, onRemoved }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const removeLink = async () => {
    try {
      if (import.meta.env.VITE_USE_FIREBASE === "true") {
        await deleteDoc(doc(db, "campaignAthletes", pivotId));
      } else {
        console.log("[MOCK] Remove athlete link pivot:", pivotId);
      }
      push(`Removed ${athleteName} from campaign`, "success");
      setConfirm(false);
      onRemoved?.();
    } catch (e) {
      console.error(e);
      push("Failed to remove athlete from campaign", "error");
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-label="More actions"
        className="px-2 py-1 rounded-lg hover:bg-slate-200 text-slate-600"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-20">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 text-red-600"
            onClick={() => {
              setOpen(false);
              setConfirm(true);
            }}
          >
            Remove from campaign
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title="Remove athlete?"
        message={`This will unlink ${athleteName} from this campaign (the athlete profile remains).`}
        confirmLabel="Remove"
        onConfirm={removeLink}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
