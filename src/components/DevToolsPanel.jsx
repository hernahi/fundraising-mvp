// src/components/DevToolsPanel.jsx
import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { seedDemoUsers } from "../dev/seedDemoUsers";

export default function DevToolsPanel() {
  // ✅ Safe Auth lookup (prevents crash)
  let auth = {};
  try { auth = useAuth?.() || {}; } catch {}
  const profile = auth?.profile || null;

  const [open, setOpen] = useState(false);

  // ✅ Detect mode
  const isFirebase = import.meta.env.VITE_USE_FIREBASE?.toLowerCase() === "true";
  const [firebaseMode, setFirebaseMode] = useState(isFirebase);

  const toggleMode = () => {
    const newMode = !firebaseMode;
    setFirebaseMode(newMode);
    window.toast?.(
      `Switched to ${newMode ? "Firebase Live Mode" : "Mock Mode"}`,
      "info"
    );
  };

  // 🚫 Never show in production
  if (import.meta.env.PROD) return null;

  // 🔐 Admin gates
  const isAdmin = profile?.role === "admin";

  return (
    <div className="fixed bottom-4 right-4 z-50 select-none font-sans">

      {/* Collapsed button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="bg-slate-900 text-yellow-400 border border-yellow-400 rounded-full px-4 py-2 text-xs font-semibold shadow-md hover:bg-yellow-400 hover:text-slate-900 transition-all"
        >
          ⚙️ Dev Tools
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="bg-slate-800 text-yellow-100 border border-yellow-400 rounded-xl shadow-xl p-3 w-60 animate-fadeIn">

          {/* Header */}
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-yellow-400">🧩 Debug Panel</span>
            <button
              onClick={() => setOpen(false)}
              className="text-yellow-400 hover:text-yellow-300 text-xs"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-2 text-sm">

            {/* ✅ Toast buttons */}
            <button
              onClick={() => window.toast?.("✅ Test success toast!", "success")}
              className="bg-green-600 hover:bg-green-500 rounded px-2 py-1 text-white text-xs font-medium"
            >
              ✅ Success Toast
            </button>

            <button
              onClick={() => window.toast?.("❌ Simulated error!", "error")}
              className="bg-red-600 hover:bg-red-500 rounded px-2 py-1 text-white text-xs font-medium"
            >
              ❌ Error Toast
            </button>

            {/* 🔁 Toggle Firebase / Mock */}
            <button
              onClick={toggleMode}
              className="bg-yellow-400 hover:bg-yellow-300 text-slate-900 rounded px-2 py-1 text-xs font-semibold"
            >
              🔁 Switch to {firebaseMode ? "Mock" : "Firebase"}
            </button>

            {/* 🛠 Admin-only tools */}
            {isAdmin && (
              <>
                <div className="mt-2 text-[10px] text-yellow-300 font-semibold">
                  🔒 Admin Tools
                </div>

                <button
                  onClick={seedDemoUsers}
                  className="bg-blue-600 hover:bg-blue-500 rounded px-2 py-1 text-white text-xs font-semibold"
                >
                  👥 Seed Demo Users
                </button>
              </>
            )}

            {/* 🔍 Debug user state */}
            <button
              onClick={() => {
                console.log("Auth Debug →", { user: auth.user, profile });
                window.toast?.("Auth state logged to console", "info");
              }}
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-1 text-xs font-medium text-yellow-200"
            >
              🐛 Log Auth State
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
