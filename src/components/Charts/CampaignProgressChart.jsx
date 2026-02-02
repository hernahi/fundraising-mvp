import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useCampaigns } from '../../context/CampaignContext';

export default function CampaignProgressChart(){
  const { donations } = useCampaigns();
  const byDay = donations.reduce((acc, d) => {
    const k = d.createdAt.slice(0,10);
    acc[k] = (acc[k]||0) + d.amount;
    return acc;
  }, {});
  const data = Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)).map(([date, amount])=>({ date, amount }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.7}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="amount" stroke="#6366f1" fillOpacity={1} fill="url(#g1)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
