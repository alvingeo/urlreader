# Preview image (`preview.png`)

[Tiny Tool Town](https://tinytooltown.com/) and GitHub use the first image in the main **README** for listings. That file is **`docs/preview.png`** (path from repo root).

## Create the screenshot (once)

1. From the repo root, run:

   ```bash
   npm install
   npm run dev
   ```

2. Open the URL Vite prints (usually `http://localhost:5173`).

3. Load a sample image (paste, drop, or **Choose file**) so **highlights** and the **sidebar** are visible—this makes a better card image.

4. Capture the **browser window** or the app area only:

   - **macOS:** `Shift + Command + 4`, then drag a rectangle; the PNG lands on your Desktop (or use **Screenshot** app).
   - **Windows:** `Win + Shift + S` (Snipping Tool).

5. Save or copy the file to this folder as **`preview.png`**:

   ```text
   urlreader/docs/preview.png
   ```

   (Exact name and folder matter so the README image link works.)

6. Commit and push from the repo root:

   ```bash
   git add docs/preview.png README.md
   git commit -m "Add README preview image for listings"
   git push origin main
   ```

If `preview.png` is missing, the README image on GitHub will show as broken until you add it.
