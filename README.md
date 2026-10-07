# The Fun Juice Box Game

A mobile-friendly family app for a shared phone, based on your kids’ posters. It includes named players, a rear-camera scanner, photo input, colour suggestions with confirmation, server-saved scores, a points ledger, and family reward requests.

## Run it

Install Node.js 24 or newer. No package downloads are needed.

```sh
cd juice-box-game
npm start
```

Open `http://localhost:3000` on that computer. Add player nicknames and choose one before collecting points. Scores are stored in `data/game.sqlite`, not in the browser. Back up that file while the server is stopped. The database must be on a persistent volume if deploying in a container.

## Play on a phone

Phone cameras require **HTTPS** (or localhost on the phone itself). Host the app behind an HTTPS reverse proxy, with a shared family password. Set `HOST=0.0.0.0` and `FAMILY_PASSWORD` to a password of at least 12 characters. The reverse proxy should supply `X-Forwarded-Proto: https`, preserve the request host, and be the only publicly reachable route to the app. Every family member uses the same password; profiles are nicknames within the family, not separate accounts.

For a quick private trial, use an HTTPS tunnel to the local server **after** setting `FAMILY_PASSWORD`, or deploy the included Dockerfile on a host with HTTPS and a persistent `/app/data` volume. The default server binds only to localhost. Merely opening a computer’s HTTP address on a phone will not enable the live camera. Photo input and manual entry remain available.

Configure variables through the shell or hosting provider; this app does not load `.env` files automatically. Supported variables: `PORT` (3000), `HOST` (127.0.0.1), `FAMILY_PASSWORD`, and `DB_PATH` (`data/game.sqlite`). Family login expires after seven days or a server restart. Do not expose this family prototype to the public without stronger account and administrator controls.

## Scanning and rules

- Rainbow: 2 points.
- Blue & brown, blue & pink, yellow & black: 1 point each.
- Two identical symbols on the **two flaps of the same box**: 100 points total, replacing the ordinary points.
- Different symbols: add their ordinary point values.
- A single flap can be claimed separately, but the app cannot later combine it with another claim for the 100-point bonus. Scan both together for doubles.

The scanner crops the square in the camera preview, counts colours, and suggests one of the four symbol types. **It is a colour heuristic, not a trained vision model.** It always requires human confirmation and abstains when colours are unclear. Real printed stamp photos were not supplied, so recognition accuracy on Kirkland boxes has not been validated. Flatten the flap, fill the square with just the stamp, and use neutral, bright lighting. Uploaded photos should be close-ups of a single stamp.

Photos are processed on the device and discarded when the box is finished. The server receives the confirmed symbols and SHA-256 fingerprints of the photos. It rejects reuse of identical photos and repeated submission IDs. **It cannot identify a physical box from its repeated printed symbol:** different photos of the same flap may still earn points. Manual entries use the family honesty rule too. Reliable one-use enforcement would need unique codes added to the boxes.

Reward requests deduct points and appear in the activity list. A grown-up must supply the reward. The app does not issue cash, purchase tickets, or send gift cards. The prices match the poster, including $100 cash at 600 points; adjust `game.mjs` if your family wants different prizes or prices. Adult approval, cancellation/refunds, and fulfillment tracking are not implemented.

## Checks

```sh
npm test
```

Tests cover every symbol combination, invalid symbols, colour-suggestion abstention, login, points isolation between players, duplicate-photo prevention, concurrent retry protection, insufficient balances, reward retries, and persistence across restart. They do not establish real-camera recognition accuracy.

## Delivery status

The runnable source is complete. Automatic Sites publication was unavailable because this workspace did not contain the Sites setup and publishing scripts; no live URL was created. Phone camera performance still needs an HTTPS deployment and tests with actual printed flap photos.
