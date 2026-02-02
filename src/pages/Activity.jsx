import { useFirebase } from '../context/FirebaseProvider';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

export default function Activity() {
  const { campaigns = [], athletes = [], donors = [], useFirebase: isLive } = useFirebase();

  // Mock fallback
  const mockCampaigns = [
    { id: 1, name: 'Eagles Youth', createdAt: '2025-10-15' },
    { id: 2, name: 'Falcons Track', createdAt: '2025-10-10' },
  ];
  const mockAthletes = [
    { id: 1, name: 'John Smith', createdAt: '2025-10-20' },
    { id: 2, name: 'Ava Johnson', createdAt: '2025-10-18' },
  ];
  const mockDonors = [
    { id: 1, name: 'Michael Scott', createdAt: '2025-10-21' },
    { id: 2, name: 'Pam Beesly', createdAt: '2025-10-19' },
  ];

  const cData = isLive ? campaigns : mockCampaigns;
  const aData = isLive ? athletes : mockAthletes;
  const dData = isLive ? donors : mockDonors;

  const recent = (arr) => arr.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)).slice(0,3);

  const groups = useMemo(() => [
    { title: '🏆 Campaigns', color: 'text-yellow-400', data: recent(cData), link: '/campaigns' },
    { title: '🏃‍♂️ Athletes', color: 'text-yellow-400', data: recent(aData), link: '/athletes' },
    { title: '💖 Donors', color: 'text-yellow-400', data: recent(dData), link: '/donors' },
  ], [cData, aData, dData]);

  return (
    <div className="p-6 bg-slate-900 min-h-screen text-slate-100">
      <h1 className="text-2xl font-bold text-yellow-400 mb-6">Recent Activity</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {groups.map((g) => (
          <div key={g.title} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className={`font-semibold ${g.color}`}>{g.title}</h2>
              <Link
                to={g.link}
                className="text-sm text-yellow-400 hover:text-yellow-300 font-semibold transition-all"
              >
                View All →
              </Link>
            </div>
            <ul className="divide-y divide-slate-700">
              {g.data.map((item, i) => (
                <li key={i} className="py-2 flex justify-between items-center hover:bg-slate-700/40 rounded-md px-2 transition-all">
                  <span>{item.name}</span>
                  <span className="text-xs text-slate-400">{item.createdAt}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
