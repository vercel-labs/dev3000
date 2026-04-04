# Bundle Size Optimizer Example

Purpose: Trigger the `Bundle Size Optimizer` dev agent with a route that ships far too much JavaScript.

Expected fixes (examples):
- Remove an unnecessary top-level client boundary.
- Stop importing a large static catalog into the initial bundle.
- Dynamically load low-value heavy UI that is hidden behind user intent.
