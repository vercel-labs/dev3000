export default function AnalyticsSlot() {
  return (
    <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl p-6">
      <h3 className="text-xl font-bold text-white mb-4">Analytics Dashboard</h3>

      <div className="space-y-4">
        <MetricCard label="Page Views" value="12,543" change="+12.5%" positive />
        <MetricCard label="Unique Visitors" value="3,421" change="+8.2%" positive />
        <MetricCard label="Bounce Rate" value="42.3%" change="-3.1%" positive />
        <MetricCard label="Avg. Session" value="4m 32s" change="+15.7%" positive />
      </div>

      <div className="mt-6 p-4 bg-black/30 rounded-lg">
        <p className="text-gray-400 text-sm">
          This parallel route loads independently from the notifications slot
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  change,
  positive,
}: {
  label: string;
  value: string;
  change: string;
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg">
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        <p className="text-white text-2xl font-bold mt-1">{value}</p>
      </div>
      <div className={`text-sm font-semibold ${positive ? "text-green-400" : "text-red-400"}`}>
        {change}
      </div>
    </div>
  );
}
