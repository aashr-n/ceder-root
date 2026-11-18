# Diagrams

How to draw a pack's diagrams. Read by the author of a pack that has pictures and by the illustrator.

Draw each as an SVG on a 1200 by 900 canvas. It will be shown about 350 points wide on a phone, so draw big and simple.

- First element: `<rect width="1200" height="900" rx="44" fill="#FBF8F1"/>`.
- Palette: forest `#2C4A3B`, terracotta `#C96E52`, sand `#F2C091`, blue-grey `#7A99B3`, ochre `#BA9957`, sage `#B8C99E`, ink `#1D2A24`. Outlines 4 to 6 wide in ink or a darker shade of the fill. Soft gradients are fine; drop shadows and filters are not allowed.
- A diagram that `label` items use has no words on it and at least 4 hotspots. Give each part a distinct shape and colour so it can be found without a caption. Hotspot radius at least 0.05, and no two overlap.
- A diagram only used in explanations may carry short labels: `font-family="sans-serif"` (the build sets it in DejaVu Sans), size 34 or more, ink on a light shape.
- Render and look at every diagram before you finish: `node tools/render.mjs <file.svg> <file.png>` from the repository's root, then open the PNG. Check that each hotspot's centre really sits on its part. Redraw until someone who knows the subject would recognise it at a glance.
- Add one `sequence` over a diagram when the topic has steps: 3 to 7 steps, each focused on a hotspot.
