# Using Vercel Toolbar for Feature Flags

The Vercel Toolbar has been integrated to allow real-time toggling of feature flags during local development.

## Setup

1. The toolbar is already installed and configured in `app/layout.tsx`
2. Flags are defined in `lib/flags.ts`

## Usage

### Local Development

1. Start the dev server: `pnpm dev`
2. Open your browser to `http://localhost:3000`
3. The Vercel Toolbar should appear at the bottom of the page
4. Click the toolbar icon to open it
5. Navigate to the "Flags" tab
6. Toggle the **"demo-cls-bugs"** flag on/off to see the CLS bug in action

### What the Flag Controls

When `demo-cls-bugs` is **enabled**:
- ✅ ChangelogLink renders `null` on server → causes hydration shift (demo bug)
- ✅ CLS detection will catch this shift

When `demo-cls-bugs` is **disabled** (default):
- ✅ ChangelogLink renders invisible placeholder → no shift
- ✅ Production-ready behavior (no bugs)

## Alternative Control Methods

1. **Environment Variable**: Set `NEXT_PUBLIC_DEMO_CLS_BUGS=true` in `.env.local`
2. **Vercel Dashboard**: Override flags in production via Vercel project settings
3. **Code**: Modify the `decide()` function in `lib/flags.ts`

## Testing the CLS Detection

1. Enable the `demo-cls-bugs` flag via toolbar
2. Refresh the page
3. Run `d3k fix_my_jank` in the terminal
4. dev3000 should detect the navigation header shift using the hybrid pixel-diff backup detection
