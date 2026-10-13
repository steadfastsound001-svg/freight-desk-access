# Freight Desk access endpoint

Serves the Freight Desk frontend and API through a fixed HTTPS upstream. Shared data remains in the existing Netlify storage. The workspace opens without a password.

Deploy this directory as a Docker web service on Render's Free plan. The application listens on `0.0.0.0:8000`; Render detects the port. No environment variables or persistent disk are required. The Free instance sleeps after 15 minutes of inactivity and may take about a minute to wake up.

Local checks: `deno task test`. Start: `deno task start`.

The upstream host is fixed, requests that change data require a matching Origin, and responses stream without buffering the entire asset. This is a first-party application gateway, not a general proxy.

Anyone with the site URL can access shared orders and operations. Connection tokens remain on the existing backend and are never sent to this gateway as stored credentials.
