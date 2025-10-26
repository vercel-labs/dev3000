import Link from "next/link";

export default function FixMyAppDemo() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      <div className="container mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          ← Back to Home
        </Link>

        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
              fix_my_app
            </span>
          </h1>
          <p className="text-gray-400 mb-8">
            AI-powered debugging with interaction replay, error prioritization, and automatic PR
            creation
          </p>

          <div className="bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/30 rounded-2xl p-8 backdrop-blur-sm mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">
              The Ultimate Find → Fix → Verify Machine
            </h2>

            <div className="space-y-4 text-gray-300">
              <p>
                <code className="text-pink-400 bg-black/30 px-2 py-1 rounded">fix_my_app</code> is
                dev3000's flagship tool that doesn't just find bugs—it fixes them!
              </p>

              <p>
                By analyzing your consolidated logs (server + browser + network), it identifies
                issues, prioritizes them by severity, and can even create focused pull requests for
                the worst issue.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <StepCard
              step="1"
              title="Find All Issues"
              description="Detects errors, warnings, build failures, and performance problems"
              color="pink"
            />
            <StepCard
              step="2"
              title="Prioritize Smart"
              description="Scores issues by severity: build > server > browser > network"
              color="purple"
            />
            <StepCard
              step="3"
              title="Fix & Verify"
              description="Creates focused PR for the worst issue with exact fix code"
              color="blue"
            />
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-8">
            <h3 className="text-white font-semibold mb-4">Priority Scoring</h3>
            <div className="space-y-3">
              <PriorityItem level="1000+" label="Build Errors" color="red" />
              <PriorityItem level="500+" label="Server Errors" color="orange" />
              <PriorityItem level="300+" label="Browser Errors" color="yellow" />
              <PriorityItem level="200+" label="Network Errors" color="blue" />
              <PriorityItem level="100+" label="Warnings" color="gray" />
            </div>
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-8">
            <h3 className="text-white font-semibold mb-4">How to Use</h3>
            <div className="space-y-4 text-gray-300">
              <div className="flex gap-3">
                <span className="text-pink-400 font-bold">1.</span>
                <div>
                  <p className="mb-1">Run your dev3000 development environment</p>
                  <code className="text-sm text-cyan-400 bg-black/30 px-2 py-1 rounded">d3k</code>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-pink-400 font-bold">2.</span>
                <div>
                  <p className="mb-1">Interact with your app and trigger some errors</p>
                  <p className="text-gray-500 text-sm">
                    All interactions are automatically captured
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-pink-400 font-bold">3.</span>
                <div>
                  <p className="mb-1">Ask Claude Code to fix your app</p>
                  <code className="text-sm text-cyan-400 bg-black/30 px-2 py-1 rounded">
                    "fix my app"
                  </code>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-pink-400 font-bold">4.</span>
                <div>
                  <p className="mb-1">Get detailed analysis and automatic fixes</p>
                  <p className="text-gray-500 text-sm">Optionally create a PR with createPR=true</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">Features</h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Smart error prioritization and scoring</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Interaction replay for reproducing bugs</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Automatic screenshot capture on errors</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Focused single-issue PR creation</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Integration with Next.js MCP and Chrome DevTools</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  color,
}: {
  step: string;
  title: string;
  description: string;
  color: string;
}) {
  const colors = {
    pink: "from-pink-500/20 to-pink-500/5 border-pink-500/30",
    purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
  };

  return (
    <div
      className={`bg-gradient-to-br ${colors[color as keyof typeof colors]} border rounded-xl p-6`}
    >
      <div className="text-3xl font-bold text-white mb-3">{step}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function PriorityItem({
  level,
  label,
  color,
}: {
  level: string;
  label: string;
  color: string;
}) {
  const colors = {
    red: "text-red-400 bg-red-500/10 border-red-500/30",
    orange: "text-orange-400 bg-orange-500/10 border-orange-500/30",
    yellow: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    gray: "text-gray-400 bg-gray-500/10 border-gray-500/30",
  };

  return (
    <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-gray-700">
      <span className="text-gray-300">{label}</span>
      <span
        className={`px-3 py-1 ${colors[color as keyof typeof colors]} border rounded-full text-sm font-semibold`}
      >
        {level}
      </span>
    </div>
  );
}
