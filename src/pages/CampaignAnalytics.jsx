import { Card } from '../components/Card';
import { ThemedLineChart } from '../components/Chart';

export default function CampaignAnalytics() {
  const performanceData = [
    { name: 'Week 1', donations: 2500, supporters: 42 },
    { name: 'Week 2', donations: 3700, supporters: 68 },
    { name: 'Week 3', donations: 4100, supporters: 75 },
    { name: 'Week 4', donations: 5400, supporters: 91 },
  ];

  const totalDonations = performanceData.reduce((sum, d) => sum + d.donations, 0);
  const totalSupporters = performanceData.reduce((sum, d) => sum + d.supporters, 0);
  const avgDonation = (totalDonations / totalSupporters).toFixed(2);

  return (
    <div className="p-6 space-y-6 bg-slate-900 min-h-screen text-slate-100">
      <h1 className="text-2xl font-bold text-yellow-400 mb-2">Campaign Analytics</h1>
      <p className="text-slate-400 mb-6">
        Monitor your fundraising campaign performance, total donations, and supporter engagement trends.
      </p>

      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Total Donations" value={`$${totalDonations.toLocaleString()}`} />
        <Card title="Total Supporters" value={totalSupporters.toLocaleString()} />
        <Card title="Average Donation" value={`$${avgDonation}`} />
      </div>

      <div className="mt-8 grid gap-6 grid-cols-1 lg:grid-cols-2">
        <ThemedLineChart
          data={performanceData}
          dataKey="donations"
          label="Donations Over Time"
        />
        <ThemedLineChart
          data={performanceData}
          dataKey="supporters"
          label="Supporters Growth Trend"
        />
      </div>
    </div>
  );
}
