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
    // (se quita validación estricta del formato; dejamos que Spotify responda si es inválido)

    try {
        const token = await getAppToken();
        console.log('Fetching playlist tracks for playlistId:', playlistId);
        
        // Verificar existencia básica de la playlist (ayuda a diferenciar 404 reales)
        try {
            await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                timeout: 10000,
                params: { fields: 'id,name' }
            });
        } catch (plErr) {
            const st = plErr.response?.status;
            const dt = plErr.response?.data || plErr.message;
            console.error('Playlist existence check failed:', st, dt);
            // Fallback a búsqueda si la playlist devuelve 404 con Client Credentials
            if (st === 404) {
                const terms = playlistIdToSearchQuery[playlistId] || [];
                if (terms.length) {
                    console.log('Falling back to search with terms:', terms);
                    // permitir un refresh de token si fuera necesario en el flujo del caller
                    let currentToken = token;
                    try {
                        let tracks = await fetchTracksViaSearch(currentToken, terms);
                        if (!tracks.length) {
                            // intento refresh token y reintentar búsqueda
                            tokenCache = null;
                            tokenExpiresAt = 0;
                            currentToken = await getAppToken();
                            tracks = await fetchTracksViaSearch(currentToken, terms);
                        }
                        if (!tracks.length) {
                            // último intento: recomendaciones por género
                            const genreSeeds = terms.map(t => t.replace(/genre:\"|\"/g, ''));
                            tracks = await fetchTracksViaRecommendations(currentToken, genreSeeds);
                        }
                        if (tracks.length) {
                            const t = tracks[Math.floor(Math.random() * tracks.length)];
                            return res.status(200).json({
                                name: t.name,
                                artist: t.artists.map(a => a.name).join(', '),
                                preview_url: t.preview_url,
                                album_art: (t.album?.images?.[0]?.url) || ''
                            });
                        } else {
                            return sendJsonError(
                                res,
                                404,
                                'No playable tracks found via playlist (404) nor via search/recommendations.',
                                dt
                            );
                        }
                    } catch (fbErr) {
                        const s2 = fbErr.response?.status || 500;
                        const d2 = fbErr.response?.data || fbErr.message;
                        console.error('Search/recommendations fallback hard failure:', d2);
                        return sendJsonError(
                            res,
                            s2,
                            'Fallback to search/recommendations failed.',
                            d2
                        );
                    }
                }
            }
            // si no era 404 o no hubo términos, propagar error original
            throw plErr;
        }
        
        // **CORRECTION #2: This URL is now also correct.**
        let currentToken = token;
        const maxAttemptsTracks = 3;
        let lastTracksError;
        let tracksResponse;
        const marketsToTry = ['US', 'AR', 'BR', undefined];
        for (let attempt = 1; attempt <= maxAttemptsTracks && !tracksResponse; attempt++) {
            for (const market of marketsToTry) {
                try {
                    tracksResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                        headers: { 'Authorization': `Bearer ${currentToken}` },
                        timeout: 10000,
                        params: {
                            market: market,
                            fields: 'items(track(name,artists(name),preview_url,album(images)))'
                        }
                    });
                    break; // success
                } catch (err) {
                    const status = err.response?.status;
                    const data = err.response?.data;
                    lastTracksError = data || err.message;
                    console.error(`Tracks fetch failed (attempt ${attempt}/${maxAttemptsTracks}, market=${market || 'none'})`, status, data || err.message);

                    // 401/403: invalidate token and retry con nuevo token
                    if (status === 401 || status === 403) {
                        tokenCache = null;
                        tokenExpiresAt = 0;
                        try {
                            currentToken = await getAppToken();
                            continue; // intentar de nuevo con nuevo token, misma vuelta
                        } catch (tokenErr) {
                            throw tokenErr;
                        }
                    }

                    // 429: respetar Retry-After
                    if (status === 429) {
                        const waitMs = retryAfterMsFrom(err.response) || 500 * attempt;
                        await sleep(waitMs);
                        continue;
                    }

                    // 5xx: backoff
                    if (typeof status === 'number' && status >= 500) {
                        const waitMs = 300 * attempt;
                        await sleep(waitMs);
                        continue;
                    }

                    // 404 u otros: probar siguiente market; si ya probamos todos los markets en este intento, el for externo hará backoff
                    // No lanzar aún; dejamos que el bucle de markets continúe
                }
            }

            if (!tracksResponse) {
                // pequeño backoff entre intentos completos (si 5xx o 404 persistente)
                await sleep(200 * attempt);
            }
        }
        if (!tracksResponse) {
            throw new Error(typeof lastTracksError === 'string' ? lastTracksError : JSON.stringify(lastTracksError));
        }

        const items = tracksResponse.data.items || [];
        const playableTracks = items.filter(t => t.track && t.track.preview_url);

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

