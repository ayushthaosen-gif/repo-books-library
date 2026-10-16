# Books Library

A catalogue of all the books in our house.

## Goals

- **Scan to add.** Scan a book's barcode (ISBN) with a phone camera and add it to the library, with title, author and cover filled in automatically.
- **Manual entry.** Some books have no ISBN (older books, local prints, gifts), so they can be added by hand with title, author and any other details.
- **Wishlist.** Keep a separate list of books we want but don't own yet, and move them into the library once bought.
- **Browse and search.** Find any book in the house quickly by title, author or where it's shelved.

## How it works

A static web app (no build step). Open it on your phone, then:

- **Scan** opens the camera and reads the ISBN barcode (native `BarcodeDetector`, with ZXing as a fallback). Details come from Open Library, then Google Books. You can also type an ISBN.
- **Works offline and installs to the home screen** (open the site, then use the browser menu: Add to Home Screen). Looking up a new ISBN still needs internet.
- **Lookup tries four sources at once** (Open Library x3, Google Books). Books none of them know open the form with the ISBN filled in.
- **Optional cloud sync** to a free Supabase project (see `docs/SYNC.md`) so the library survives a lost phone and works on several devices.
- **Add by hand** for books with no ISBN.
- **Shelf/room, reading status (unread/reading/read) and "lent to"**, with filters for each (including a "Lent out" filter).
- **Library / Wishlist** tabs, search, and a "Got it" button that moves a wishlist book into the library.
- Data is stored in the browser (`localStorage`) on that device. Use **Export backup / Import backup** to move or save it.

Camera access needs https (or localhost). Run locally with `python3 -m http.server`, or host it free on GitHub Pages: merge to `main`, then in the repo go to Settings > Pages and set Source to "GitHub Actions". The workflow in `.github/workflows/pages.yml` publishes it at `https://<user>.github.io/repo-books-library/`. (`netlify.toml` is also included for Netlify.)

## Using it

1. Open https://ayushthaosen-gif.github.io/repo-books-library/ on your phone and add it to the home screen.
2. **Scan** a book's barcode (the one with the ISBN on the back). Check the details, tap Save, and the scanner reopens for the next book. Untick "Keep scanning" to scan one at a time.
3. No barcode? Tap **Add by hand**, or type the ISBN in the scan window.
4. Put a book on the **Wishlist** by choosing that list when you add it; tap **Got it** when you buy it.
5. Sort by newest, title or author, and filter by shelf, reading status or lent out.
6. Turn on sync once (docs/SYNC.md) so the library is kept safe off the phone.
