# Re-render Optimizer Example

Purpose: Trigger the `Re-render Optimizer` dev agent with unnecessary render churn and expensive derived work.

Expected fixes (examples):
- Stop rebuilding large arrays on every render.
- Derive filtered state during render instead of with effects.
- Move transient, high-frequency values out of state when they do not affect visible UI.
