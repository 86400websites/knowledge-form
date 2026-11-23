# Change the Drive account and keep the existing form

The public address is https://86400websites.github.io/knowledge-form/. The form reads its index from Google Sheets. The Google account that deploys the Apps Script web app owns new uploads in My Drive. In a shared drive, the organization owns the files.

## What to provide in a new session

1. Give the new Google account email and a link to the destination Drive folder. Say whether it is in My Drive or a shared drive. The new account must be able to create folders and files there.
2. Confirm that the current index should be retained. The current index is the spreadsheet referenced by the live project's SHEET_ID property. Give the new account Editor access to it through Google's Share dialog. Share the destination with the people who should be able to open files. The repository access key and Google file permissions are separate.
3. Say what should happen to existing test records and files. Keeping the current Sheet also keeps its records and managed keywords. Decide whether previously recorded files stay accessible at their current URLs, move with their IDs intact, or should be archived before launch. If old folder paths will refer to a different physical folder, reconcile the folder map and test existing results before switching. Confirm any deletion separately.
4. Authorize the new Google account through Google's own sign-in prompt when requested. Enable the Apps Script API in that account's user settings if needed. Keep passwords, verification codes, OAuth tokens and repository access keys out of chat and GitHub.

## Release checklist for the person doing the handover

5. Verify the current GitHub Pages deployment, Apps Script version, active Sheet ID and Drive parent. Back up the index and folder map privately. Record the previous frontend commit and backend version for rollback. Agree whether operators will receive new team and admin keys.
6. Create or use an Alliance-owned Apps Script project, executing as the new deploying account. Use the release Code.gs and appsscript.json. Configure the existing Sheet ID, the new parent folder ID and private access-key properties. Enable Drive v3 and Sheets v4. Run authorizeDeviceUploads in the editor. Google may ask the owner to approve Drive, Sheets and external requests.
7. Rehearse against a private copy of the index and separate test storage first. Verify a member can save a file, find it, and open it. Verify admin keyword management, older links and file ownership. For a shared drive, verify folder creation and permissions with the actual role before cutover.
8. Coordinate the final switch. Point the Alliance backend to the retained index and intended parent. Run setupEverything to initialize missing structures and rebuild the folder map. Verify records and keywords against the backup. Never run resetForGoLive for an account change.
9. Deploy the Alliance web app and point CONFIG.ENDPOINT in index.html at its versioned /exec URL. Publish through the existing knowledge-form GitHub Pages repository. Verify the unchanged public URL with a client user, including opening a newly uploaded file and an older record. Keep the previous deployment available for rollback until the checks pass. If rolling back after a folder-map change, reconcile that map as well as the endpoint.

## Prompt for a new session

“Follow DRIVE_HANDOVER.md in this repository. Switch new uploads to [new Google account] in [destination Drive folder URL]. Keep the current Google Sheet, keywords, and public knowledge-form link. For existing test records and files, [my decision]. Verify the new account and sharing, rehearse safely, then deploy and test add, find, open and keyword management end to end. Ask me for Google consent when needed. Do not delete existing data without my explicit approval.”
