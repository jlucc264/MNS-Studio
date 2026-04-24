# MNS Studio Deployment

## Recommended setup

- Frontend: Vercel
- Backend: Render
- Domain:
  - `yourdomain.com` -> frontend
  - `www.yourdomain.com` -> frontend
  - `api.yourdomain.com` -> backend

## Frontend

The frontend lives in `Frontend/` and is a standard Next.js app.

### Vercel settings

- Framework preset: `Next.js`
- Root directory: `Frontend`
- Build command: `npm run build`
- Output setting: default

### Frontend environment variable

Set this in Vercel:

```bash
NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
```

You can copy the template from [Frontend/.env.example](/Users/johnlucciola/MNS/Frontend/.env.example).

## Backend

The backend lives in `Backend/` and runs FastAPI with Uvicorn.

### Render settings

- Service type: `Web Service`
- Root directory: `Backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

You can also use the included [render.yaml](/Users/johnlucciola/MNS/render.yaml).

### Backend environment variable

Set this in Render:

```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

You can copy the template from [Backend/.env.example](/Users/johnlucciola/MNS/Backend/.env.example).

Optional image-search upgrade:

```bash
GOOGLE_CUSTOM_SEARCH_API_KEY=your_google_api_key
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=your_programmable_search_engine_id
```

If those are set, the backend will use Google Custom Search image results first, then fall back to Openverse and Wikimedia Commons.

## Important note about files

This app stores uploads, previews, and finalized PDFs on the backend filesystem under:

- `Backend/assets/uploads`
- `Backend/assets/previews`
- `Backend/assets/finalized`

For production, your backend host needs persistent storage if you want those files to survive restarts and redeploys.

With Render, attach a persistent disk to the backend service and mount it so those files remain available.

## DNS

Typical setup:

- `yourdomain.com` -> Vercel
- `www.yourdomain.com` -> Vercel
- `api.yourdomain.com` -> Render backend

The exact DNS records depend on your registrar and the host dashboards, but this is the split you want.

## Recommended order

1. Deploy backend to Render.
2. Confirm backend health works at `https://api.yourdomain.com/health`.
3. Deploy frontend to Vercel with `NEXT_PUBLIC_API_BASE` set.
4. Connect your root domain and `www` to Vercel.
5. Add your production frontend domains to `ALLOWED_ORIGINS` on the backend.
