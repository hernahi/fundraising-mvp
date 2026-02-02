export default function ListLoadingSpinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
