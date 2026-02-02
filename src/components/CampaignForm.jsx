import { useState } from 'react';

export default function CampaignForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    name: '',
    goal: '',
    startDate: '',
    endDate: '',
    description: '',
    image: null,
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.size > 5 * 1024 * 1024) {
      alert('File too large. Maximum size is 5MB.');
      return;
    }
    setForm((prev) => ({ ...prev, image: file }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-slate-100">
      <div>
        <label className="block text-sm font-semibold mb-1">Campaign Name</label>
        <input
          type="text"
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          className="w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Goal Amount ($)</label>
        <input
          type="number"
          name="goal"
          value={form.goal}
          onChange={handleChange}
          required
          className="w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">Start Date</label>
          <input
            type="date"
            name="startDate"
            value={form.startDate}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-semibold mb-1">End Date</label>
          <input
            type="date"
            name="endDate"
            value={form.endDate}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Description</label>
        <textarea
          name="description"
          value={form.description}
          onChange={handleChange}
          rows="3"
          className="w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        ></textarea>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Banner Image (optional)</label>
        <input
          type="file"
          accept="image/png, image/jpeg"
          onChange={handleFileChange}
          className="w-full text-sm text-slate-300"
        />
        {form.image && (
          <div className="mt-2">
            <p className="text-xs text-slate-400">Preview:</p>
            <img
              src={URL.createObjectURL(form.image)}
              alt="preview"
              className="mt-1 rounded-lg w-full max-h-48 object-cover border border-slate-700"
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 bg-yellow-400 text-slate-900 font-semibold rounded-lg hover:bg-yellow-300 transition-all duration-300 hover:shadow-[0_0_12px_rgba(250,204,21,0.4)]"
      >
        {loading ? 'Saving...' : 'Create Campaign'}
      </button>
    </form>
  );
}
