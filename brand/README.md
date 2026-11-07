# Connectly brand assets

- `final/a-doorway`, `final/b-gap`, `final/c-lean`: the three finalist marks. Each folder has the colour symbol, reversed, one-colour ink/white,
  a small-size cut (use at 24 px and below), horizontal lockups (light and reversed) and a 1024 px app icon. All SVG, paths only.
- `final/PALETTE.md`: the three colours with WCAG contrast ratios and usage rules.
- `final/compare.png` / `compare.html`: side-by-side review sheet.
- `concepts/`: the first-round exploration (kept for reference).
- `tools/build_brand.py`: regenerates everything. The product name is a flag, so renaming is one command:

```bash
pip install fonttools
python3 brand/tools/build_brand.py --name YourName --font brand/fonts/Poppins-SemiBold.ttf --out brand/final
```

The wordmark is outlined from Poppins SemiBold (SIL Open Font License 1.1, stated in the font file). The name "Connectly" is a placeholder.
Trademark clearance has not been done for any mark or name; a professional search is required before launch.
