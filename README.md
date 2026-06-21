# MovieBox Stremio Addon

A dependency-free Node.js Stremio stream addon that resolves IMDb/TMDB ids and fetches MovieBox streams with signed MovieBox API requests.

## Run locally

```sh
npm start
```

The addon manifest is available at:

```text
http://127.0.0.1:7000/manifest.json
```

## Run on Android with Termux

This project does not require native modules or npm dependencies, so it can run directly in Termux on Android.

1. Install Termux from F-Droid.
2. Install Node.js and Git:

   ```sh
   pkg update -y
   pkg install -y nodejs git
   ```

3. Clone or copy this repository onto the phone.
4. Start the addon:

   ```sh
   npm run termux
   ```

   Or run the script directly:

   ```sh
   ./scripts/start-termux.sh
   ```

5. In Stremio on the same phone, install the addon with:

   ```text
   http://127.0.0.1:7000/manifest.json
   ```

6. From another device on the same Wi-Fi network, find your phone IP and use:

   ```text
   http://PHONE_IP:7000/manifest.json
   ```

### Termux options

Change the port:

```sh
PORT=8080 npm run termux
```

Bind to localhost only:

```sh
HOST=127.0.0.1 npm run termux
```

Keep Termux running while the screen is off:

```sh
termux-wake-lock
npm run termux
```

## Vercel

The project includes `api/addon.js` and `vercel.json`, so Vercel rewrites addon routes to the serverless handler.

## Checks

```sh
npm run check
npm test
```
