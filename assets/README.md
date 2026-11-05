# Plugin logo

`icon.svg` is the source and shipped bruce-md2word plugin logo. It contains only
a Markdown **M** and a right-pointing conversion arrow, drawn as two paths in a
32 × 32 viewBox. Both use the same 4-unit stroke, round caps and round joins.
The only colour is brand blue `#2563EB`; the background is transparent.
There are no embedded images, fonts, shadows, filters or gradients.

The SVG replaces the first imagegen concept, removing its document silhouette,
folded corner, output panel and text lines. The final vector was drawn directly
as paths rather than traced from the generated bitmap.

`package.json.icon` and the `./icon` export both reference `icon.svg`, which is
included in the npm `files` list. `icon.png` is a 512 × 512 preview rendered from
the SVG, not the plugin's shipped icon.

To regenerate the PNG preview with the project's existing Sharp dependency:

```sh
node --input-type=module -e "import sharp from 'sharp'; await sharp('assets/icon.svg').resize(512, 512).png().toFile('assets/icon.png');"
```

Review the icon at its actual 16, 32 and 64 pixel sizes on light and dark
backgrounds. The installed-plugin reader and market generator accept
package-local SVG icons up to 256 KiB. See the upstream
[plugin market generator documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/plugin-market-generator/README.md).
