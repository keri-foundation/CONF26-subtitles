import { google } from 'googleapis';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, '..', '.youtube-credentials.json');
const CLIENT_SECRET_PATH = path.join(__dirname, '..', '.youtube-client-secret.json');
const UPLOAD_STATE_PATH = path.join(__dirname, '..', '.youtube-upload-state.json');
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

function readUploadState() {
  if (!fs.existsSync(UPLOAD_STATE_PATH)) {
    return { version: 1, tracks: {} };
  }

  try {
    const state = JSON.parse(fs.readFileSync(UPLOAD_STATE_PATH, 'utf-8'));
    if (state && typeof state === 'object' && state.tracks && typeof state.tracks === 'object') {
      return state;
    }
  } catch {
    // Fall through to reset invalid state.
  }

  return { version: 1, tracks: {} };
}

function writeUploadState(state) {
  fs.writeFileSync(UPLOAD_STATE_PATH, JSON.stringify(state, null, 2));
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function getTrackStateKey(videoId, language = 'en') {
  return `${videoId}::${language}`;
}

function shouldSkipUnchangedUpload(state, videoId, subtitlePath, language = 'en') {
  const key = getTrackStateKey(videoId, language);
  const currentHash = hashFile(subtitlePath);
  const previous = state.tracks[key];

  if (!previous) {
    return { skip: false, key, currentHash };
  }

  return {
    skip: previous.hash === currentHash,
    key,
    currentHash,
  };
}

function markUploadState(state, { key, hash, subtitlePath, result }) {
  state.tracks[key] = {
    hash,
    subtitlePath: path.basename(subtitlePath),
    result,
    uploadedAt: new Date().toISOString(),
  };
}

function trackUploadResultCounts(result, counts) {
  if (result === 'updated') {
    counts.updatedCount++;
    return;
  }
  counts.insertedCount++;
}

function maybeSkipUnchangedVideoUpload({ force, state, video, subtitlePath, counts }) {
  if (force) return false;

  const check = shouldSkipUnchangedUpload(state, video.videoId, subtitlePath);
  if (!check.skip) return false;

  console.log(`⊘ Skipped: ${video.title} (subtitle unchanged)\n`);
  counts.skippedCount++;
  counts.skippedUnchangedCount++;
  return true;
}

function persistSuccessfulUpload({ state, videoId, subtitlePath, result }) {
  const uploadCheck = shouldSkipUnchangedUpload(state, videoId, subtitlePath);
  markUploadState(state, {
    key: uploadCheck.key,
    hash: uploadCheck.currentHash,
    subtitlePath,
    result,
  });
}

function hasRequiredScopes(credentials) {
  const grantedRaw = credentials.scope || credentials.scopes || '';
  const granted = new Set(String(grantedRaw).split(/\s+/).filter(Boolean));
  return OAUTH_SCOPES.every((scope) => granted.has(scope));
}

function extractErrorText(error) {
  const parts = [
    error?.message,
    error?.response?.data?.error,
    error?.response?.data?.error_description,
  ].filter(Boolean);
  return parts.join(' ').toLowerCase();
}

function isInvalidGrantError(error) {
  const errorText = extractErrorText(error);
  if (errorText.includes('invalid_grant')) {
    return true;
  }

  const reason = error?.response?.data?.error;
  return reason === 'invalid_grant';
}

function removeSavedCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    fs.unlinkSync(CREDENTIALS_PATH);
    console.log('Removed stale OAuth credentials at .youtube-credentials.json');
  }
}

// Load or create OAuth2 client
async function authorize(options = {}) {
  const { forceReauth = false } = options;
  let client;
  let needsAuthentication = true;

  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(`Client secret not found at ${CLIENT_SECRET_PATH}. See YOUTUBE_UPLOADER_SETUP.md for setup instructions.`);
  }

  const clientSecret = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf-8'));
  const { client_id, client_secret } = clientSecret.installed || clientSecret.web;

  // Check if credentials are already saved
  if (!forceReauth && fs.existsSync(CREDENTIALS_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    if (hasRequiredScopes(credentials)) {
      client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        REDIRECT_URI
      );
      client.setCredentials(credentials);
      needsAuthentication = false;
    } else {
      console.log('Saved OAuth token is missing required scope for caption upload. Re-authentication required.');
    }
  }

  if (needsAuthentication) {
    // First time or stale token: need to authenticate

    client = new google.auth.OAuth2(
      client_id,
      client_secret,
      REDIRECT_URI
    );

    // Generate auth URL and open browser
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: OAUTH_SCOPES,
    });

    console.log('Opening browser for authentication...');
    console.log('If browser does not open, visit this URL:');
    console.log(authUrl);

    const server = createServer(async (req, res) => {
      const urlObj = new URL(req.url, REDIRECT_URI);
      const code = urlObj.searchParams.get('code');

      if (code) {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Save credentials
        const credentialsToSave = {
          ...tokens,
          client_id,
          client_secret,
          requested_scopes: OAUTH_SCOPES,
          redirect_uris: [REDIRECT_URI],
        };
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentialsToSave, null, 2));
        console.log('✓ Credentials saved');

        res.writeHead(200);
        res.end('Authentication successful! You can close this window.');
        server.close();
      }
    });

    server.listen(3000, 'localhost', () => {
      const open = async () => {
        try {
          const { default: openBrowser } = await import('open');
          await openBrowser(authUrl);
        } catch {
          // open package not available, user will need to copy-paste URL
        }
      };
      open();
    });

    // Wait for auth callback
    await new Promise((resolve) => {
      server.on('close', resolve);
    });
  }

  return client;
}

async function fetchPlaylistVideosWithReauth(playlistId, options = {}) {
  const { forceReauth = false } = options;

  const createYouTubeClient = async (reauth = false) => {
    const auth = await authorize({ forceReauth: reauth });
    return google.youtube({
      version: 'v3',
      auth,
    });
  };

  try {
    const youtube = await createYouTubeClient(forceReauth);
    const videos = await getPlaylistVideos(youtube, playlistId);
    return { youtube, videos };
  } catch (error) {
    if (!isInvalidGrantError(error)) {
      throw error;
    }

    console.log('Stored OAuth token is no longer valid (invalid_grant). Re-authentication required.');
    removeSavedCredentials();

    const youtube = await createYouTubeClient(true);
    const videos = await getPlaylistVideos(youtube, playlistId);
    return { youtube, videos };
  }
}

// Get all videos in a playlist
async function getPlaylistVideos(youtube, playlistId) {
  const videos = [];
  let pageToken = null;

  do {
    const response = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId,
      maxResults: 50,
      pageToken,
    });

    const items = response.data.items || [];
    for (const item of items) {
      videos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
      });
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return videos;
}

// Find matching subtitle file for a video
function normalizeTitle(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function simplifyTitle(value) {
  return normalizeTitle(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(left, right) {
  const leftNormalized = normalizeTitle(left);
  const rightNormalized = normalizeTitle(right);
  const leftSimplified = simplifyTitle(left);
  const rightSimplified = simplifyTitle(right);

  return (
    leftNormalized === rightNormalized ||
    leftNormalized.includes(rightNormalized) ||
    rightNormalized.includes(leftNormalized) ||
    leftSimplified === rightSimplified ||
    leftSimplified.includes(rightSimplified) ||
    rightSimplified.includes(leftSimplified)
  );
}

function subtitleTitleFromPath(subtitlePath) {
  const fileName = path.basename(subtitlePath);
  return fileName
    .replace(/\.en\.fixed\.srt$/, '')
    .replace(/\.fixed\.srt$/, '')
    .replace(/\.srt$/, '');
}

function findSubtitleFile(videoTitle, fixedDir) {
  const files = fs.readdirSync(fixedDir);

  for (const file of files) {
    if (file.endsWith('.fixed.srt')) {
      // Extract title from filename (remove .fixed.srt and any .en suffix)
      const filenameTitle = file
        .replace(/\.en\.fixed\.srt$/, '')
        .replace(/\.fixed\.srt$/, '')
      ;

      // Match using exact and relaxed comparison to handle punctuation variations.
      if (titlesMatch(videoTitle, filenameTitle)) {
        return path.join(fixedDir, file);
      }
    }
  }

  return null;
}

function findVideoForSubtitleFile(videos, subtitlePath) {
  const subtitleTitle = subtitleTitleFromPath(subtitlePath);
  return videos.find((video) => titlesMatch(video.title, subtitleTitle)) || null;
}

// Upload subtitle file to video
async function uploadSubtitle(youtube, videoId, subtitlePath, language = 'en') {
  const trackName = language === 'en' ? 'English' : language;
  const fileContent = fs.readFileSync(subtitlePath, 'utf-8');

  const doUpdate = (captionId) => youtube.captions.update({
    part: 'snippet',
    requestBody: {
      id: captionId,
      snippet: {
        videoId,
        language,
        name: trackName,
        isDraft: false,
      },
    },
    media: {
      mimeType: 'application/x-subrip',
      body: fileContent,
    },
  });

  const doInsert = () => youtube.captions.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        videoId,
        language,
        name: trackName,
        isDraft: false,
      },
    },
    media: {
      mimeType: 'application/x-subrip',
      body: fileContent,
    },
  });

  const captions = await youtube.captions.list({ part: 'snippet', videoId });
  const existing = captions.data.items?.find(
    (cap) => cap.snippet.language === language && cap.snippet.name === trackName
  );

  if (existing) {
    await doUpdate(existing.id);
    return 'updated';
  }

  await doInsert();
  return 'inserted';
}

function isInsufficientPermission(error) {
  return error?.message?.toLowerCase().includes('insufficient permission');
}

function printInsufficientPermissionHelp() {
  console.error('✗ Error uploading: Insufficient Permission');
  console.error('  Make sure you are signed in as a channel owner/editor with caption rights.');
  console.error('  Then delete .youtube-credentials.json and re-run upload to grant the required scope.\n');
}

function resolveSubtitlePath(singleFile, fixedDir) {
  return path.isAbsolute(singleFile)
    ? singleFile
    : path.join(fixedDir, singleFile);
}

async function uploadSingleSubtitle(youtube, videos, fixedDir, singleFile, state, options = {}) {
  const { force = false } = options;
  const subtitlePath = resolveSubtitlePath(singleFile, fixedDir);

  if (!fs.existsSync(subtitlePath)) {
    throw new Error(`Subtitle file not found: ${subtitlePath}`);
  }

  const matchingVideo = findVideoForSubtitleFile(videos, subtitlePath);
  if (!matchingVideo) {
    throw new Error(`No matching video found in playlist for subtitle file: ${path.basename(subtitlePath)}`);
  }

  console.log(`Uploading single subtitle file: ${path.basename(subtitlePath)}`);
  console.log(`Matched video: ${matchingVideo.title}`);

  if (!force) {
    const check = shouldSkipUnchangedUpload(state, matchingVideo.videoId, subtitlePath);
    if (check.skip) {
      console.log('⊘ Skipped: subtitle is unchanged from last successful upload');
      console.log('\nSummary:');
      console.log('  Uploaded: 0');
      console.log('  Skipped: 1');
      return;
    }
  }

  const result = await uploadSubtitle(youtube, matchingVideo.videoId, subtitlePath);
  const uploadCheck = shouldSkipUnchangedUpload(state, matchingVideo.videoId, subtitlePath);
  markUploadState(state, {
    key: uploadCheck.key,
    hash: uploadCheck.currentHash,
    subtitlePath,
    result,
  });
  writeUploadState(state);

  console.log(`✓ Success (${result})`);
  console.log('\nSummary:');
  console.log('  Uploaded: 1');
  console.log('  Skipped: 0');
}

async function uploadPlaylistSubtitles(youtube, videos, fixedDir, state, options = {}) {
  const { force = false } = options;
  const counts = {
    uploadedCount: 0,
    updatedCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    skippedUnchangedCount: 0,
  };

  for (const video of videos) {
    const subtitlePath = findSubtitleFile(video.title, fixedDir);

    if (!subtitlePath) {
      console.log(`⊘ Skipped: ${video.title} (no matching .fixed.srt file)\n`);
      counts.skippedCount++;
      continue;
    }

    if (maybeSkipUnchangedVideoUpload({ force, state, video, subtitlePath, counts })) {
      continue;
    }

    try {
      console.log(`Uploading: ${video.title}`);
      const result = await uploadSubtitle(youtube, video.videoId, subtitlePath);

      persistSuccessfulUpload({
        state,
        videoId: video.videoId,
        subtitlePath,
        result,
      });

      trackUploadResultCounts(result, counts);
      console.log(`✓ Success (${result})\n`);
      counts.uploadedCount++;
    } catch (error) {
      if (isInsufficientPermission(error)) {
        printInsufficientPermissionHelp();
        continue;
      }
      console.error(`✗ Error uploading: ${error.message}\n`);
    }
  }

  writeUploadState(state);

  console.log('\nSummary:');
  console.log(`  Uploaded: ${counts.uploadedCount}`);
  console.log(`  Updated: ${counts.updatedCount}`);
  console.log(`  Inserted: ${counts.insertedCount}`);
  console.log(`  Skipped: ${counts.skippedCount}`);
  console.log(`  Skipped unchanged: ${counts.skippedUnchangedCount}`);
}

// Main upload function
export async function uploadSubtitles(playlistUrl, fixedDir = 'subtitles', options = {}) {
  const { singleFile = null, force = false, forceReauth = false } = options;

  // Extract playlist ID from URL
  const playlistIdMatch = playlistUrl.match(/[?&]list=([^&]+)/);
  if (!playlistIdMatch) {
    throw new Error('Invalid playlist URL. Use format: https://www.youtube.com/playlist?list=PLAYLIST_ID');
  }

  const playlistId = playlistIdMatch[1];

  console.log('Authenticating with YouTube...');
  console.log(`Fetching videos from playlist: ${playlistId}`);
  const { youtube, videos } = await fetchPlaylistVideosWithReauth(playlistId, { forceReauth });
  console.log(`Found ${videos.length} videos in playlist\n`);

  if (!fs.existsSync(fixedDir)) {
    throw new Error(`Subtitles directory not found: ${fixedDir}`);
  }

  const uploadState = readUploadState();

  if (singleFile) {
    try {
      await uploadSingleSubtitle(youtube, videos, fixedDir, singleFile, uploadState, { force });
      return;
    } catch (error) {
      if (isInsufficientPermission(error)) {
        printInsufficientPermissionHelp();
        return;
      }
      throw error;
    }
  }

  await uploadPlaylistSubtitles(youtube, videos, fixedDir, uploadState, { force });
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const playlistUrl = args[0];
  let fixedDir = 'subtitles';
  let singleFile = null;
  let force = false;
  let forceReauth = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--file') {
      singleFile = args[i + 1] || null;
      i++;
      continue;
    }
    if (args[i] === '--force') {
      force = true;
      continue;
    }
    if (args[i] === '--reauth') {
      forceReauth = true;
      continue;
    }
    fixedDir = args[i];
  }

  if (!playlistUrl) {
    console.error('Usage: node src/youtube-uploader.js <playlist-url> [subtitles-dir] [--file <subtitle-file>] [--force] [--reauth]');
    console.error('Example: node src/youtube-uploader.js "https://www.youtube.com/playlist?list=PLxxx"');
    console.error('Example: node src/youtube-uploader.js "https://www.youtube.com/playlist?list=PLxxx" --file "Talk Title.fixed.srt"');
    console.error('Example: node src/youtube-uploader.js "https://www.youtube.com/playlist?list=PLxxx" --force');
    console.error('Example: node src/youtube-uploader.js "https://www.youtube.com/playlist?list=PLxxx" --reauth');
    process.exit(1);
  }

  if (args.includes('--file') && !singleFile) {
    console.error('Error: --file requires a subtitle file path or name.');
    process.exit(1);
  }

  try {
    await uploadSubtitles(playlistUrl, fixedDir, { singleFile, force, forceReauth });
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
