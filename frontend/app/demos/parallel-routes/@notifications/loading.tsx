export default function NotificationsLoading() {
  return (
    <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 animate-pulse">
      <div className="h-6 bg-gray-700 rounded w-1/3 mb-4" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-gray-700/50 rounded" />
        ))}
      </div>
    </div>
  );
}
