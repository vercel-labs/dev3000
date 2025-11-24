# Contributing to dev3000

Thank you for your interest in contributing to dev3000! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js >= v22.12.0
- pnpm package manager
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/dev3000.git
   cd dev3000
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run the development build**
   ```bash
   pnpm dev
   ```

4. **Run tests**
   ```bash
   pnpm test
   ```

5. **Lint your code**
   ```bash
   pnpm lint
   ```

## Project Structure

```
dev3000/
├── src/              # Main source code
├── mcp-server/       # Model Context Protocol server
├── chrome-extension/ # Browser extension for monitoring
├── www/              # Web interface for log viewing
├── docs/             # Documentation
└── .github/          # GitHub workflows and configuration
```

## Development Workflow

1. **Create a new branch** for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   or
   ```bash
   git checkout -b fix/issue-number
   ```

2. **Make your changes** following the code style guidelines

3. **Test your changes** locally:
   - Run the test suite: `pnpm test`
   - Run the linter: `pnpm lint`
   - Test manually with a sample project

4. **Commit your changes** with clear, descriptive messages:
   ```bash
   git commit -m "feat: add new feature"
   ```
   or
   ```bash
   git commit -m "fix: resolve issue #123"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** with:
   - Clear description of changes
   - Reference to any related issues
   - Screenshots/recordings if applicable
   - Test results

## Code Style Guidelines

- Follow the existing code style in the project
- Use TypeScript for type safety
- Run `pnpm lint` before committing
- Write clear, self-documenting code
- Add comments for complex logic

## Commit Message Convention

We follow conventional commits for clear git history:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for Vite projects
fix: resolve port detection issue on Windows
docs: update installation instructions
```

## Reporting Bugs

When reporting bugs, please include:

1. **Environment details**:
   - dev3000 version
   - Node.js version
   - Package manager (pnpm/npm/yarn) and version
   - Operating system
   - Browser version (if applicable)
   - Framework and version (e.g., Next.js 16.0.3)

2. **Steps to reproduce** the issue

3. **Expected behavior** vs **actual behavior**

4. **Logs** (from `~/.d3k/logs/` if available)

5. **Screenshots or recordings** if applicable

## Feature Requests

We welcome feature suggestions! Please:

- Check if the feature has already been requested
- Provide a clear use case
- Explain how it benefits users
- Include examples if possible

## Testing

- Write tests for new features
- Ensure existing tests pass
- Test with different frameworks (Next.js, React, Vue, etc.)
- Test on different operating systems when possible

## Documentation

- Update README.md if adding new features
- Add JSDoc comments to functions
- Update relevant documentation in `/docs`
- Include code examples where helpful

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`pnpm test`)
- [ ] Code lints without errors (`pnpm lint`)
- [ ] Changes are documented
- [ ] Commits follow conventional commit format
- [ ] Branch is up to date with main

### PR Description Should Include

- Summary of changes
- Motivation and context
- Related issue numbers (e.g., "Fixes #123")
- Screenshots/recordings for UI changes
- Breaking changes (if any)
- Testing performed

### Review Process

- Maintainers will review your PR
- Address any requested changes
- Once approved, your PR will be merged

## Questions?

- Open a [GitHub Discussion](https://github.com/vercel-labs/dev3000/discussions)
- Check existing [Issues](https://github.com/vercel-labs/dev3000/issues)
- Review the [Documentation](https://github.com/vercel-labs/dev3000/tree/main/docs)

## Code of Conduct

Be respectful and constructive. We're all here to make dev3000 better.

## License

By contributing to dev3000, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to dev3000! 🎉
