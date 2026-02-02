import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../context/FirebaseProvider';
import CampaignForm from '../components/CampaignForm';

export default function CreateCampaign() {
  const { addRecord, useFirebase: isLive } = useFirebase();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (data) => {
    try {
      setLoading(true);
      const newCampaign = { ...data, createdAt: new Date().toISOString() };

      if (isLive) {
        await addRecord('campaigns', newCampaign);
      } else {
        console.log('🧩 Mock mode: campaign created', newCampaign);
      }

      setLoading(false);

      // Show toast notification
      const toast = document.createElement('div');
      toast.textContent = '🎉 Campaign created successfully!';
      toast.className = 'fixed top-5 right-5 bg-yellow-400 text-slate-900 px-4 py-2 rounded-xl font-semibold shadow-lg animate-fadeInOut z-50';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);

      navigate('/campaigns');
    } catch (error) {
      console.error('Error creating campaign:', error);
      setLoading(false);
    }
  };

  return (
    <div className="p-6 text-slate-100 bg-slate-900 min-h-screen">
      <div className="max-w-3xl mx-auto bg-slate-800 p-8 rounded-2xl shadow-lg border border-slate-700">
        <h1 className="text-2xl font-bold text-yellow-400 mb-6 text-center">Create New Campaign</h1>
        <CampaignForm onSubmit={handleSubmit} loading={loading} />
      </div>
    </div>
  );
}
