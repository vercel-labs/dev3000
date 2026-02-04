# dev3000 Integration Setup

This guide covers advanced configuration for the dev3000 Vercel integration.

> Note: The legacy server is no longer used. The integration now runs in the dev3000 app deployment.

## 1. Deploy dev3000

Deploy the `www/` app to Vercel (or use the hosted instance at https://dev3000.ai).

## 2. Configure Webhook

In your Vercel project:

1. **Settings → Integrations → Webhooks**
2. Add webhook:
   - **URL**: `https://dev3000.ai/api/integration/webhook` (or your deployment URL)
   - **Event**: Deployment Created
   - **Secret**: Any random string (store it for reference)

## 3. Optional: PR Comments

To post results back to GitHub PRs, add `GITHUB_TOKEN` to the dev3000 deployment environment and redeploy.

## 4. Logs & Troubleshooting

- View logs in the dev3000 deployment on Vercel.
- Look for `[Webhook]` and workflow status entries.

## Support

- Issues: https://github.com/vercel-labs/dev3000/issues
- Quick start: `QUICK_START.md`
