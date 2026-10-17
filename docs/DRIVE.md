# Family PDFs and EPUBs from a private Google Drive folder

Your books folder in Google Drive stays **private**. A small function in your own Supabase project reads it for people who have a library login, so nobody needs a Google sign-in and nobody outside the family can open it.

How it works: a Google "service account" is a robot login. You share the Drive folder with the robot like you would with a person. The robot's key is stored as a Supabase secret (never in the app or this repository). When a family member taps **More > Get PDFs from Drive**, the app asks the function, which checks their library login first.

You do this once, about 20 minutes. **Never paste the robot's key into chat or into any file in this repository.**

## 1. Create the robot in Google Cloud

1. Go to <https://console.cloud.google.com/>, create a project (any name).
2. **APIs & Services > Library**: search "Google Drive API" and click **Enable**.
3. **APIs & Services > Credentials > Create credentials > Service account**. Give it a name and finish.
4. Open the new service account, then **Keys > Add key > Create new key > JSON**. A file downloads. Keep it private. Also note the account's email (looks like `name@project.iam.gserviceaccount.com`).

## 2. Share the folder with the robot

In Google Drive, right-click your books folder, **Share**, add the robot's email as **Viewer**. Keep "General access" on **Restricted**. Then open the folder and copy the folder id from the address bar: the part after `/folders/` (before any `?`).

## 3. Put the key and folder in Supabase secrets

In your Supabase project open **Edge Functions > Secrets** (or **Project Settings > Edge Functions**) and add:

| Name | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT` | the whole contents of the downloaded JSON file |
| `DRIVE_FOLDER_ID` | the folder id from step 2 |
| `OWNER_EMAIL` | your own library login email (optional; lets you use it before adding any family) |

Family members are recognised from the family step in `SYNC.md` (step 5).

## 4. Deploy the function

Either way gives the same result.

- **Dashboard:** **Edge Functions > Deploy a new function**, name it exactly `drive`, paste in the contents of `supabase/functions/drive/index.ts`, and deploy. Leave "Verify JWT" **on**.
- **Command line:** with the Supabase CLI logged in, run `supabase functions deploy drive --project-ref YOUR_PROJECT_REF` from this repository.

## 5. Use it

Open the app, make sure sync is signed in, tap **More > Get books from Drive**. The app lists every PDF in the folder (and its sub-folders) and guesses which book each belongs to from the file name. Fix any wrong guess, tap **Save selected on this phone**, then open the book and tap **Read**. PDFs open page by page; EPUBs reflow, with text size and page colours (light, sepia, night), and reopen where you left off. Each person does this on their own phone, because the PDFs are stored on the phone.

## Limits

- Very large PDFs can hit Supabase's free time or size limits for a function. If one fails, open it from Drive instead.
- Only PDF and EPUB files are listed (not Google Docs or shortcuts). Only files inside the shared folder can be fetched.
- Updating the app does not update the function. After a new version of `supabase/functions/drive/index.ts`, paste it into the `drive` function again and deploy.

## If the list is empty or shows an error

- *"The robot cannot open the folder"*: `DRIVE_FOLDER_ID` is wrong, or the folder is not shared with the robot's email (the message names it) as Viewer.
- *"The folder opened but has no PDF or EPUB files"*: the robot can open the folder but the files are another type (for example Google Docs) or are shortcuts.
- To stop all access, unshare the folder from the robot or delete the secret.
