import { uid, ls } from '../utils/storage';
import seed from './seed';
const KEY = 'fr_app_db_v1';
const _db = () => ls.get(KEY) || seed();
const _save = (d) => ls.set(KEY, d);

const api = {
  bootstrap() { if (!ls.get(KEY)) _save(seed()); },
  reset() { ls.del(KEY); },
  campaign: {
    list() { return _db().campaigns; },
    get(id) { return _db().campaigns.find(c => c.id === id); },
    create(input) {
      const d = _db();
      const newC = { id: uid(), createdAt: new Date().toISOString(), status: 'active', ...input, donationIds: [], athleteIds: [] };
      d.campaigns.unshift(newC); _save(d); return newC;
    },
    update(id, patch) {
      const d = _db(); const i = d.campaigns.findIndex(c => c.id === id);
      d.campaigns[i] = { ...d.campaigns[i], ...patch }; _save(d); return d.campaigns[i];
    }
  },
  athlete: {
    list() { return _db().athletes; },
    byCampaign(campaignId) { return _db().athletes.filter(a => a.campaignId === campaignId); },
    create(input) {
      const d = _db(); const a = { id: uid(), createdAt: new Date().toISOString(), totalRaised: 0, shareCode: uid(8), ...input };
      d.athletes.unshift(a); _save(d); return a;
    },
    update(id, patch) {
      const d = _db(); const i = d.athletes.findIndex(a => a.id === id);
      d.athletes[i] = { ...d.athletes[i], ...patch }; _save(d); return d.athletes[i];
    }
  },
  donation: {
    list() { return _db().donations; },
    byCampaign(campaignId) { return _db().donations.filter(x => x.campaignId === campaignId); },
    create(input) {
      const d = _db();
      const don = { id: uid(), createdAt: new Date().toISOString(), source: 'public', ...input };
      d.donations.unshift(don);
      const ath = d.athletes.find(a => a.id === don.athleteId);
      if (ath) ath.totalRaised += don.amount;
      const camp = d.campaigns.find(c => c.id === don.campaignId);
      if (camp) camp.donationIds.unshift(don.id);
      _save(d);
      return don;
    }
  }
};
export default api;
