# Server-Side Perf Optimizer Example

Purpose: Trigger the `Server-Side Perf Optimizer` dev agent with duplicated server fetches and over-serialization.

Expected fixes (examples):
- Deduplicate repeated server fetches with composition or `cache()`.
- Move expensive request-time work out of the hot path.
- Stop passing oversized server payloads to client components that only need a few fields.
