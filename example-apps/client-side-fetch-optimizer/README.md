# Client-Side Fetch Optimizer Example

Purpose: Trigger the `Client-Side Fetch Optimizer` dev agent with duplicate client requests and redundant browser subscriptions.

Expected fixes (examples):
- Share one request layer across widgets instead of fetching the same endpoint repeatedly.
- Introduce SWR or an equivalent deduping strategy.
- Consolidate duplicate resize listeners and repeated local storage work.
