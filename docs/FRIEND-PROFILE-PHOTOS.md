# Friend profile photos

The shared-connections popup now displays an available public profile photo beside
the person's name. Its photo button opens a separate native dialog above the
existing popup. Closing the photo preserves the information, loaded connection
pages and scroll position underneath.

## Implementation

- `public/profile-photo.js` owns image URL validation, image loading/error state,
  the enlarged dialog, focus restoration, outside clicks and touch gestures.
- `public/app.js` uses the freshly fetched connections response's person record,
  rather than a cached friend-card photo. It renders the thumbnail only for an
  explicitly public profile and closes the viewer when replacing/closing details.
- `public/index.html` loads the helper and contains the additional native dialog.
- `public/styles.css` positions the thumbnail and provides the responsive viewer.

There are no database migrations, dependency changes, new API routes, new account
settings or environment variables. Existing authenticated, caller-scoped lookups
continue to supply `person.photoUrl`; private profiles still have no photo.
No names or image URLs are injected as executable JavaScript. Text and HTML
attributes are escaped. Supported sources match existing uploads (base64 JPEG)
and absolute HTTP/HTTPS images; URLs containing credentials are rejected.
Images do not send a Referer header. Loading an external image still contacts its
hosting server, as it already does for directory photos.

## Interaction

- Activate the photo button with a mouse, touch, Enter or Space.
- The enlarged image uses `object-fit: contain`, so the saved photo is not cropped
  in the viewer. The thumbnail remains circular.
- X or Escape closes only the enlarged image and returns focus to its button.
- A click on the surrounding surface closes the image. Clicking the image itself
  does not. A drag starting on the image does not count as an outside click.
- A single touch moving down at least 90 CSS pixels, with vertical movement more
  than 1.5 times the horizontal movement, closes the image. Short, upward,
  horizontal, cancelled and multi-touch gestures do not. Zoomed-in gestures do
  not dismiss it; browser pinch zoom remains available.
- A native modal dialog keeps keyboard focus above the underlying information.
- Missing or unsupported photos leave the normal profile heading. Failed
  thumbnails hide the photo control; failed enlarged images show a readable
  error with the close button still available.
- Navigation and closing/replacing profile details clear the enlarged image.
  Late image callbacks cannot update a replacement viewer. Known account
  mismatches close profile details. This feature does not introduce a realtime
  subscription for remote profile/privacy changes.

## Existing image limitation

The current upload flow center-crops photos into a 256×256 JPEG before saving.
The viewer displays that entire saved image, which can look soft when enlarged.
It cannot recover the original file's cropped portions. Storing an original
alongside a thumbnail would be a separate change to the upload/storage workflow.

## Verification

Run from the repository root:

```sh
npm test
npm run test:friends:browser
npm run test:browser
```

Node tests cover source/privacy validation, X/Escape, outside-click distinctions,
gesture thresholds, multi-touch, zoom, failed loads, stale callbacks, navigation,
and integration with the real friends popup and backend DTOs.

The friends browser suite includes a public portrait fixture, desktop outside
click, photo click, X, Escape/focus, mobile layout, and Chromium touch input.
The browser suites must be run locally: the development execution environment
blocks Chromium startup. No claim of a completed browser run is made here.

Also check on the running site with real accounts:

1. Open a public friend's information. Confirm the photo and name appear together.
2. Enlarge the photo; close with X, Escape, and an outside click. The information
   popup must stay open, and the photo button should regain keyboard focus.
3. On a physical phone, swipe down to close. Verify horizontal swipes and pinch
   zoom do not dismiss it; use X while zoomed to return to the information.
4. Check a private profile and an account with no photo: no photo control appears.
5. Verify the same behavior from suggestions and incoming/sent request cards.
6. Check a portrait and landscape photo URL if your test data has them. Confirm
   the viewer shows the full saved image, and long names do not overflow.
7. Confirm friend send/cancel/accept/deny/remove and event actions still work.

After these checks, stage only the files listed in the patch package, commit on
a feature branch and open a pull request for review.
