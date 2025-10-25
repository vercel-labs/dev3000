import { useState } from 'react'

export default function Home() {
  const [count, setCount] = useState(0)

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        <h1 style={styles.title}>
          Welcome to <span style={styles.gradient}>dev3000</span> + Next.js 15
        </h1>

        <p style={styles.description}>
          AI-powered development tools with browser monitoring and MCP server integration
        </p>

        <div style={styles.grid}>
          <Card
            title="🔧 fix_my_app"
            description="AI-powered debugging with interaction replay. Ask Claude to 'fix my app' for instant error analysis and solutions."
            href="http://localhost:3684"
          />

          <Card
            title="📊 Logs Viewer"
            description="Comprehensive timeline of server logs, browser events, and automatic screenshots."
            href="http://localhost:3684/logs"
          />

          <Card
            title="🌐 Browser Automation"
            description="Execute browser actions, take screenshots, and replay user interactions via MCP tools."
            href="http://localhost:3684"
          />

          <Card
            title="🐳 Docker + WSL"
            description="Running in Docker with Chrome on host via CDP. Cross-platform support for Windows, macOS, and Linux."
            href="https://github.com/vercel-labs/dev3000"
          />
        </div>

        <div style={styles.counter}>
          <h2>Counter Example</h2>
          <p style={styles.count}>{count}</p>
          <div style={styles.buttons}>
            <button style={styles.button} onClick={() => setCount(count + 1)}>
              Increment
            </button>
            <button style={styles.button} onClick={() => setCount(count - 1)}>
              Decrement
            </button>
            <button style={{...styles.button, ...styles.resetButton}} onClick={() => setCount(0)}>
              Reset
            </button>
          </div>
        </div>

        <footer style={styles.footer}>
          <p>Powered by dev3000 + Next.js 15 + React 19</p>
          <p style={styles.muted}>Try editing this file to see hot reload in action!</p>
        </footer>
      </main>
    </div>
  )
}

function Card({ title, description, href }) {
  return (
    <a href={href} style={styles.card} target="_blank" rel="noopener noreferrer">
      <h3>{title}</h3>
      <p>{description}</p>
    </a>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    padding: '0 2rem',
    backgroundColor: '#0a0a0a',
    color: '#ffffff'
  },
  main: {
    minHeight: '100vh',
    padding: '4rem 0',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    lineHeight: 1.15,
    fontSize: '4rem',
    textAlign: 'center'
  },
  gradient: {
    background: 'linear-gradient(to right, #00d4ff, #0070f3)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  },
  description: {
    marginTop: '1.5rem',
    lineHeight: 1.5,
    fontSize: '1.5rem',
    textAlign: 'center',
    maxWidth: '800px',
    color: '#888'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '2rem',
    maxWidth: '1200px',
    marginTop: '3rem',
    width: '100%'
  },
  card: {
    padding: '1.5rem',
    textAlign: 'left',
    color: 'inherit',
    textDecoration: 'none',
    border: '1px solid #333',
    borderRadius: '10px',
    transition: 'all 0.3s ease',
    backgroundColor: '#111',
    cursor: 'pointer'
  },
  counter: {
    marginTop: '3rem',
    padding: '2rem',
    border: '1px solid #333',
    borderRadius: '10px',
    backgroundColor: '#111',
    textAlign: 'center',
    minWidth: '300px'
  },
  count: {
    fontSize: '3rem',
    margin: '1rem 0',
    fontWeight: 'bold',
    color: '#00d4ff'
  },
  buttons: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  button: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#fff',
    backgroundColor: '#0070f3',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  resetButton: {
    backgroundColor: '#555'
  },
  footer: {
    marginTop: '4rem',
    paddingTop: '2rem',
    borderTop: '1px solid #333',
    textAlign: 'center'
  },
  muted: {
    color: '#666',
    fontSize: '0.9rem',
    marginTop: '0.5rem'
  }
}
