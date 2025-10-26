export default function NotificationsSlot() {
  const notifications = [
    {
      id: 1,
      type: "success",
      title: "Build Successful",
      message: "Your application built successfully in 3.2s",
      time: "2m ago",
    },
    {
      id: 2,
      type: "info",
      title: "New Route Added",
      message: "/demos/parallel-routes created",
      time: "5m ago",
    },
    {
      id: 3,
      type: "warning",
      title: "Slow Query Detected",
      message: "Database query took 1.2s to complete",
      time: "12m ago",
    },
    {
      id: 4,
      type: "success",
      title: "Tests Passed",
      message: "All 42 tests passed successfully",
      time: "15m ago",
    },
  ];

  return (
    <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl p-6">
      <h3 className="text-xl font-bold text-white mb-4">Recent Notifications</h3>

      <div className="space-y-3">
        {notifications.map((notification) => (
          <NotificationCard key={notification.id} {...notification} />
        ))}
      </div>

      <div className="mt-6 p-4 bg-black/30 rounded-lg">
        <p className="text-gray-400 text-sm">
          This parallel route loads independently from the analytics slot
        </p>
      </div>
    </div>
  );
}

function NotificationCard({
  type,
  title,
  message,
  time,
}: {
  type: string;
  title: string;
  message: string;
  time: string;
}) {
  const colors = {
    success: "border-green-500/30 bg-green-500/5",
    info: "border-blue-500/30 bg-blue-500/5",
    warning: "border-yellow-500/30 bg-yellow-500/5",
    error: "border-red-500/30 bg-red-500/5",
  };

  const iconColors = {
    success: "text-green-400",
    info: "text-blue-400",
    warning: "text-yellow-400",
    error: "text-red-400",
  };

  return (
    <div className={`p-4 border rounded-lg ${colors[type as keyof typeof colors]}`}>
      <div className="flex items-start justify-between mb-2">
        <h4 className={`font-semibold ${iconColors[type as keyof typeof iconColors]}`}>{title}</h4>
        <span className="text-gray-500 text-xs">{time}</span>
      </div>
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}
