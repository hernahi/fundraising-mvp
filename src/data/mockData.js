const mockData = {
  campaigns: [
    {
      id: 'camp001',
      name: 'Eagles Youth Soccer 2025',
      goal: 10000,
      raised: 4200,
      status: 'active',
      createdAt: '2025-09-10T00:00:00Z',
    },
    {
      id: 'camp002',
      name: 'Tigers Cheer Squad',
      goal: 7500,
      raised: 3800,
      status: 'active',
      createdAt: '2025-10-01T00:00:00Z',
    },
  ],
  athletes: [
    { id: 'ath001', name: 'Ava Martinez', team: 'Eagles', donations: 6, total: 350 },
    { id: 'ath002', name: 'Liam Chen', team: 'Eagles', donations: 3, total: 200 },
  ],
  donations: [
    { id: 'don001', campaignId: 'camp001', donor: 'Sarah Brown', amount: 50, date: '2025-10-18' },
    { id: 'don002', campaignId: 'camp001', donor: 'James Lee', amount: 75, date: '2025-10-20' },
    { id: 'don003', campaignId: 'camp002', donor: 'Maria Perez', amount: 40, date: '2025-10-21' },
  ],
};

export default mockData;
