# Eliminate Waterfalls Example

Purpose: Trigger the `Eliminate Waterfalls` dev agent with realistic async dependency problems.

Expected fixes (examples):
- Parallelize independent server requests with `Promise.all()`.
- Start dependent work earlier and await later.
- Remove sequential per-item fetch loops from server components.
