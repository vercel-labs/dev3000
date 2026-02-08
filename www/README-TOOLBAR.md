# Using Vercel Toolbar for Feature Flags

The Vercel Toolbar is integrated to allow real-time toggling of feature flags during local development.

## Setup

1. The toolbar is already installed and configured in `app/layout.tsx`
2. Flags are defined in `flags.json`

## Usage

### Local Development

1. Start the dev server: `bun dev` (or `npm/pnpm/yarn dev`)
2. Open your browser to `http://localhost:3000`
3. The Vercel Toolbar should appear at the bottom of the page
4. Click the toolbar icon to open it
5. Navigate to the "Flags" tab
6. Toggle any available flags

## Alternative Control Methods

1. **Environment Variables**: Set the relevant `NEXT_PUBLIC_...` values in `.env.local`
2. **Vercel Dashboard**: Override flags in production via Vercel project settings
3. **Code**: Update `flags.json`

## Testing the CLS Detection

No CLS demo flags are currently configured.
