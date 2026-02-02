import { useEffect, useMemo, useRef, useState } from 'react';
import { useFirebase } from '../context/FirebaseProvider';
import { useToast } from './Toast';

export default function AddAthleteModal({ open, onClose }){
  const { campaigns = [], addAthlete } = useFirebase() || {};
  const { push } = useToast ? useToast() : { push: () => {} };
  const [name, setName] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [goal, setGoal] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => firstInputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Enter') handleSubmit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, name, campaignId, goal]);

  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!campaignId) errs.campaignId = 'Campaign is required';
    if (goal !== '' && Number(goal) < 0) errs.goal = 'Goal must be positive';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      push?.('Please fix the errors and try again', 'error');
      return;
    }
    try {
      setLoading(true);
      await addAthlete?.({
        name: name.trim(),
        campaignId,
        goal: goal === '' ? null : Number(goal),
      });
      setName(''); setCampaignId(''); setGoal(''); setErrors({});
      push?.('Athlete added successfully', 'success');
      onClose?.();
    } catch (err) {
      console.error(err);
      push?.('Failed to add athlete', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-100 transition-opacity"></div>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden transform transition-all">
          <div className="px-5 py-4 border-b bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-800">Add Athlete</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Name<span className="text-red-500">*</span></label>
              <input ref={firstInputRef} value={name} onChange={e=>setName(e.target.value)} className={`mt-1 w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.name ? 'border-red-300' : 'border-slate-300'}`} placeholder="Jordan Lee"/>
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Campaign<span className="text-red-500">*</span></label>
              <select value={campaignId} onChange={e=>setCampaignId(e.target.value)} className={`mt-1 w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.campaignId ? 'border-red-300' : 'border-slate-300'}`}>
                <option value="">Select a campaign</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.campaignId && <p className="text-xs text-red-600 mt-1">{errors.campaignId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Goal (optional)</label>
              <input value={goal} onChange={e=>setGoal(e.target.value)} type="number" min="0" className={`mt-1 w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.goal ? 'border-red-300' : 'border-slate-300'}`} placeholder="300"/>
              {errors.goal && <p className="text-xs text-red-600 mt-1">{errors.goal}</p>}
            </div>
          </div>
          <div className="px-5 py-4 bg-slate-50 border-t flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100">Cancel</button>
            <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 rounded-md text-slate-900 bg-gradient-to-tr from-yellow-300 to-yellow-500 border border-amber-300 shadow hover:shadow-lg transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2">
              {loading && <svg className="animate-spin h-4 w-4 text-slate-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
