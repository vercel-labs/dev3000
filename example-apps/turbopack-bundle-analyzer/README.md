# Turbopack Bundle Analyzer Example

Purpose: Trigger the `turbopack-bundle-analyzer` workflow with a deliberately bad shipped-JS pattern.

Intentional mistakes on `/`:
- Entire page is a client component (`"use client"`).
- A large static JSON catalog (~2MB source) is imported directly into the homepage bundle.
- A second large JSON promo feed (~1.5MB source) is also imported into the homepage bundle.
- Expensive client-side filtering/sorting runs on each search update.

Expected fixes (examples):
- Move heavy data handling to server-side boundaries.
- Avoid importing giant static payloads into initial route JS.
- Load large datasets lazily or via API route/server action.
