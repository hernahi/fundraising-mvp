export default function ShareBlock({ campaign }){
  if (!campaign) return null;
  const link = `${location.origin}/c/${campaign.id}`;
  const copy = async () => { await navigator.clipboard.writeText(link); alert('Link copied!'); };
  return (
    <div className="flex items-center gap-2">
      <button onClick={copy} className="px-3 py-2 rounded-xl bg-gray-100">Copy Campaign Link</button>
      <a className="px-3 py-2 rounded-xl bg-gray-900 text-white" href={`mailto:?subject=Support ${encodeURIComponent(campaign.title)}&body=${encodeURIComponent(link)}`}>Email</a>
      <a className="px-3 py-2 rounded-xl bg-blue-600 text-white" target="_blank" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}>Facebook</a>
    </div>
  );
}
