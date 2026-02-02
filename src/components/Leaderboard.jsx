import { useCampaigns } from '../context/CampaignContext';
import { currency } from '../utils/currency';

export default function Leaderboard({ campaignId }){
  const { athletes } = useCampaigns();
  const roster = athletes.filter(a=>a.campaignId===campaignId).sort((a,b)=>b.totalRaised - a.totalRaised);
  return (
    <div className="divide-y">
      {roster.map((a,idx)=>(
        <div key={a.id} className="py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-6 text-right">{idx+1}</span>
            <span className="font-medium">{a.fullName}</span>
          </div>
          <span>{currency(a.totalRaised)}</span>
        </div>
      ))}
    </div>
  );
}
