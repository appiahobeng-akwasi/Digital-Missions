# Digital Missions

Static marketing site for Digital Missions — the implementation partner that builds the foundational data infrastructure African governments need to act on their own problems.

Live: <https://digitalmissions.technology>

## Stack

- Hand-written HTML5 + CSS3
- Three Google Fonts: **Plus Jakarta Sans**, **Newsreader**, **JetBrains Mono**
- No JavaScript, no build step
- Static deployment on Vercel

## Local development

Serve the site with any static server:

```bash
python3 -m http.server 4444
```

Then visit <http://localhost:4444/>.

## Pages

```
index.html              Home — hero, argument, capabilities, geography
what-we-do.html         Thesis + BUILD / OPERATE / ADVISE pillars
how-we-work.html        Mission lifecycle + operating vocabulary
our-red-lines.html      Public commitments
where-we-operate.html   Regional expansion path
funders.html            Funders & frameworks
contact.html            Engage with us + team
privacy.html            Privacy policy
terms.html              Terms of use
```

## Assets

```
assets/styles.css       Site stylesheet (single file)
assets/dmt-mark.svg     Brand mark (DMT skeletal molecule)
assets/favicon.svg      Browser favicon
```

## Deployment

The `main` branch deploys automatically to Vercel.

`vercel.json` configures:
- Clean URLs (no `.html` suffix in browser bar)
- Security headers (CSP-adjacent, frame protection, referrer policy)
- Long-term caching for assets

## Editorial principles

In order of priority:

1. Seriousness over polish
2. Typography over imagery
3. Restraint over expression
4. Calm over density
5. Clarity over cleverness

Audience: government officials at director / minister level, donor program officers, multilateral and foundation senior staff. Not consumers, not developers, not SaaS buyers.
