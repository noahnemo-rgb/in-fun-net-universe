# In-Fun.net

Enter through the mark, then walk the fairground. Rio is already there.

The sky and the gate are the brand image: black void, white core, rainbow spiral, two beams, and the name in thin warm gold. The park, the playground, and the human potential learning center are signs on the grounds. They open next.

## Open it

From this directory, with Node.js 24:

```bash
npm run dev
```

Open http://localhost:3000. Step in. Click the ground or use the arrow keys. Walk up to Rio and speak.

Rio answers through eve on the Vercel AI Gateway (`openai/gpt-6-luna-fast`). Without a credential the fairground still opens, and Rio says to set `AI_GATEWAY_API_KEY` in `.env.local` or run `eve link` so `VERCEL_OIDC_TOKEN` is pulled. Restart after that.

Add later places and peers in `app/world/places.ts`.
