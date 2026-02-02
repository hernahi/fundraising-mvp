import { uid } from '../utils/storage';
export default function seed() {
  const now = new Date().toISOString();
  const c1 = {
    id: uid(),
    title: 'Downey HS Varsity Baseball',
    team: 'DHS Baseball',
    goal: 1500000,
    deadline: new Date(Date.now()+1000*60*60*24*21).toISOString(),
    feePct: 0.12,
    ownerUserId: 'u1',
    athleteIds: [],
    donationIds: [],
    createdAt: now,
    status: 'active'
  };
  const athletes = Array.from({ length: 8 }).map((_, i) => ({
    id: uid(),
    fullName: `Player ${i+1}`,
    jersey: String(i+2),
    campaignId: c1.id,
    shareCode: uid(8),
    totalRaised: 0,
    createdAt: now
  }));
  c1.athleteIds = athletes.map(a => a.id);
  const data = {
    campaigns: [c1],
    athletes,
    donations: [],
    users: [
      { id:'u1', role:'coach', name:'Coach Lee', email:'coach@example.com', campaignIds:[c1.id] },
      { id:'a1', role:'athlete', name:'Player 1', email:'p1@example.com', campaignIds:[c1.id] }
    ]
  };
  return data;
}
