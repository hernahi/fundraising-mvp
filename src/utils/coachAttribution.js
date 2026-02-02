export function buildCoachTotals({
  rollups = [],
  campaigns = [],
  teams = [],
}) {
  const campaignToTeam = {};
  const teamToCoach = {};
  const coachTotals = {};

  campaigns.forEach(c => {
    if (c.id && c.teamId) {
      campaignToTeam[c.id] = c.teamId;
    }
  });

  teams.forEach(t => {
    if (t.id && t.coachId) {
      teamToCoach[t.id] = t.coachId;
    }
  });

  rollups.forEach(r => {
    Object.entries(r.byCampaign || {}).forEach(([campaignId, v]) => {
      const teamId = campaignToTeam[campaignId];
      const coachId = teamToCoach[teamId];
      if (!coachId) return;

      if (!coachTotals[coachId]) {
        coachTotals[coachId] = { amount: 0, count: 0 };
      }

      coachTotals[coachId].amount += v.amountCents || 0;
      coachTotals[coachId].count += v.count || 0;
    });
  });

  return coachTotals;
}
