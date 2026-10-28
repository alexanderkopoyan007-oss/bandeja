# Reference photos

Public photos of real padel courts used by the photo-match mode (`?photo=<id>`, Phase 5). They are not in the repo or
the build: `node tools/fetch-reference.mjs` downloads them from Wikimedia Commons into `reference/photos/` (gitignored)
for `npm run dev`. `photos.json` holds each photo's marked court points and the camera `tools/photo-solve.ts` fitted to
them. The photos show real events and people; they are compared against, never shipped.

| id | what | author | licence | source |
|---|---|---|---|---|
| `day-framed` | outdoor, day, overcast; framed court, green turf | David Hawgood | CC BY-SA 2.0 | https://commons.wikimedia.org/wiki/File:Padel_court,_Regent%27s_Park_-_geograph.org.uk_-_7406779.jpg |
| `day-glass` | outdoor, day; the glass close up, reflections | David Hawgood | CC BY-SA 2.0 | https://commons.wikimedia.org/wiki/File:Regent%27s_Park_padel_court,_showing_glass_walls_-_geograph.org.uk_-_7406792.jpg |
| `day-panoramic` | outdoor, day; panoramic court, blue turf, from behind the back glass | OCHAPPS | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:University_of_Cambridge_Padel_Courts.jpg |
| `day-hyde` | outdoor, day; framed court, green turf | David Hawgood | CC BY-SA 2.0 | https://commons.wikimedia.org/wiki/File:Padel_court_at_Hyde_Park_Tennis_Centre_-_geograph.org.uk_-_7408224.jpg |
| `day-lights` | outdoor, day, sun; blue turf, floodlight poles | Sotos | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Court_de_padel_de_Vic-en-Bigorre_(Hautes-Pyr%C3%A9n%C3%A9es)_1.jpg |
| `night` | outdoor, night, floodlit; green turf | Thomas Roberts | CC BY-SA 2.0 | https://commons.wikimedia.org/wiki/File:Padel_Courts_at_Barnt_Green_Sports_Club_-_geograph.org.uk_-_8271890.jpg |
| `hall` | covered club hall, day; blue turf | Samson Ssemakadde | CC0 | https://commons.wikimedia.org/wiki/File:Padel_court.jpg |
| `hall-2` | covered club hall, day; blue turf, from the end | Samson Ssemakadde | CC0 | https://commons.wikimedia.org/wiki/File:Padel_court12.jpg |
| `arena-wide` | indoor arena, pro event; the whole court from the stands | Harpagornis | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Vigo_Open_2019_de_World_Padel_Tour_-_32.jpg |
| `arena-wide-2` | indoor arena, pro event; the whole court from high in the stands | Harpagornis | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Vigo_Open_2019_de_World_Padel_Tour_-_33.jpg |
| `arena-glass` | indoor arena, pro event; court level behind the back glass | Harpagornis | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Vigo_Open_2019_de_World_Padel_Tour_-_10.jpg |
