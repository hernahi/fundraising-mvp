import React from "react";

export default function HeaderActions({
  title,
  addLabel,
  onAdd,
  exportLabel,
  onExport,
  lastUpdated,
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
      {/* Title & Last Synced */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight border-b-2 border-yellow-400 pb-1">
          {title}
        </h1>
        {lastUpdated && (
          <div className="text-xs text-slate-400 text-right mt-1 animate-fadeIn">
            Last synced: {lastUpdated}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-3 sm:mt-0 flex gap-3">
        {addLabel && (
          <button
            onClick={onAdd}
            className="bg-gradient-to-r from-yellow-400 to-yellow-500 hover:brightness-110 text-slate-900 font-medium px-4 py-2 rounded-lg shadow-sm transition-all duration-200"
          >
            {typeof addLabel === "string" ? addLabel : addLabel}
          </button>
        )}
        {exportLabel && (
          <button
            onClick={onExport}
            className="px-4 py-2 rounded-lg border border-yellow-400 text-yellow-400 font-medium text-sm transition-all duration-300 hover:bg-yellow-400 hover:text-slate-900 hover:shadow-[0_0_10px_rgba(250,204,21,0.5)]"
          >
            {exportLabel}
          </button>
        )}
      </div>
    </div>
  );
}
