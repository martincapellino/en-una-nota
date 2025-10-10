// Use 'require' which is the standard for this Node.js environment
const axios = require('axios');

// Get the credentials from Vercel's secure Environment Variables
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

// Small helper to send uniform JSON errors
function sendJsonError(res, statusCode, message, extra) {
    const payload = { error: message };
    if (extra) payload.details = extra;
    return res.status(statusCode).json(payload);
}

// Helper: sleep for ms
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Helper: parse Retry-After header (seconds) to milliseconds
function retryAfterMsFrom(response) {
    const retry = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
    const seconds = retry ? Number(retry) : NaN;
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    return null;
}

// A small in-memory cache to reuse the app token
let tokenCache = null;
let tokenExpiresAt = 0;

// Function to get an app token (Client Credentials Flow) with retries on server errors
const getAppToken = async () => {
    // If we have a valid token in our cache, reuse it
    if (tokenCache && Date.now() < tokenExpiresAt) {
        return tokenCache;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    const maxAttempts = 3;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const tokenResponse = await axios.post(
                'https://accounts.spotify.com/api/token',
                params.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                    },
                    timeout: 10000,
                }
            );

            tokenCache = tokenResponse.data.access_token;
            tokenExpiresAt = Date.now() + (tokenResponse.data.expires_in * 1000);
            return tokenCache;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            lastError = data || error.message;
            console.error(`Token fetch failed (attempt ${attempt}/${maxAttempts})`, status, data || error.message);

            // Retry only on server errors (5xx) or explicit server_error from Spotify
            const isServerError = (typeof status === 'number' && status >= 500) || (data && typeof data === 'object' && data.error === 'server_error');
            if (attempt < maxAttempts && isServerError) {
                const delayMs = 300 * attempt; // simple backoff
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            break;
        }
    }
    throw new Error(typeof lastError === 'string' ? lastError : JSON.stringify(lastError));
};

// This is the main function that Vercel will run
module.exports = async (req, res) => {
    // Method validation
    if (req.method !== 'POST') {
        return sendJsonError(res, 405, 'Method Not Allowed. Use POST.');
    }

    // Env validation
    if (!clientId || !clientSecret) {
        return sendJsonError(
            res,
            500,
            'Spotify credentials are not configured on the server.',
            'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your deployment environment.'
        );
    }

    // Content-Type validation
    const contentType = req.headers['content-type'] || req.headers['Content-Type'];
    if (!contentType || !contentType.includes('application/json')) {
        return sendJsonError(res, 400, 'Invalid Content-Type. Expected application/json');
    }

    // Body validation
    const { playlistId } = req.body || {};
    if (!playlistId || typeof playlistId !== 'string') {
        return sendJsonError(res, 400, 'Missing or invalid playlistId');
    }

    try {
        const token = await getAppToken();
        
        // **CORRECTION #2: This URL is now also correct.**
        let currentToken = token;
        const maxAttemptsTracks = 3;
        let lastTracksError;
        let tracksResponse;
        for (let attempt = 1; attempt <= maxAttemptsTracks; attempt++) {
            try {
                tracksResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                    headers: { 'Authorization': `Bearer ${currentToken}` },
                    timeout: 10000,
                });
                break; // success
            } catch (err) {
                const status = err.response?.status;
                const data = err.response?.data;
                lastTracksError = data || err.message;

                // 401/403: invalidate token and retry once with new token
                if (status === 401 || status === 403) {
                    tokenCache = null; // invalidate cached token
                    tokenExpiresAt = 0;
                    try {
                        currentToken = await getAppToken();
                        // do not count this as a full attempt; retry immediately
                        continue;
                    } catch (tokenErr) {
                        throw tokenErr;
                    }
                }

                // 429: respect Retry-After header if present
                if (status === 429) {
                    const waitMs = retryAfterMsFrom(err.response) || 500 * attempt;
                    await sleep(waitMs);
                    continue;
                }

                // 5xx: exponential backoff
                if (typeof status === 'number' && status >= 500) {
                    const waitMs = 300 * attempt;
                    await sleep(waitMs);
                    continue;
                }

                // Other errors: do not retry
                throw err;
            }
        }
        if (!tracksResponse) {
            throw new Error(typeof lastTracksError === 'string' ? lastTracksError : JSON.stringify(lastTracksError));
        }

        const tracks = tracksResponse.data.items;
        const playableTracks = tracks.filter(t => t.track && t.track.preview_url);

        if (playableTracks.length === 0) {
            return res.status(404).json({ error: 'No playable tracks with a preview were found in this playlist.' });
        }
        
        const randomTrack = playableTracks[Math.floor(Math.random() * playableTracks.length)].track;

        return res.status(200).json({
            name: randomTrack.name,
            artist: randomTrack.artists.map(a => a.name).join(', '),
            preview_url: randomTrack.preview_url,
            album_art: randomTrack.album.images[0].url
        });

    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || error.message;
        console.error('Error in get-track function:', data);
        return sendJsonError(
            res,
            status,
            'The call to Spotify failed from the server function.',
            typeof data === 'string' ? data : JSON.stringify(data)
        );
    }
};

