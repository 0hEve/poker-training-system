# Poker table samples

- Warm card stock, muted court colors, oxblood backs, and green felt evoke an illustrated tabletop game. Slightly irregular ink contours, short hatch marks, and seeded flecks give the artwork a printed feel.
- Each chip has eight rim inserts, a double-ring inlay, and a visible sidewall. The sample stack compresses and offsets the same SVGs so the sidewall and inserts read at an angle.
- Cards use a 5:7 viewBox with mirrored corner indices. Lower pips rotate with the card. The Ace of Spades has an engraved-style emblem, while the double-ended King, Queen, and Jack carry a sword, rose, and spear.
- Bold corner indices, clear suit silhouettes, and high-contrast chip values carry the information at 70 px card and 40 px chip widths. Texture and fine detail recede at those sizes.
- The dependency-free module accepts full lowercase suit names, ranks A, 2–10, J, Q, K, and chip values 1, 5, 10, 25, 100, 500, 1000. SVG strings are deterministic and safe to repeat inline because they use no IDs.
- Card-stock grain is precomputed, and speckles are packed into two paths per textured region. SVGs use no filters or animations. Cache the strings by rank/suit or denomination when rendering a table. The sample rasterizes one reusable background tile at startup and uses CSS for shadows and hover transforms.
