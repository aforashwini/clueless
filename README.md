# Clueless Closet

A digital wardrobe inspired by Cher's closet computer in *Clueless*. Snap photos of your clothes, let the app cut them out of the background, then flip through tops, bottoms and shoes to build outfits.

## What it does

- **Closet**: add photos by category (tops, bottoms, dresses, outerwear, shoes, accessories, bags). Each photo is cut out of its background and trimmed so the piece fills the frame.
  - *Smart (AI)* cutout works on any background. The model (about 40 MB) downloads once the first time you use it, then runs entirely in your browser.
  - *Simple* cutout works best for clothes laid flat on a plain floor, bed or wall, and is instant.
  - Tap any piece to rename it, change its category, add notes, or redo the cutout (with a strength slider for the simple mode).
- **Match**: the closet computer. Every outfit is dressed on a doll, paper-doll style. Arrow through each category, lock the pieces you like and hit **Shuffle** (or press the space bar) to spin the rest. Switch to **Dress** mode to swap top + bottom for a dress, or tick **Tuck top in**. Pick a scene (studio, beach, city, picnic, night out, museum, plane), then save the look as **Wore it & loved it** or **Want to try**.
  - Pieces are placed on the doll automatically. If one sits wrong, tap it on the doll, drag it into place and use **−/+** (or the scroll wheel) to resize. The fit is saved on that piece, so it sits the same way in every outfit.
- **Lookbook**: your two outfit lists, each shown on the doll in its scene. Log every time you wear a favorite, move a want-to-try look over once you've worn it, change the scene, jot notes, or **Remix** a saved look back in the matcher.

Everything is stored privately in your browser (IndexedDB). Nothing is uploaded anywhere. Use **Lookbook → Backup & restore** to export a backup file or move your closet to another device.

## Running it

It's a plain static site with no build step:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To use it on your phone, turn on GitHub Pages for this repo (Settings → Pages → deploy from branch, root folder) and open the published URL. Taking photos straight from your phone camera works from the **Add clothes** button.

## The doll

`assets/doll.png` is the doll photo with its background removed. The body landmarks the clothes snap to live in `FIT` at the top of `app.js` (as fractions of the doll's width and height), so a different doll in a similar front-facing pose can be swapped in by replacing the image and tweaking those numbers. Scenes are hand-drawn SVGs in `assets/scenes/`.

## Photo tips

- Lay each piece flat on a plain, contrasting background with even light.
- Shoot straight down and leave a little space around the edges.
- Accessories and shoes look best photographed on their own.
