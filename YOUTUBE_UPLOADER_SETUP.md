# YouTube Uploader Setup

To upload fixed subtitles to YouTube, you need to set up OAuth2 credentials from Google Cloud.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **YouTube Data API v3**:
   - Go to "APIs & Services" → "Library"
   - Search for "YouTube Data API"
   - Click "Enable"

## Step 2: Create OAuth2 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. If prompted, configure the OAuth consent screen first:
   - User Type: External
   - Add your email as a test user
4. For Application type, select **"Desktop application"**
5. Click "Create"
6. Download the OAuth client JSON (Google's UI varies):
   - In the success popup after creating the client, click **Download JSON**
   - Or in the Credentials list, find your OAuth client and click the download icon at the far right
   - Or open the client details and use **Download JSON** there
7. Save the downloaded file as `.youtube-client-secret.json` in the project root

## Step 3: First Upload

Run:
```bash
npm run upload -- 'https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID'
```

**First time only:**
- Your browser automatically opens to log in with your Google account
- If the browser doesn't open, copy the URL from the terminal
- Sign in with your YouTube account (2FA is supported)
- Grant permission to manage your YouTube captions
- The callback should return to `http://localhost:3000/oauth2callback`; if you see plain `http://localhost/`, the OAuth redirect URI is not matching this app's local server
- You'll be redirected back, and credentials are automatically saved to `.youtube-credentials.json` (gitignored)

**Subsequent uploads:**
- Your saved credentials are reused automatically
- No browser login needed

## Usage

```bash
# Upload to a playlist
npm run upload -- 'https://www.youtube.com/playlist?list=PLxxx'

# Upload from a custom directory
npm run upload -- 'https://www.youtube.com/playlist?list=PLxxx' 'path/to/subtitles'

# Force OAuth re-consent
npm run upload -- 'https://www.youtube.com/playlist?list=PLxxx' --reauth
```

## How It Works

1. Fetches all videos from the YouTube playlist
2. For each video, searches for a matching `.fixed.srt` file in `subtitles/`
3. Matches by video title
4. Uploads the subtitle file to the video
5. If a subtitle already exists, it updates it

## Troubleshooting

**"Client secret not found"**
- Make sure you saved the credentials file as `.youtube-client-secret.json` in the project root

**"I don't see a Download JSON button"**
- Make sure you created an **OAuth 2.0 Client ID** (not an API key)
- If you created the client already, open "APIs & Services" → "Credentials" and use the row download icon or open the client details page
- If still not shown, create a new client with Application type **Desktop application** and download from the creation popup

**"Invalid playlist URL"**
- Use the full URL: `https://www.youtube.com/playlist?list=PLAYLIST_ID`
- You can copy this from your browser address bar

**"No matching .fixed.srt file"**
- Make sure the video title in the subtitle filename matches the YouTube video title exactly
- Edited subtitle files live in `subtitles/` with a `.fixed.srt` extension

**Authentication issues**
- Delete `.youtube-credentials.json` and try logging in again
- Make sure you granted permission to manage captions

**"Error: invalid_grant"**
- This usually means the saved refresh token was revoked or expired
- The uploader now auto-detects this, removes stale credentials, and prompts login again
- You can force a clean OAuth flow anytime with: `npm run upload -- 'https://www.youtube.com/playlist?list=PLAYLIST_ID' --reauth`

**"Insufficient Permission" when uploading captions**
- Sign in with a Google account that has permission to edit subtitles/captions for that channel/video
- Delete `.youtube-credentials.json` and run upload again to re-consent with the required captions scope (`youtube.force-ssl`)
- In YouTube Studio, verify your account has the needed channel role (owner/editor with subtitle access)
- If videos are not on your channel, you will need explicit access on that channel to upload captions via API

**"Access blocked: ... has not completed the Google verification process"**
- Your OAuth consent screen is still in **Testing** mode
- Add the Google account you are signing in with as a **Test user** under **APIs & Services** → **OAuth consent screen** → **Test users**
- If you want anyone to be able to sign in, publish the consent screen to **Production** after completing Google's verification requirements
- If you just created the app, this is expected until the account is added as a test user
