This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## MVP API routes

All database access is server-only and uses `SUPABASE_URL` plus
`SUPABASE_SECRET_KEY`. Never expose either value with a `NEXT_PUBLIC_` prefix.
Set `DEMO_USER_ID` to pin the demo account; when omitted, the oldest onboarded
user is selected.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/onboarding` | Create a user from `totalBalance`, `monthlyFixedOutflow`, and optional `safetyBuffer` |
| GET | `/api/contracts` | Recalculate statuses, persist changed rows, and return contracts |
| POST | `/api/contracts` | Store a user-confirmed contract and return the refreshed dashboard |
| PATCH | `/api/contracts/:id/status` | Apply `risk` or `cancel` with a required reason |
| GET | `/api/dashboard` | Return the optimistic/baseline/pessimistic cash-flow result |
| POST | `/api/whatif` | Compare up to three what-if assumptions |

For GET routes, `?userId=<uuid>` can override `DEMO_USER_ID`. POST routes accept
the same value as `userId` in their JSON body. Authentication and per-user RLS
are intentionally deferred beyond the MVP; the secret key must stay on the server.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
