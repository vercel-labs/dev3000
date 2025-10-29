export default function ParallelRoutesLayout({
  children,
  analytics,
  notifications,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  notifications: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      <div className="container mx-auto px-4 py-16">
        {children}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <div>{analytics}</div>
          <div>{notifications}</div>
        </div>
      </div>
    </div>
  );
}

