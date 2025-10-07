export function GitHubLink({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://github.com/vercel-labs/dev3000"
      target="_blank"
      rel="noopener noreferrer"
      className={`text-sm text-muted-foreground hover:text-foreground hover:underline flex items-center transition-colors ${className}`}
    >
      GitHub
    </a>
  )
}
