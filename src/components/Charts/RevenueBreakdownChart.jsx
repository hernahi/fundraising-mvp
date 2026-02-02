import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useCampaigns } from '../../context/CampaignContext';

export default function RevenueBreakdownChart(){
  const { campaigns, donations } = useCampaigns();
  const feePct = campaigns[0]?.feePct || 0.12;
  const total = donations.reduce((s,d)=>s+d.amount,0);
  const fees = Math.round(total * feePct);
  const net = total - fees;
  const data = [ { name:'Net to Team', value: net }, { name:'Platform Fees', value: fees } ];
  const colors = ['#10b981', '#f59e0b'];
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} label>
            {data.map((e,i)=>(<Cell key={i} fill={colors[i % colors.length]} />))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
