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

// Helper: read cookies from request header
function readCookies(req) {
    const header = req.headers['cookie'] || req.headers['Cookie'] || '';
    return header.split(';').reduce((acc, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k.trim()] = decodeURIComponent(v.trim());
        return acc;
    }, {});
}

async function refreshAccessToken(refreshToken) {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    const resp = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
    });
    return resp.data;
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

// Fallback: mapear playlistId a términos de búsqueda (género/keywords)
const playlistIdToSearchQuery = {
    '37i9dQZF1DXcBWIGoYBM5M': ['genre:"pop"', 'pop', 'dance pop', 'top hits', 'tag:viral', 'tag:new'],
    '37i9dQZF1DWXRqgorJj26U': ['genre:"rock"', 'classic rock', 'rock', 'rock hits'],
    '37i9dQZF1DX10zKGVs6_cs': ['genre:"latin"', 'latin', 'reggaeton', 'latin pop']
};

async function fetchTracksViaSearch(token, searchTerms) {
    const marketsToTry = ['US', 'AR', 'BR', undefined];
    for (const term of searchTerms) {
        for (const market of marketsToTry) {
            try {
                const resp = await axios.get('https://api.spotify.com/v1/search', {
                    headers: { 'Authorization': `Bearer ${token}` },
                    timeout: 10000,
                    params: {
                        q: term,
                        type: 'track',
                        limit: 50,
                        market: market
                    }
                });
                const items = resp.data?.tracks?.items || [];
                const playable = items.filter(t => t && t.preview_url);
                if (playable.length > 0) return playable;
            } catch (err) {
                const status = err.response?.status;
                const data = err.response?.data || err.message;
                console.error('Search fallback failed', term, market || 'none', status, data);
                if (status === 401 || status === 403) throw err;
                if (status === 429) { const waitMs = retryAfterMsFrom(err.response) || 500; await sleep(waitMs); continue; }
                if (typeof status === 'number' && status >= 500) { await sleep(200); continue; }
            }
        }
    }
    return [];
}

async function fetchTracksViaRecommendations(token, genres) {
    const marketsToTry = ['US', 'AR', 'BR', undefined];
    // usar valores por defecto si géneros vienen vacíos
    const baseGenres = genres && genres.length ? genres : ['pop', 'rock', 'latin'];
    for (const genre of baseGenres) {
        for (const market of marketsToTry) {
            try {
                const resp = await axios.get('https://api.spotify.com/v1/recommendations', {
                    headers: { 'Authorization': `Bearer ${token}` },
                    timeout: 10000,
                    params: {
                        seed_genres: genre.replace(/[^a-z]/gi, ','),
                        limit: 50,
                        market: market
                    }
                });
                const items = resp.data?.tracks || [];
                const playable = items.filter(t => t && t.preview_url);
                if (playable.length > 0) return playable;
            } catch (err) {
                const status = err.response?.status;
                const data = err.response?.data || err.message;
                console.error('Recommendations fallback failed', genre, market || 'none', status, data);
                if (status === 401 || status === 403) throw err;
                if (status === 429) { const waitMs = retryAfterMsFrom(err.response) || 500; await sleep(waitMs); continue; }
                if (typeof status === 'number' && status >= 500) { await sleep(200); continue; }
            }
        }
    }
    return [];
}

async function fetchTracksViaItunes(searchTerms) {
    // iTunes Search API: https://itunes.apple.com/search?term=pop&entity=song&limit=50
    // No requiere auth. Devuelve previewUrl y artworkUrl100.
    const terms = searchTerms.length ? searchTerms : ['pop','rock','latin'];
    for (const term of terms) {
        try {
            const resp = await axios.get('https://itunes.apple.com/search', {
                timeout: 10000,
                params: {
                    term: term,
                    entity: 'song',
                    limit: 50
                }
            });
            const items = resp.data?.results || [];
            const playable = items.filter(t => t && t.previewUrl);
            if (playable.length > 0) return playable.map(t => ({
                name: t.trackName,
                artists: [{ name: t.artistName }],
                preview_url: t.previewUrl,
                album: { images: [{ url: t.artworkUrl100 }] }
            }));
        } catch (err) {
            console.error('iTunes fallback failed', term, err.message);
        }
    }
    return [];
}

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
    let { playlistId } = req.body || {};
    if (!playlistId || typeof playlistId !== 'string') {
        return sendJsonError(res, 400, 'Missing or invalid playlistId');
    }
    playlistId = playlistId.trim();

    // Leer token de usuario si existe
    const cookies = readCookies(req);
    let userAccessToken = cookies['sp_access_token'];
    const userRefreshToken = cookies['sp_refresh_token'];

    // Si no hay token de usuario, requerir autenticación
    if (!userAccessToken && !userRefreshToken) {
        return sendJsonError(res, 401, 'User authentication required for Spotify access.');
    }

    try {
        // Preferir token de usuario si existe
        let bearer = null;
        if (userAccessToken) {
            bearer = `Bearer ${userAccessToken}`;
        } else {
            // No hay access token pero sí refresh: no consultamos con app token, refrescamos primero
            try {
                const refreshed = await refreshAccessToken(userRefreshToken);
                userAccessToken = refreshed.access_token;
                bearer = `Bearer ${userAccessToken}`;
            } catch (e) {
                return sendJsonError(res, 401, 'User authentication required for Spotify access.');
            }
        }
        console.log('Proceeding with search/recommendations flow for playlistId:', playlistId);

        // Intentar vía búsqueda/recomendaciones directamente (evitar endpoint de playlists por 404)
        let currentToken = userAccessToken;
        const terms = playlistIdToSearchQuery[playlistId] || [];
        let tracks = [];
        if (terms.length) {
            try {
                tracks = await fetchTracksViaSearch(currentToken, terms);
                if (!tracks.length && userRefreshToken) {
                    const refreshed = await refreshAccessToken(userRefreshToken);
                    currentToken = refreshed.access_token;
                    tracks = await fetchTracksViaSearch(currentToken, terms);
                }
            } catch (err) {
                // si la búsqueda falla por 401/403 y no podemos refrescar, devolvemos 401
                const st = err.response?.status;
                if ((st === 401 || st === 403) && !userRefreshToken) {
                    return sendJsonError(res, 401, 'User authentication required for Spotify access.');
                }
            }
        }

        if (!tracks.length) {
            // recomendaciones con semillas por género
            const genreSeeds = (terms.length ? terms.map(t => t.replace(/genre:\"|\"/g, '')) : ['pop','rock','latin']);
            try {
                tracks = await fetchTracksViaRecommendations(currentToken, genreSeeds);
                if (!tracks.length && userRefreshToken) {
                    const refreshed = await refreshAccessToken(userRefreshToken);
                    currentToken = refreshed.access_token;
                    tracks = await fetchTracksViaRecommendations(currentToken, genreSeeds);
                }
            } catch (err) {
                const st = err.response?.status;
                if ((st === 401 || st === 403) && !userRefreshToken) {
                    return sendJsonError(res, 401, 'User authentication required for Spotify access.');
                }
            }
        }

        if (!tracks.length) {
            // Último recurso: iTunes
            const itunesTerms = terms.length ? terms : ['pop','rock','latin'];
            const itunesTracks = await fetchTracksViaItunes(itunesTerms);
            if (itunesTracks.length) {
                const t = itunesTracks[Math.floor(Math.random() * itunesTracks.length)];
                return res.status(200).json({
                    name: t.name,
                    artist: t.artists.map(a => a.name).join(', '),
                    preview_url: t.preview_url,
                    album_art: (t.album?.images?.[0]?.url) || ''
                });
            }
            return sendJsonError(res, 404, 'No playable tracks found via search/recommendations.');
        }

        const t = tracks[Math.floor(Math.random() * tracks.length)];
        return res.status(200).json({
            name: t.name,
            artist: t.artists.map(a => a.name).join(', '),
            preview_url: t.preview_url,
            album_art: (t.album?.images?.[0]?.url) || ''
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

