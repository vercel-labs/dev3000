import Link from "next/link";
import { ArrowRight, Code2, Database, Globe, Sparkles } from "./components/Icons";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold mb-6">
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              dev3000
            </span>
            {" + "}
            <span className="text-white">Next.js 16</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto text-balance">
            A sample Next.js 16 application demonstrating modern features with dev3000 integration
            for AI-powered development monitoring
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <FeatureCard
            icon={<Code2 />}
            title="Server Actions"
            description="Form handling and data mutations without API routes"
            href="/demos/server-actions"
          />
          <FeatureCard
            icon={<Sparkles />}
            title="Parallel Routes"
            description="Multiple views with independent loading states"
            href="/demos/parallel-routes"
          />
          <FeatureCard
            icon={<Database />}
            title="TypeScript"
            description="Full type safety across Server and Client Components"
            href="/demos/counter"
          />
          <FeatureCard
            icon={<Globe />}
            title="Turbopack"
            description="Fast development builds with Hot Module Replacement"
            href="/demos/server-actions"
          />
        </div>

        {/* Demo Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
          <DemoCard
            title="Interactive Todo App"
            description="Server Actions with progressive enhancement and optimistic UI"
            href="/demos/server-actions"
            gradient="from-purple-500 to-pink-500"
          />
          <DemoCard
            title="Advanced Routing"
            description="Parallel routes with independent loading and error states"
            href="/demos/parallel-routes"
            gradient="from-blue-500 to-cyan-500"
          />
        </div>

        {/* Additional Demos */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">More Demos</h2>
            <p className="text-gray-400 text-center mb-6">
              Explore additional Next.js 16 features and dev3000 integration examples
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Link
                href="/demos/counter"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 border border-cyan-500/50 text-white font-semibold py-3 px-4 rounded-lg transition-all"
              >
                Counter
              </Link>
              <Link
                href="/demos/context7"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/50 text-white font-semibold py-3 px-4 rounded-lg transition-all"
              >
                Context7
              </Link>
              <Link
                href="/demos/nextjs-mcp"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 border border-green-500/50 text-white font-semibold py-3 px-4 rounded-lg transition-all"
              >
                MCP
              </Link>
              <Link
                href="/demos/browser-automation"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 hover:from-orange-500/30 hover:to-red-500/30 border border-orange-500/50 text-white font-semibold py-3 px-4 rounded-lg transition-all"
              >
                Browser
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-gray-800 text-center">
          <p className="text-gray-400 mb-2">
            Built with <span className="text-white font-semibold">Next.js 16</span> +
            <span className="text-blue-400 font-semibold"> React 19</span> +
            <span className="text-cyan-400 font-semibold"> TypeScript</span>
          </p>
          <p className="text-gray-600 text-sm mb-1">
            Monitored by <span className="text-cyan-400">dev3000</span> for AI-powered debugging
          </p>
          <p className="text-gray-600 text-sm">Edit any file to see hot reload with Turbopack ⚡</p>
        </footer>
      </main>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative bg-gray-800/30 border border-gray-700 rounded-xl p-6 hover:bg-gray-800/50 hover:border-cyan-500/50 transition-all duration-300"
    >
      <div className="text-cyan-400 mb-4 transform group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowRight size={16} />
      </div>
    </Link>
  );
}

function DemoCard({
  title,
  description,
  href,
  gradient,
}: {
  title: string;
  description: string;
  href: string;
  gradient: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden bg-gray-800/30 border border-gray-700 rounded-2xl p-8 hover:border-gray-600 transition-all duration-300"
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}
      />
      <h3 className="text-2xl font-bold text-white mb-3 relative z-10">{title}</h3>
      <p className="text-gray-400 mb-4 relative z-10">{description}</p>
      <div className="flex items-center gap-2 text-cyan-400 font-semibold relative z-10">
        View Demo
        <ArrowRight size={20} />
      </div>
    </Link>
  );
}
