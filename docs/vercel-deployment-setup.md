# Vercel Deployment Setup

This project no longer ships a standalone server. Cloud workflows run from the dev3000 app deployment (`www/`).

If you need to deploy dev3000:

1. Create a Vercel project rooted at `www/`.
2. Configure required environment variables (e.g. `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`) as needed.
3. Deploy and monitor logs in Vercel.

For integration setup, see `INTEGRATION_SETUP.md`.
