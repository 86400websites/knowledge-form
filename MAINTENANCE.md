# Alliance Knowledge Repository

The static page calls the Apps Script endpoint using JSON in text/plain POST requests. Script properties select the index and repository parent. One uploader key authorizes uploads and keyword management on the server. File links still require the user's normal Drive permissions.

The Knowledge Index has 18 columns. The first 16 columns are unchanged. File Format and File Size occupy columns 17 and 18. Lists stores client and person metadata. Folders maps nested paths to exact Drive URLs. Keywords stores group and label pairs and is the source for both forms. Initial setup imports older topics and free-form tags once. Later setup runs preserve the managed list, including removals.

Device uploads reserve a Drive ID and start a resumable session in the selected folder. The browser sends bounded slices directly to Drive and checks the acknowledged byte offset after interruptions. The backend verifies the resulting file, expected size, and parent before writing its index row. A retry with the same ID recovers a completed file in the same destination. Keyword renames and removals update the catalog and matching record cells in a single Sheets batch under the write lock. The server checks usage again before applying an edit.

See SETUP.txt for services, private configuration and ownership handover. See GO_LIVE_CHECKLIST.txt for the rollout and rollback sequence.
